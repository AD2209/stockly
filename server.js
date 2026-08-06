const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');
const MONGODB_URI = process.env.MONGODB_URI;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database connection state
let mongoClient = null;
let db = null;
let useMongo = false;

// Initialize Database Connection
async function initDatabase() {
  if (MONGODB_URI) {
    try {
      console.log('Connecting to MongoDB Atlas...');
      mongoClient = new MongoClient(MONGODB_URI);
      await mongoClient.connect();
      db = mongoClient.db('stockly');
      useMongo = true;
      console.log('✅ Connected to MongoDB Atlas.');

      // Check if collections are empty; if so, seed from db.json if it exists
      const itemCount = await db.collection('items').countDocuments();
      if (itemCount === 0 && fs.existsSync(DB_FILE)) {
        console.log('Seeding MongoDB with initial data from db.json...');
        const localData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (localData.items && localData.items.length > 0) {
          await db.collection('items').insertMany(localData.items);
        }
        if (localData.transactions && localData.transactions.length > 0) {
          await db.collection('transactions').insertMany(localData.transactions);
        }
        if (localData.auth) {
          await db.collection('config').updateOne(
            { id: 'auth' },
            { $set: { credentials: localData.auth } },
            { upsert: true }
          );
        }
        console.log('✅ MongoDB seeding complete.');
      }
    } catch (err) {
      console.error('❌ Failed to connect to MongoDB. Falling back to local db.json.', err);
      useMongo = false;
    }
  } else {
    console.log('No MONGODB_URI env variable detected. Using local db.json.');
  }
}

// Helper to read local file DB
function readLocalDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return { items: [], transactions: [], auth: { admin: 'admin123', staff: 'staff123' } };
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading local database file:', err);
    return { items: [], transactions: [], auth: { admin: 'admin123', staff: 'staff123' } };
  }
}

// Helper to write local file DB
function writeLocalDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing local database file:', err);
    return false;
  }
}

// --- DATABASE INTERACTION INTERFACES ---

async function getInventory() {
  if (useMongo) {
    return await db.collection('items').find({}).toArray();
  } else {
    const local = readLocalDB();
    return local.items || [];
  }
}

async function addInventoryItem(item) {
  if (useMongo) {
    await db.collection('items').insertOne(item);
    return true;
  } else {
    const local = readLocalDB();
    local.items.push(item);
    return writeLocalDB(local);
  }
}

async function updateInventoryItem(id, updates) {
  if (useMongo) {
    const result = await db.collection('items').findOneAndUpdate(
      { id: id },
      { $set: updates },
      { returnDocument: 'after' }
    );
    return result;
  } else {
    const local = readLocalDB();
    const index = local.items.findIndex(item => item.id === id);
    if (index === -1) return null;
    local.items[index] = { ...local.items[index], ...updates };
    writeLocalDB(local);
    return local.items[index];
  }
}

async function deleteInventoryItem(id) {
  if (useMongo) {
    const result = await db.collection('items').deleteOne({ id: id });
    return result.deletedCount > 0;
  } else {
    const local = readLocalDB();
    const initialLength = local.items.length;
    local.items = local.items.filter(item => item.id !== id);
    writeLocalDB(local);
    return local.items.length < initialLength;
  }
}

async function getTransactions() {
  if (useMongo) {
    return await db.collection('transactions').find({}).sort({ date: -1 }).toArray();
  } else {
    const local = readLocalDB();
    return local.transactions || [];
  }
}

async function addTransaction(tx) {
  if (useMongo) {
    await db.collection('transactions').insertOne(tx);
    return true;
  } else {
    const local = readLocalDB();
    local.transactions.unshift(tx);
    return writeLocalDB(local);
  }
}

async function getAuthCredentials() {
  const defaultAuth = { admin: 'admin123', staff: 'staff123' };
  if (useMongo) {
    const config = await db.collection('config').findOne({ id: 'auth' });
    return config ? config.credentials : defaultAuth;
  } else {
    const local = readLocalDB();
    return local.auth || defaultAuth;
  }
}

async function importFullDatabase(newData) {
  if (useMongo) {
    await db.collection('items').deleteMany({});
    await db.collection('transactions').deleteMany({});
    if (newData.items && newData.items.length > 0) {
      await db.collection('items').insertMany(newData.items);
    }
    if (newData.transactions && newData.transactions.length > 0) {
      await db.collection('transactions').insertMany(newData.transactions);
    }
    if (newData.auth) {
      await db.collection('config').updateOne(
        { id: 'auth' },
        { $set: { credentials: newData.auth } },
        { upsert: true }
      );
    }
    return true;
  } else {
    return writeLocalDB(newData);
  }
}

// --- MIDDLEWARES & ROUTING ---

// Authentication & Authorization middleware
function requireAuth(allowedRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    }

    const token = authHeader.split(' ')[1];
    if (!token.startsWith('session_token_for_')) {
      return res.status(401).json({ error: 'Invalid session token. Please sign in again.' });
    }

    const role = token.replace('session_token_for_', '');
    if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'Access denied. Insufficient privileges.' });
    }

    req.user = { role };
    next();
  };
}

// POST Login route
app.post('/api/login', async (req, res) => {
  const { role, passcode } = req.body;
  if (!role || !passcode) {
    return res.status(400).json({ error: 'Role and passcode are required.' });
  }

  const credentials = await getAuthCredentials();

  if (credentials[role] && credentials[role] === passcode.trim()) {
    res.json({
      success: true,
      token: `session_token_for_${role}`,
      role
    });
  } else {
    res.status(401).json({ error: 'Invalid passcode.' });
  }
});

// Get full database (for backups)
app.get('/api/db', requireAuth(['admin']), async (req, res) => {
  const items = await getInventory();
  const transactions = await getTransactions();
  const auth = await getAuthCredentials();
  res.json({ auth, items, transactions });
});

// Import full database
app.post('/api/db/import', requireAuth(['admin']), async (req, res) => {
  const newData = req.body;
  if (!newData || !Array.isArray(newData.items) || !Array.isArray(newData.transactions)) {
    return res.status(400).json({ error: 'Invalid database backup structure.' });
  }
  
  const success = await importFullDatabase(newData);
  if (success) {
    res.json({ success: true, message: 'Database imported successfully.' });
  } else {
    res.status(500).json({ error: 'Failed to write data to database.' });
  }
});

// Get all inventory items
app.get('/api/inventory', async (req, res) => {
  const items = await getInventory();
  res.json(items);
});

// Add a new inventory item
app.post('/api/items', requireAuth(['admin']), async (req, res) => {
  const { name, brand, category, currentStock, lowStockThreshold } = req.body;
  
  if (!name || !brand || !category) {
    return res.status(400).json({ error: 'Name, Brand, and Category are required.' });
  }

  // Check if name already exists (case insensitive)
  const items = await getInventory();
  const exists = items.some(item => item.name.toLowerCase() === name.trim().toLowerCase());
  if (exists) {
    return res.status(400).json({ error: 'An item with this name already exists.' });
  }

  const newId = `item_${Date.now()}`;
  const newItem = {
    id: newId,
    name: name.trim(),
    brand: brand.trim(),
    category: category.trim(),
    currentStock: Number(currentStock) || 0,
    lowStockThreshold: Number(lowStockThreshold) || 10
  };

  await addInventoryItem(newItem);

  // Log as initial restock if stock > 0
  if (newItem.currentStock > 0) {
    const tx = {
      id: `tx_${Date.now()}`,
      itemId: newId,
      itemName: newItem.name,
      type: 'restock',
      quantity: newItem.currentStock,
      date: new Date().toISOString(),
      user: 'System Admin',
      remarks: 'Initial stock on creation'
    };
    await addTransaction(tx);
  }

  res.json({ success: true, item: newItem });
});

// Update an item
app.put('/api/items/:id', requireAuth(['admin']), async (req, res) => {
  const { id } = req.params;
  const { name, brand, category, lowStockThreshold, currentStock } = req.body;

  const items = await getInventory();
  const existingItem = items.find(item => item.id === id);
  if (!existingItem) {
    return res.status(404).json({ error: 'Item not found.' });
  }

  const updates = {};
  if (name) updates.name = name.trim();
  if (brand) updates.brand = brand.trim();
  if (category) updates.category = category.trim();
  if (lowStockThreshold !== undefined) updates.lowStockThreshold = Number(lowStockThreshold);

  if (currentStock !== undefined) {
    const newStock = Number(currentStock);
    if (newStock !== existingItem.currentStock) {
      updates.currentStock = newStock;
      
      // Log manual adjustment transaction
      const diff = newStock - existingItem.currentStock;
      const tx = {
        id: `tx_${Date.now()}`,
        itemId: id,
        itemName: updates.name || existingItem.name,
        type: diff > 0 ? 'restock' : 'usage',
        quantity: Math.abs(diff),
        date: new Date().toISOString(),
        user: 'System Admin',
        remarks: `Bulk stock edit (from ${existingItem.currentStock} to ${newStock})`
      };
      await addTransaction(tx);
    }
  }

  const updatedItem = await updateInventoryItem(id, updates);
  if (updatedItem) {
    res.json({ success: true, item: updatedItem });
  } else {
    res.status(500).json({ error: 'Failed to update item.' });
  }
});

// Delete an item
app.delete('/api/items/:id', requireAuth(['admin']), async (req, res) => {
  const { id } = req.params;
  const success = await deleteInventoryItem(id);
  if (success) {
    res.json({ success: true, message: 'Item deleted.' });
  } else {
    res.status(404).json({ error: 'Item not found.' });
  }
});

// Get transaction history
app.get('/api/transactions', async (req, res) => {
  const transactions = await getTransactions();
  res.json(transactions);
});

// Post a usage or restock transaction
app.post('/api/transaction', requireAuth(['admin', 'staff']), async (req, res) => {
  const { itemId, type, quantity, user, remarks, date } = req.body;

  if (!itemId || !type || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'Missing required parameters or invalid quantity.' });
  }

  if (type !== 'usage' && type !== 'restock') {
    return res.status(400).json({ error: 'Invalid transaction type.' });
  }

  // RBAC validation: only admins can restock
  if (type === 'restock' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Only administrators can restock items.' });
  }

  const items = await getInventory();
  const itemIndex = items.findIndex(item => item.id === itemId);

  if (itemIndex === -1) {
    return res.status(404).json({ error: 'Item not found.' });
  }

  const item = items[itemIndex];
  const qty = Number(quantity);

  if (type === 'usage') {
    if (item.currentStock < qty) {
      return res.status(400).json({ error: `Insufficient stock. Current stock is ${item.currentStock}.` });
    }
    item.currentStock -= qty;
  } else if (type === 'restock') {
    item.currentStock += qty;
  }

  // Update item stock in DB
  await updateInventoryItem(itemId, { currentStock: item.currentStock });

  const newTx = {
    id: `tx_${Date.now()}`,
    itemId: item.id,
    itemName: item.name,
    type,
    quantity: qty,
    date: date || new Date().toISOString(),
    user: user ? user.trim() : 'Anonymous',
    remarks: remarks ? remarks.trim() : ''
  };

  await addTransaction(newTx);

  res.json({ success: true, item, transaction: newTx });
});

// Start server
app.listen(PORT, async () => {
  await initDatabase();
  console.log(`Inventory server running at http://localhost:${PORT}`);
});
