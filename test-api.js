const http = require('http');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}/api`;

// Helper to make requests
function makeRequest(url, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const headers = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: headers
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING RBAC API VERIFICATION TESTS ---');
  let failures = 0;
  
  let adminToken = null;
  let staffToken = null;

  // Test 1: GET /api/inventory (No Auth)
  try {
    const res = await makeRequest(`${BASE_URL}/inventory`);
    if (res.statusCode === 401) {
      console.log('✅ Test 1 Passed: Unauthenticated request rejected with 401 Unauthorized.');
    } else {
      console.log('❌ Test 1 Failed: Expected status 401, got:', res.statusCode, res.body);
      failures++;
    }
  } catch (err) {
    console.log('❌ Test 1 Failed: Request error:', err.message);
    failures++;
  }

  // Test 2: Login as Staff (Passcode: staff123)
  try {
    const res = await makeRequest(`${BASE_URL}/login`, 'POST', {
      role: 'staff',
      passcode: 'staff123'
    });
    if (res.statusCode === 200 && res.body.success && res.body.token) {
      staffToken = res.body.token;
      console.log('✅ Test 2 Passed: Logged in as Staff. Token received.');
    } else {
      console.log('❌ Test 2 Failed: Status:', res.statusCode, res.body);
      failures++;
    }
  } catch (err) {
    console.log('❌ Test 2 Failed: Request error:', err.message);
    failures++;
  }

  // Test 3: Login as Admin (Passcode: admin123)
  try {
    const res = await makeRequest(`${BASE_URL}/login`, 'POST', {
      role: 'admin',
      passcode: 'admin123'
    });
    if (res.statusCode === 200 && res.body.success && res.body.token) {
      adminToken = res.body.token;
      console.log('✅ Test 3 Passed: Logged in as Admin. Token received.');
    } else {
      console.log('❌ Test 3 Failed: Status:', res.statusCode, res.body);
      failures++;
    }
  } catch (err) {
    console.log('❌ Test 3 Failed: Request error:', err.message);
    failures++;
  }

  if (!staffToken || !adminToken) {
    console.log('Aborting subsequent tests due to token acquisition failure.');
    process.exit(1);
  }

  // Test 4: Create Item as Staff (Forbidden)
  try {
    const res = await makeRequest(`${BASE_URL}/items`, 'POST', {
      name: 'Forbidden Staff Item ' + Date.now(),
      brand: 'Other',
      category: 'Stationery',
      currentStock: 10,
      lowStockThreshold: 2
    }, staffToken);
    if (res.statusCode === 403) {
      console.log('✅ Test 4 Passed: Staff blocked from creating items (403 Forbidden).');
    } else {
      console.log('❌ Test 4 Failed: Expected 403, got:', res.statusCode, res.body);
      failures++;
    }
  } catch (err) {
    console.log('❌ Test 4 Failed: Request error:', err.message);
    failures++;
  }

  // Test 5: Create Item as Admin (Allowed)
  let testItemId = null;
  const testItemName = 'Test Verification Item ' + Date.now();
  try {
    const res = await makeRequest(`${BASE_URL}/items`, 'POST', {
      name: testItemName,
      brand: 'Other',
      category: 'Stationery',
      currentStock: 50,
      lowStockThreshold: 10
    }, adminToken);
    if (res.statusCode === 200 && res.body.success && res.body.item) {
      testItemId = res.body.item.id;
      console.log(`✅ Test 5 Passed: Admin created item "${testItemId}".`);
    } else {
      console.log('❌ Test 5 Failed: Status:', res.statusCode, res.body);
      failures++;
    }
  } catch (err) {
    console.log('❌ Test 5 Failed: Request error:', err.message);
    failures++;
  }

  if (!testItemId) {
    console.log('Aborting subsequent tests due to creation failure.');
    process.exit(1);
  }

  // Test 6: Restock as Staff (Forbidden)
  try {
    const res = await makeRequest(`${BASE_URL}/transaction`, 'POST', {
      itemId: testItemId,
      type: 'restock',
      quantity: 10,
      user: 'Staff Member',
      remarks: 'Should block',
      date: new Date().toISOString()
    }, staffToken);
    if (res.statusCode === 403) {
      console.log('✅ Test 6 Passed: Staff blocked from restocking (403 Forbidden).');
    } else {
      console.log('❌ Test 6 Failed: Expected 403, got:', res.statusCode, res.body);
      failures++;
    }
  } catch (err) {
    console.log('❌ Test 6 Failed: Request error:', err.message);
    failures++;
  }

  // Test 7: Usage as Staff (Allowed)
  try {
    const res = await makeRequest(`${BASE_URL}/transaction`, 'POST', {
      itemId: testItemId,
      type: 'usage',
      quantity: 15,
      user: 'Staff Member',
      remarks: 'Valid staff usage subtraction',
      date: new Date().toISOString()
    }, staffToken);
    if (res.statusCode === 200 && res.body.success && res.body.item.currentStock === 35) {
      console.log('✅ Test 7 Passed: Staff allowed to record usage (stock decreased 50 -> 35).');
    } else {
      console.log('❌ Test 7 Failed: Status:', res.statusCode, res.body);
      failures++;
    }
  } catch (err) {
    console.log('❌ Test 7 Failed: Request error:', err.message);
    failures++;
  }

  // Test 8: Restock as Admin (Allowed)
  try {
    const res = await makeRequest(`${BASE_URL}/transaction`, 'POST', {
      itemId: testItemId,
      type: 'restock',
      quantity: 20,
      user: 'Administrator',
      remarks: 'Valid admin restock addition',
      date: new Date().toISOString()
    }, adminToken);
    if (res.statusCode === 200 && res.body.success && res.body.item.currentStock === 55) {
      console.log('✅ Test 8 Passed: Admin allowed to record restock (stock increased 35 -> 55).');
    } else {
      console.log('❌ Test 8 Failed: Status:', res.statusCode, res.body);
      failures++;
    }
  } catch (err) {
    console.log('❌ Test 8 Failed: Request error:', err.message);
    failures++;
  }

  // Test 9: Delete Item as Staff (Forbidden)
  try {
    const res = await makeRequest(`${BASE_URL}/items/${testItemId}`, 'DELETE', null, staffToken);
    if (res.statusCode === 403) {
      console.log('✅ Test 9 Passed: Staff blocked from deleting item (403 Forbidden).');
    } else {
      console.log('❌ Test 9 Failed: Expected 403, got:', res.statusCode, res.body);
      failures++;
    }
  } catch (err) {
    console.log('❌ Test 9 Failed: Request error:', err.message);
    failures++;
  }

  // Test 10: Delete Item as Admin (Allowed)
  try {
    const res = await makeRequest(`${BASE_URL}/items/${testItemId}`, 'DELETE', null, adminToken);
    if (res.statusCode === 200 && res.body.success) {
      console.log(`✅ Test 10 Passed: Admin successfully deleted test item.`);
    } else {
      console.log('❌ Test 10 Failed: Status:', res.statusCode, res.body);
      failures++;
    }
  } catch (err) {
    console.log('❌ Test 10 Failed: Request error:', err.message);
    failures++;
  }

  console.log('--- RBAC API VERIFICATION COMPLETED ---');
  if (failures === 0) {
    console.log('🎉 ALL ACCESS LEVEL VERIFICATIONS PASSED SUCCESSFULLY!');
    process.exit(0);
  } else {
    console.log(`❌ SOME TESTS FAILED: ${failures} errors.`);
    process.exit(1);
  }
}

runTests();
