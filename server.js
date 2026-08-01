const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to read database
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return { items: [], transactions: [] };
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading database file:', err);
    return { items: [], transactions: [] };
  }
}

// Helper to write database
function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing database file:', err);
    return false;
  }
}

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
app.post('/api/login', (req, res) => {
  const { role, passcode } = req.body;
  if (!role || !passcode) {
    return res.status(400).json({ error: 'Role and passcode are required.' });
  }

  const db = readDB();
  const dbAuth = db.auth || { admin: 'admin123', staff: 'staff123' };

  if (dbAuth[role] && dbAuth[role] === passcode.trim()) {
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
app.get('/api/db', requireAuth(['admin']), (req, res) => {
  res.json(readDB());
});

// Import full database
app.post('/api/db/import', requireAuth(['admin']), (req, res) => {
  const newData = req.body;
  if (!newData || !Array.isArray(newData.items) || !Array.isArray(newData.transactions)) {
    return res.status(400).json({ error: 'Invalid database backup structure.' });
  }
  if (writeDB(newData)) {
    res.json({ success: true, message: 'Database imported successfully.' });
  } else {
    res.status(500).json({ error: 'Failed to write backup to disk.' });
  }
});

// Get all inventory items
app.get('/api/inventory', requireAuth(['admin', 'staff']), (req, res) => {
  const db = readDB();
  res.json(db.items);
});

// Add a new inventory item
app.post('/api/items', requireAuth(['admin']), (req, res) => {
  const { name, brand, category, currentStock, lowStockThreshold } = req.body;
  
  if (!name || !brand || !category) {
    return res.status(400).json({ error: 'Name, Brand, and Category are required.' });
  }

  const db = readDB();
  
  // Check if name already exists (case insensitive)
  const exists = db.items.some(item => item.name.toLowerCase() === name.trim().toLowerCase());
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

  db.items.push(newItem);

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
    db.transactions.unshift(tx);
  }

  if (writeDB(db)) {
    res.json({ success: true, item: newItem });
  } else {
    res.status(500).json({ error: 'Failed to save item to database.' });
  }
});

// Update an item
app.put('/api/items/:id', requireAuth(['admin']), (req, res) => {
  const { id } = req.params;
  const { name, brand, category, lowStockThreshold } = req.body;

  const db = readDB();
  const itemIndex = db.items.findIndex(item => item.id === id);

  if (itemIndex === -1) {
    return res.status(404).json({ error: 'Item not found.' });
  }

  // Update fields if provided
  if (name) db.items[itemIndex].name = name.trim();
  if (brand) db.items[itemIndex].brand = brand.trim();
  if (category) db.items[itemIndex].category = category.trim();
  if (lowStockThreshold !== undefined) db.items[itemIndex].lowStockThreshold = Number(lowStockThreshold);

  if (writeDB(db)) {
    res.json({ success: true, item: db.items[itemIndex] });
  } else {
    res.status(500).json({ error: 'Failed to update item.' });
  }
});

// Delete an item
app.delete('/api/items/:id', requireAuth(['admin']), (req, res) => {
  const { id } = req.params;
  const db = readDB();
  
  const initialCount = db.items.length;
  db.items = db.items.filter(item => item.id !== id);

  if (db.items.length === initialCount) {
    return res.status(404).json({ error: 'Item not found.' });
  }

  // We keep transactions for deleted items, but could flag them.
  if (writeDB(db)) {
    res.json({ success: true, message: 'Item deleted.' });
  } else {
    res.status(500).json({ error: 'Failed to delete item.' });
  }
});

// Get transaction history
app.get('/api/transactions', requireAuth(['admin', 'staff']), (req, res) => {
  const db = readDB();
  res.json(db.transactions);
});

// Post a usage or restock transaction
app.post('/api/transaction', requireAuth(['admin', 'staff']), (req, res) => {
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

  const db = readDB();
  const itemIndex = db.items.findIndex(item => item.id === itemId);

  if (itemIndex === -1) {
    return res.status(404).json({ error: 'Item not found.' });
  }

  const item = db.items[itemIndex];
  const qty = Number(quantity);

  if (type === 'usage') {
    if (item.currentStock < qty) {
      return res.status(400).json({ error: `Insufficient stock. Current stock is ${item.currentStock}.` });
    }
    item.currentStock -= qty;
  } else if (type === 'restock') {
    item.currentStock += qty;
  }

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

  db.transactions.unshift(newTx); // Add to the top of logs

  if (writeDB(db)) {
    res.json({ success: true, item, transaction: newTx });
  } else {
    res.status(500).json({ error: 'Failed to record transaction.' });
  }
});

app.listen(PORT, () => {
  console.log(`Inventory server running at http://localhost:${PORT}`);
});
