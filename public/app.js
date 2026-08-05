// State Variables
let inventory = [];
let transactions = [];
let activeTransactionType = 'usage'; // 'usage' or 'restock'
let currentUserRole = null;
let sessionToken = null;
let isBulkEditMode = false;

// API endpoints
const API_BASE = '/api';

// Secure Fetch wrapper
async function secureFetch(url, options = {}) {
  if (!options.headers) {
    options.headers = {};
  }
  if (sessionToken) {
    options.headers['Authorization'] = `Bearer ${sessionToken}`;
  }
  
  const response = await fetch(url, options);
  
  if (response.status === 401) {
    signOut();
    showToast('Session expired. Please sign in again.', 'error');
    throw new Error('Unauthorized');
  }
  
  return response;
}

// DOM Elements
const elements = {
  themeToggle: document.getElementById('theme-toggle'),
  totalItems: document.getElementById('stat-total-items'),
  lowStock: document.getElementById('stat-low-stock'),
  outOfStock: document.getElementById('stat-out-of-stock'),
  txToday: document.getElementById('stat-tx-today'),
  serverStatus: document.getElementById('server-status'),
  
  // Filters
  searchInput: document.getElementById('search-input'),
  filterBrand: document.getElementById('filter-brand'),
  filterCategory: document.getElementById('filter-category'),
  filterStatus: document.getElementById('filter-status'),
  
  // Table & Logs
  inventoryTbody: document.getElementById('inventory-tbody'),
  logsContainer: document.getElementById('logs-container'),
  btnClearLogsFilter: document.getElementById('btn-clear-logs-filter'),
  
  // Modals
  itemModal: document.getElementById('item-modal'),
  transactionModal: document.getElementById('transaction-modal'),
  
  // Item Form
  itemForm: document.getElementById('item-form'),
  itemModalTitle: document.getElementById('item-modal-title'),
  editItemId: document.getElementById('edit-item-id'),
  itemName: document.getElementById('item-name'),
  itemBrand: document.getElementById('item-brand'),
  itemCategory: document.getElementById('item-category'),
  itemStock: document.getElementById('item-stock'),
  itemThreshold: document.getElementById('item-threshold'),
  initialStockGroup: document.getElementById('initial-stock-group'),
  
  // Transaction Form
  transactionForm: document.getElementById('transaction-form'),
  txItemId: document.getElementById('tx-item-id'),
  txType: document.getElementById('tx-type'),
  txItemDisplay: document.getElementById('tx-item-display'),
  txQuantity: document.getElementById('tx-quantity'),
  txDate: document.getElementById('tx-date'),
  txUser: document.getElementById('tx-user'),
  txRemarks: document.getElementById('tx-remarks'),
  txStockSubtext: document.getElementById('tx-stock-subtext'),
  labelRemarks: document.getElementById('label-remarks'),
  btnSubmitTx: document.getElementById('btn-submit-tx'),
  tabUsage: document.getElementById('tab-usage'),
  tabRestock: document.getElementById('tab-restock'),
  
  // Import/Export
  btnExportCsv: document.getElementById('btn-export-csv'),
  btnExport: document.getElementById('btn-export'),
  btnImport: document.getElementById('btn-import'),
  importFileInput: document.getElementById('import-file-input'),
  btnAddItem: document.getElementById('btn-add-item'),
  btnBulkEdit: document.getElementById('btn-bulk-edit'),
  btnBulkSave: document.getElementById('btn-bulk-save'),
  btnBulkCancel: document.getElementById('btn-bulk-cancel'),
  bulkActionsContainer: document.getElementById('bulk-actions-container'),
  
  // Toast
  toast: document.getElementById('toast'),
  toastIcon: document.getElementById('toast-icon'),
  toastMessage: document.getElementById('toast-message'),
  logoArea: document.querySelector('.logo-area'),

  // Auth Screen Elements
  loginModal: document.getElementById('login-modal'),
  loginForm: document.getElementById('login-form'),
  loginRole: document.getElementById('login-role'),
  loginPasscode: document.getElementById('login-passcode'),
  loginError: document.getElementById('login-error'),
  btnLogout: document.getElementById('btn-logout')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  checkAuth();
  setupEventListeners();
});

// Authentication Logic
async function handleLogin(e) {
  e.preventDefault();
  
  const role = elements.loginRole.value;
  const passcode = elements.loginPasscode.value;
  
  elements.loginError.style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, passcode })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }

    sessionToken = data.token;
    currentUserRole = data.role;

    // Persist
    localStorage.setItem('token', sessionToken);
    localStorage.setItem('role', currentUserRole);

    // Apply role CSS to body
    document.body.classList.remove('role-admin', 'role-staff');
    document.body.classList.add(`role-${currentUserRole}`);

    // Hide modal (fade out)
    elements.loginModal.style.opacity = '0';
    elements.loginModal.style.pointerEvents = 'none';
    elements.loginModal.classList.remove('active');

    // Reset login form
    elements.loginForm.reset();

    showToast(`Signed in successfully as ${currentUserRole === 'admin' ? 'Administrator' : 'Staff'}`, 'success');
    
    // Fetch data
    fetchData();
  } catch (err) {
    elements.loginError.textContent = err.message;
    elements.loginError.style.display = 'block';
    showToast('Sign in failed', 'error');
  }
}

function checkAuth() {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');

  if (token && role) {
    sessionToken = token;
    currentUserRole = role;

    document.body.classList.remove('role-admin', 'role-staff');
    document.body.classList.add(`role-${currentUserRole}`);

    elements.loginModal.style.opacity = '0';
    elements.loginModal.style.pointerEvents = 'none';
    elements.loginModal.classList.remove('active');
    
    fetchData();
  } else {
    document.body.classList.remove('role-admin', 'role-staff');
    elements.loginModal.style.opacity = '1';
    elements.loginModal.style.pointerEvents = 'all';
    elements.loginModal.classList.add('active');
  }
}

function signOut() {
  sessionToken = null;
  currentUserRole = null;
  localStorage.removeItem('token');
  localStorage.removeItem('role');

  document.body.classList.remove('role-admin', 'role-staff');
  
  // Reset bulk edit mode
  isBulkEditMode = false;
  
  // Clear data lists
  inventory = [];
  transactions = [];
  renderInventory();
  renderTransactions();

  // Show login block
  elements.loginModal.style.opacity = '1';
  elements.loginModal.style.pointerEvents = 'all';
  elements.loginModal.classList.add('active');
  
  showToast('Signed out successfully', 'info');
}

// Theme Logic
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
    elements.themeToggle.innerHTML = '<i data-lucide="moon"></i>';
  } else {
    document.body.classList.remove('light-theme');
    elements.themeToggle.innerHTML = '<i data-lucide="sun"></i>';
  }
  lucide.createIcons();
}

function toggleTheme() {
  if (document.body.classList.contains('light-theme')) {
    document.body.classList.remove('light-theme');
    localStorage.setItem('theme', 'dark');
    elements.themeToggle.innerHTML = '<i data-lucide="sun"></i>';
  } else {
    document.body.classList.add('light-theme');
    localStorage.setItem('theme', 'light');
    elements.themeToggle.innerHTML = '<i data-lucide="moon"></i>';
  }
  lucide.createIcons();
}

// Fetch Data from Server
async function fetchData() {
  try {
    const [invResponse, txResponse] = await Promise.all([
      secureFetch(`${API_BASE}/inventory`),
      secureFetch(`${API_BASE}/transactions`)
    ]);

    if (!invResponse.ok || !txResponse.ok) {
      throw new Error('API server returned error');
    }

    inventory = await invResponse.ok ? await invResponse.json() : [];
    transactions = await txResponse.ok ? await txResponse.json() : [];
    
    updateStats();
    renderInventory();
    renderTransactions();
    
    elements.serverStatus.textContent = 'Operational';
    elements.serverStatus.parentElement.querySelector('.pulse-dot').style.backgroundColor = 'var(--success)';
  } catch (err) {
    console.error('Error connecting to backend:', err);
    showToast('Failed to connect to backend server. Make sure it is running.', 'error');
    elements.serverStatus.textContent = 'Server Offline';
    elements.serverStatus.parentElement.querySelector('.pulse-dot').style.backgroundColor = 'var(--danger)';
  }
}

// Update Stats Cards
function updateStats() {
  elements.totalItems.textContent = inventory.length;
  
  const lowCount = inventory.filter(i => i.currentStock > 0 && i.currentStock <= i.lowStockThreshold).length;
  elements.lowStock.textContent = lowCount;
  
  const outCount = inventory.filter(i => i.currentStock === 0).length;
  elements.outOfStock.textContent = outCount;
  
  // Calculate transactions today (local calendar date)
  const todayStr = new Date().toISOString().split('T')[0];
  const txsToday = transactions.filter(t => t.date.split('T')[0] === todayStr).length;
  elements.txToday.textContent = txsToday;
}

// Render Inventory Table
function renderInventory() {
  const searchVal = elements.searchInput.value.toLowerCase().trim();
  const brandVal = elements.filterBrand.value;
  const catVal = elements.filterCategory.value;
  const statusVal = elements.filterStatus.value;

  const filtered = inventory.filter(item => {
    // Search filter
    const matchesSearch = item.name.toLowerCase().includes(searchVal) || 
                          item.category.toLowerCase().includes(searchVal) ||
                          item.brand.toLowerCase().includes(searchVal);
    
    // Brand filter
    const matchesBrand = brandVal === 'ALL' || item.brand === brandVal;
    
    // Category filter
    const matchesCategory = catVal === 'ALL' || item.category === catVal;
    
    // Status filter
    let matchesStatus = true;
    if (statusVal === 'GOOD') {
      matchesStatus = item.currentStock > item.lowStockThreshold;
    } else if (statusVal === 'LOW') {
      matchesStatus = item.currentStock > 0 && item.currentStock <= item.lowStockThreshold;
    } else if (statusVal === 'OUT') {
      matchesStatus = item.currentStock === 0;
    }

    return matchesSearch && matchesBrand && matchesCategory && matchesStatus;
  });

  // Sort alphabetically by name
  filtered.sort((a, b) => a.name.localeCompare(b.name));

  elements.inventoryTbody.innerHTML = '';

  if (filtered.length === 0) {
    elements.inventoryTbody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="no-data-display">
            <i data-lucide="package-search"></i>
            <p>No inventory items match current filters.</p>
          </div>
        </td>
      </tr>
    `;
    lucide.createIcons();
    return;
  }

  filtered.forEach(item => {
    const tr = document.createElement('tr');
    
    // Status setup
    let statusClass = 'in-stock';
    let statusLabel = 'In Stock';
    if (item.currentStock === 0) {
      statusClass = 'out-of-stock';
      statusLabel = 'Out of Stock';
    } else if (item.currentStock <= item.lowStockThreshold) {
      statusClass = 'low-stock';
      statusLabel = 'Low Stock';
    }

    // Brand badge
    const brandClass = item.brand.toLowerCase() === 'upes' ? 'upes' : 
                        item.brand.toLowerCase() === 'pearl' ? 'pearl' : 'other';

    if (isBulkEditMode) {
      tr.innerHTML = `
        <td style="font-weight: 500;">${escapeHtml(item.name)}</td>
        <td><span class="brand-badge ${brandClass}">${escapeHtml(item.brand)}</span></td>
        <td><span style="color: var(--text-muted); font-size: 0.85rem;">${escapeHtml(item.category)}</span></td>
        <td class="text-right">
          <span class="status-badge ${statusClass}">${statusLabel}</span>
        </td>
        <td class="text-right">
          <input type="number" class="bulk-edit-input bulk-qty" data-id="${item.id}" min="0" value="${item.currentStock}">
        </td>
        <td class="text-right">
          <input type="number" class="bulk-edit-input bulk-threshold" data-id="${item.id}" min="1" value="${item.lowStockThreshold}">
        </td>
        <td class="text-center" style="color: var(--text-dark); font-style: italic; font-size: 0.8rem;">
          Bulk Editing
        </td>
      `;
    } else {
      // Progress Bar percentage (capped at 100)
      // We assume double the threshold represents "ideal" level for scale
      const ideal = item.lowStockThreshold * 2.5;
      const progressPercent = Math.min(100, Math.round((item.currentStock / ideal) * 100));
      let progressColor = 'var(--success)';
      if (item.currentStock === 0) progressColor = 'var(--danger)';
      else if (item.currentStock <= item.lowStockThreshold) progressColor = 'var(--warning)';

      tr.innerHTML = `
        <td style="font-weight: 500;">${escapeHtml(item.name)}</td>
        <td><span class="brand-badge ${brandClass}">${escapeHtml(item.brand)}</span></td>
        <td><span style="color: var(--text-muted); font-size: 0.85rem;">${escapeHtml(item.category)}</span></td>
        <td class="text-right">
          <span class="status-badge ${statusClass}">${statusLabel}</span>
        </td>
        <td class="text-right stock-value-cell">
          <div class="stock-progress-container">
            <span>${item.currentStock}</span>
            <div class="stock-bar-outer">
              <div class="stock-bar-inner" style="width: ${progressPercent}%; background-color: ${progressColor};"></div>
            </div>
          </div>
        </td>
        <td class="text-right" style="color: var(--text-dark); font-weight: 600;">${item.lowStockThreshold}</td>
        <td class="text-center">
          <div class="table-actions">
            <button class="btn-action-round hover-usage" onclick="openTxModal('${item.id}', 'usage')" title="Record Usage (Out)">
              <i data-lucide="trending-down"></i>
            </button>
            <button class="btn-action-round hover-restock admin-only" onclick="openTxModal('${item.id}', 'restock')" title="Restock (In)">
              <i data-lucide="trending-up"></i>
            </button>
            <button class="btn-action-round hover-edit admin-only" onclick="openEditItemModal('${item.id}')" title="Edit Item">
              <i data-lucide="edit-3"></i>
            </button>
            <button class="btn-action-round hover-delete admin-only" onclick="deleteItem('${item.id}')" title="Delete Item">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </td>
      `;
    }
    elements.inventoryTbody.appendChild(tr);
  });

  lucide.createIcons();
}

// Toggle Bulk Edit Mode
function toggleBulkEditMode(active) {
  isBulkEditMode = active;
  
  if (active) {
    // Disable filters
    elements.searchInput.disabled = true;
    elements.filterBrand.disabled = true;
    elements.filterCategory.disabled = true;
    elements.filterStatus.disabled = true;
    
    // Show bulk actions, hide normal actions
    elements.bulkActionsContainer.style.display = 'flex';
    elements.btnBulkEdit.style.display = 'none';
    elements.btnAddItem.style.display = 'none';
  } else {
    // Enable filters
    elements.searchInput.disabled = false;
    elements.filterBrand.disabled = false;
    elements.filterCategory.disabled = false;
    elements.filterStatus.disabled = false;
    
    // Hide bulk actions, show normal actions
    elements.bulkActionsContainer.style.display = 'none';
    elements.btnBulkEdit.style.display = 'inline-flex';
    elements.btnAddItem.style.display = 'inline-flex';
  }
  
  renderInventory();
}

// Save Bulk Changes
async function saveBulkChanges() {
  console.log('Bulk save triggered');
  const qtyInputs = document.querySelectorAll('.bulk-qty');
  const thresholdInputs = document.querySelectorAll('.bulk-threshold');
  
  const updates = [];
  
  qtyInputs.forEach(input => {
    const id = input.getAttribute('data-id');
    const qty = Number(input.value);
    
    const threshInput = Array.from(thresholdInputs).find(t => t.getAttribute('data-id') === id);
    const threshold = threshInput ? Number(threshInput.value) : undefined;
    
    const existing = inventory.find(i => i.id === id);
    console.log(`Checking item ${id}: existingStock=${existing ? existing.currentStock : 'null'}, newStock=${qty}, existingThresh=${existing ? existing.lowStockThreshold : 'null'}, newThresh=${threshold}`);
    
    if (existing) {
      const hasQtyChange = existing.currentStock !== qty;
      const hasThreshChange = threshold !== undefined && existing.lowStockThreshold !== threshold;
      
      if (hasQtyChange || hasThreshChange) {
        const updateObj = { id };
        if (hasQtyChange) updateObj.currentStock = qty;
        if (hasThreshChange) updateObj.lowStockThreshold = threshold;
        updates.push(updateObj);
      }
    }
  });
  
  console.log('Gathered updates:', updates);
  
  if (updates.length === 0) {
    showToast('No changes detected.', 'info');
    toggleBulkEditMode(false);
    return;
  }
  
  showToast(`Saving changes for ${updates.length} items...`, 'info');
  
  try {
    let successCount = 0;
    for (const update of updates) {
      const res = await secureFetch(`${API_BASE}/items/${update.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update)
      });
      if (res.ok) {
        successCount++;
      }
    }
    
    showToast(`Successfully updated ${successCount} items.`, 'success');
    toggleBulkEditMode(false);
    fetchData();
  } catch (err) {
    console.error('Error saving bulk updates:', err);
    showToast('An error occurred while saving updates.', 'error');
  }
}

// Render Transaction Logs
function renderTransactions() {
  elements.logsContainer.innerHTML = '';

  if (transactions.length === 0) {
    elements.logsContainer.innerHTML = `
      <div class="no-data-display">
        <i data-lucide="clipboard-list"></i>
        <p>No transactions recorded yet.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  transactions.forEach(tx => {
    const div = document.createElement('div');
    const isUsage = tx.type === 'usage';
    div.className = `log-item ${isUsage ? 'log-usage' : 'log-restock'}`;
    
    // Format Date
    const txDate = new Date(tx.date);
    const dateFormatted = txDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const timeFormatted = txDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    div.innerHTML = `
      <div class="log-header">
        <span class="log-item-name" title="${escapeHtml(tx.itemName)}">${escapeHtml(tx.itemName)}</span>
        <span class="log-qty-tag">${isUsage ? '-' : '+'}${tx.quantity}</span>
      </div>
      <div class="log-meta">
        <span class="log-user">${escapeHtml(tx.user)}</span>
        <span>${dateFormatted} • ${timeFormatted}</span>
      </div>
      ${tx.remarks ? `<div class="log-remarks" title="${escapeHtml(tx.remarks)}">${escapeHtml(tx.remarks)}</div>` : ''}
    `;

    // Filter list on log item click to track specific item
    div.addEventListener('click', () => {
      elements.searchInput.value = tx.itemName;
      renderInventory();
      elements.btnClearLogsFilter.style.display = 'inline-block';
    });

    elements.logsContainer.appendChild(div);
  });

  lucide.createIcons();
}

// Open Add New Item Modal
function openAddItemModal() {
  elements.itemForm.reset();
  elements.editItemId.value = '';
  elements.itemModalTitle.textContent = 'Add Particular Item';
  elements.initialStockGroup.style.display = 'block'; // show initial stock
  elements.itemStock.required = true;
  elements.itemModal.classList.add('active');
}

// Open Edit Item Modal
function openEditItemModal(id) {
  const item = inventory.find(i => i.id === id);
  if (!item) return;

  elements.editItemId.value = item.id;
  elements.itemName.value = item.name;
  elements.itemBrand.value = item.brand;
  elements.itemCategory.value = item.category;
  elements.itemThreshold.value = item.lowStockThreshold;

  elements.itemModalTitle.textContent = 'Edit Particular Info';
  elements.initialStockGroup.style.display = 'none'; // hide stock field, since adjustments should go through txs
  elements.itemStock.required = false;
  elements.itemModal.classList.add('active');
}

// Open Transaction Modal (Usage / Restock)
function openTxModal(id, type) {
  const item = inventory.find(i => i.id === id);
  if (!item) return;

  elements.transactionForm.reset();
  elements.txItemId.value = item.id;
  elements.txItemDisplay.textContent = item.name;
  elements.txStockSubtext.textContent = `Current Stock: ${item.currentStock}`;

  // Pre-fill local date-time
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000; 
  const localISOTime = (new Date(now - tzOffset)).toISOString().slice(0, 16);
  elements.txDate.value = localISOTime;
  elements.txUser.value = (currentUserRole === 'admin' ? 'Admin' : 'Staff');

  setTxType(type);
  elements.transactionModal.classList.add('active');
}

// Toggle Transaction modal tab type
function setTxType(type) {
  activeTransactionType = type;
  elements.txType.value = type;
  
  if (type === 'usage') {
    elements.tabUsage.classList.add('active');
    elements.tabRestock.classList.remove('active');
    elements.labelRemarks.textContent = 'Purpose of Usage *';
    elements.txRemarks.placeholder = 'e.g. Distributed at School of Business seminar';
    elements.btnSubmitTx.textContent = 'Confirm Outflow';
    elements.btnSubmitTx.className = 'btn btn-primary';
    elements.btnSubmitTx.style.backgroundColor = 'var(--warning)';
    elements.btnSubmitTx.style.borderColor = 'var(--warning)';
  } else {
    elements.tabUsage.classList.remove('active');
    elements.tabRestock.classList.add('active');
    elements.labelRemarks.textContent = 'Restock Source & Remarks *';
    elements.txRemarks.placeholder = 'e.g. Received batch from standard vendor / inventory correction';
    elements.btnSubmitTx.textContent = 'Confirm Inflow';
    elements.btnSubmitTx.className = 'btn btn-primary';
    elements.btnSubmitTx.style.backgroundColor = 'var(--success)';
    elements.btnSubmitTx.style.borderColor = 'var(--success)';
  }
}

// Save Item Form (Create or Edit)
async function saveItem(e) {
  e.preventDefault();
  
  const id = elements.editItemId.value;
  const payload = {
    name: elements.itemName.value,
    brand: elements.itemBrand.value,
    category: elements.itemCategory.value,
    lowStockThreshold: Number(elements.itemThreshold.value)
  };

  const isEdit = !!id;
  
  try {
    let url = `${API_BASE}/items`;
    let method = 'POST';

    if (isEdit) {
      url += `/${id}`;
      method = 'PUT';
    } else {
      payload.currentStock = Number(elements.itemStock.value) || 0;
    }

    const res = await secureFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Server error saving item');
    }

    showToast(`Successfully ${isEdit ? 'updated' : 'added'} "${payload.name}"`, 'success');
    closeModals();
    fetchData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Delete Item
async function deleteItem(id) {
  const item = inventory.find(i => i.id === id);
  if (!item) return;

  if (!confirm(`Are you sure you want to delete "${item.name}" from inventory? This cannot be undone.`)) {
    return;
  }

  try {
    const res = await secureFetch(`${API_BASE}/items/${id}`, { method: 'DELETE' });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete item');
    }

    showToast(`Deleted "${item.name}"`, 'success');
    fetchData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Submit Transaction
async function submitTransaction(e) {
  e.preventDefault();

  const itemId = elements.txItemId.value;
  const quantity = Number(elements.txQuantity.value);
  const type = elements.txType.value;
  
  // Local validation
  const item = inventory.find(i => i.id === itemId);
  if (type === 'usage' && item && item.currentStock < quantity) {
    showToast(`Insufficient stock! Only ${item.currentStock} items left.`, 'error');
    return;
  }

  const payload = {
    itemId,
    type,
    quantity,
    user: elements.txUser.value,
    remarks: elements.txRemarks.value,
    date: new Date(elements.txDate.value).toISOString()
  };

  try {
    const res = await secureFetch(`${API_BASE}/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to submit transaction');
    }

    showToast(`Recorded ${type === 'usage' ? 'outflow' : 'inflow'} of ${quantity} units`, 'success');
    closeModals();
    fetchData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Close Modals
function closeModals() {
  elements.itemModal.classList.remove('active');
  elements.transactionModal.classList.remove('active');
}

// Export Backup
async function exportBackup() {
  try {
    const res = await secureFetch(`${API_BASE}/db`);
    if (!res.ok) throw new Error('Could not download db');
    const data = await res.json();

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
    const downloadAnchor = document.createElement('a');
    
    // Set filename with local date stamp
    const stamp = new Date().toISOString().split('T')[0];
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `stockly_backup_${stamp}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    
    showToast('Database exported successfully', 'success');
  } catch (err) {
    showToast('Failed to export database backup', 'error');
  }
}

// Export CSV (Excel compatible)
function exportCsv() {
  try {
    const searchVal = elements.searchInput.value.toLowerCase().trim();
    const brandVal = elements.filterBrand.value;
    const catVal = elements.filterCategory.value;
    const statusVal = elements.filterStatus.value;

    const filtered = inventory.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchVal) || 
                            item.category.toLowerCase().includes(searchVal) ||
                            item.brand.toLowerCase().includes(searchVal);
      const matchesBrand = brandVal === 'ALL' || item.brand === brandVal;
      const matchesCategory = catVal === 'ALL' || item.category === catVal;
      let matchesStatus = true;
      if (statusVal === 'GOOD') {
        matchesStatus = item.currentStock > item.lowStockThreshold;
      } else if (statusVal === 'LOW') {
        matchesStatus = item.currentStock > 0 && item.currentStock <= item.lowStockThreshold;
      } else if (statusVal === 'OUT') {
        matchesStatus = item.currentStock === 0;
      }
      return matchesSearch && matchesBrand && matchesCategory && matchesStatus;
    });

    filtered.sort((a, b) => a.name.localeCompare(b.name));

    if (filtered.length === 0) {
      showToast('No items to export with current filters', 'error');
      return;
    }

    const headers = ['Particular Name', 'Brand/Affiliation', 'Category', 'Current Qty', 'Stock Status', 'Warning Threshold'];
    const rows = filtered.map(item => {
      let statusLabel = 'In Stock';
      if (item.currentStock === 0) statusLabel = 'Out of Stock';
      else if (item.currentStock <= item.lowStockThreshold) statusLabel = 'Low Stock';
      
      return [
        item.name,
        item.brand,
        item.category,
        item.currentStock,
        statusLabel,
        item.lowStockThreshold
      ];
    });

    const csvContent = [headers, ...rows]
      .map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    const stamp = new Date().toISOString().split('T')[0];
    
    downloadAnchor.setAttribute("href", url);
    downloadAnchor.setAttribute("download", `stockly_inventory_${stamp}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(url);

    showToast(`Exported ${filtered.length} items to Excel`, 'success');
  } catch (err) {
    console.error('CSV export failed:', err);
    showToast('Failed to export to Excel', 'error');
  }
}

// Trigger Import File Select
function triggerImport() {
  elements.importFileInput.click();
}

// Handle Backup file restoration
async function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const parsedData = JSON.parse(event.target.result);
      if (!parsedData.items || !parsedData.transactions) {
        throw new Error('Invalid JSON format for database backup.');
      }

      if (!confirm('Are you sure you want to restore this backup? It will overwrite all current items and transaction logs.')) {
        return;
      }

      const res = await secureFetch(`${API_BASE}/db/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedData)
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'API failed to import.');
      }

      showToast('Database restored successfully', 'success');
      fetchData();
    } catch (err) {
      showToast('Import failed: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  
  // reset input
  elements.importFileInput.value = '';
}

// Setup Event Listeners
function setupEventListeners() {
  elements.logoArea.addEventListener('click', () => {
    elements.searchInput.value = '';
    elements.filterBrand.value = 'ALL';
    elements.filterCategory.value = 'ALL';
    elements.filterStatus.value = 'ALL';
    renderInventory();
    elements.btnClearLogsFilter.style.display = 'none';
    showToast('Dashboard reset to default view', 'info');
  });

  elements.themeToggle.addEventListener('click', toggleTheme);
  elements.btnAddItem.addEventListener('click', openAddItemModal);
  elements.btnBulkEdit.addEventListener('click', () => toggleBulkEditMode(true));
  elements.btnBulkCancel.addEventListener('click', () => toggleBulkEditMode(false));
  elements.btnBulkSave.addEventListener('click', saveBulkChanges);
  
  // Close modals
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', closeModals);
  });

  // Modal overlays close on background click
  elements.itemModal.addEventListener('click', (e) => {
    if (e.target === elements.itemModal) closeModals();
  });
  elements.transactionModal.addEventListener('click', (e) => {
    if (e.target === elements.transactionModal) closeModals();
  });

  // Forms
  elements.itemForm.addEventListener('submit', saveItem);
  elements.transactionForm.addEventListener('submit', submitTransaction);
  elements.loginForm.addEventListener('submit', handleLogin);
  elements.btnLogout.addEventListener('click', signOut);

  // Filters
  elements.searchInput.addEventListener('input', renderInventory);
  elements.filterBrand.addEventListener('change', renderInventory);
  elements.filterCategory.addEventListener('change', renderInventory);
  elements.filterStatus.addEventListener('change', renderInventory);

  elements.btnClearLogsFilter.addEventListener('click', () => {
    elements.searchInput.value = '';
    renderInventory();
    elements.btnClearLogsFilter.style.display = 'none';
  });

  // Backup actions
  elements.btnExportCsv.addEventListener('click', exportCsv);
  elements.btnExport.addEventListener('click', exportBackup);
  elements.btnImport.addEventListener('click', triggerImport);
  elements.importFileInput.addEventListener('change', handleImport);
}

// Show toast messages
let toastTimeout;
function showToast(message, type = 'info') {
  clearTimeout(toastTimeout);
  
  elements.toastMessage.textContent = message;
  elements.toast.className = `toast-notification active toast-${type}`;
  
  // Set icons
  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle';
  if (type === 'error') iconName = 'alert-octagon';
  
  elements.toastIcon.setAttribute('data-lucide', iconName);
  lucide.createIcons();

  toastTimeout = setTimeout(() => {
    elements.toast.classList.remove('active');
  }, 4000);
}

// Utility to escape HTML and prevent XSS
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
