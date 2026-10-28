const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'repeatcult.db');
const db = new Database(dbPath);

// Enable WAL mode for high concurrency and performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize database schema
db.exec(`
  -- 1. Newsletter subscribers & drop alerts
  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'unsubscribed')),
    source TEXT NOT NULL DEFAULT 'website_footer',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email);
  CREATE INDEX IF NOT EXISTS idx_subscribers_created ON subscribers(created_at);

  CREATE TABLE IF NOT EXISTS drop_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL COLLATE NOCASE,
    batch_name TEXT NOT NULL,
    product_name TEXT,
    created_at TEXT NOT NULL,
    notified INTEGER NOT NULL DEFAULT 0
  );

  -- 2. Customers who have ordered
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    pincode TEXT,
    total_orders INTEGER NOT NULL DEFAULT 1,
    total_spent REAL NOT NULL DEFAULT 0.0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    notes TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
  CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
  CREATE INDEX IF NOT EXISTS idx_customers_created ON customers(created_at);

  -- 3. Customer orders
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL UNIQUE,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL COLLATE NOCASE,
    customer_phone TEXT,
    shipping_address TEXT,
    city TEXT,
    state TEXT,
    pincode TEXT,
    total_amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
    payment_method TEXT NOT NULL DEFAULT 'COD',
    payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending', 'paid', 'refunded')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    notes TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
  CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
  CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

  -- 4. Order items
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    size TEXT NOT NULL DEFAULT 'M',
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL,
    total_price REAL NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
`);

/**
 * Add or re-activate a subscriber
 */
function addSubscriber({ email, source = 'website_footer', ipAddress = null, userAgent = null }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) {
    throw new Error('Email address is required');
  }

  const now = new Date().toISOString();

  // Check if subscriber already exists
  const existing = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(cleanEmail);

  if (existing) {
    if (existing.status === 'active') {
      return {
        alreadySubscribed: true,
        isNew: false,
        subscriber: existing,
        message: "You're already on the list for the next batch drop!"
      };
    } else {
      const updateStmt = db.prepare(`
        UPDATE subscribers 
        SET status = 'active', updated_at = ?, source = ?, ip_address = ?, user_agent = ?
        WHERE id = ?
      `);
      updateStmt.run(now, source, ipAddress, userAgent, existing.id);
      const updated = db.prepare('SELECT * FROM subscribers WHERE id = ?').get(existing.id);
      return {
        alreadySubscribed: false,
        isNew: false,
        reActivated: true,
        subscriber: updated,
        message: 'Welcome back! Your subscription has been reactivated.'
      };
    }
  }

  // Insert brand new subscriber
  const insertStmt = db.prepare(`
    INSERT INTO subscribers (email, status, source, created_at, updated_at, ip_address, user_agent)
    VALUES (?, 'active', ?, ?, ?, ?, ?)
  `);

  const info = insertStmt.run(cleanEmail, source, now, now, ipAddress, userAgent);
  const newSub = db.prepare('SELECT * FROM subscribers WHERE id = ?').get(info.lastInsertRowid);

  return {
    alreadySubscribed: false,
    isNew: true,
    subscriber: newSub,
    message: "Locked in! You're on the list for the next batch drop."
  };
}

/**
 * Get all subscribers with optional search and pagination
 */
function getSubscribers({ search = '', status = '', limit = 100, offset = 0 } = {}) {
  let query = 'SELECT id, email, status, source, created_at, updated_at FROM subscribers WHERE 1=1';
  let countQuery = 'SELECT COUNT(*) as count FROM subscribers WHERE 1=1';
  const params = [];
  const countParams = [];

  if (search && search.trim()) {
    const term = `%${search.trim().toLowerCase()}%`;
    query += ' AND LOWER(email) LIKE ?';
    countQuery += ' AND LOWER(email) LIKE ?';
    params.push(term);
    countParams.push(term);
  }

  if (status && status.trim()) {
    query += ' AND status = ?';
    countQuery += ' AND status = ?';
    params.push(status.trim());
    countParams.push(status.trim());
  }

  query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const total = db.prepare(countQuery).get(...countParams).count;
  const rows = db.prepare(query).all(...params);

  return {
    total,
    count: rows.length,
    subscribers: rows
  };
}

/**
 * Delete a subscriber by ID
 */
function deleteSubscriber(id) {
  const stmt = db.prepare('DELETE FROM subscribers WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Unsubscribe by email
 */
function unsubscribeEmail(email) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const now = new Date().toISOString();
  const stmt = db.prepare(`UPDATE subscribers SET status = 'unsubscribed', updated_at = ? WHERE email = ?`);
  const result = stmt.run(now, cleanEmail);
  return result.changes > 0;
}

// ---------------------------------------------------------------------
// CUSTOMERS & ORDERS DATABASE OPERATIONS
// ---------------------------------------------------------------------

/**
 * Generate unique stylish Repeat Cult order number
 */
function generateOrderNumber() {
  const chars = '0123456789ABCDEF';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return `RC-${dateStr}-${rand}`;
}

/**
 * Place a new customer order and register / update the customer in database
 */
const createOrderTx = db.transaction((orderData) => {
  const {
    customer,
    items,
    paymentMethod = 'COD',
    notes = ''
  } = orderData;

  if (!customer || !customer.name || !customer.email) {
    throw new Error('Customer name and email are required to create an order');
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error('Order must contain at least one item');
  }

  const cleanEmail = String(customer.email).trim().toLowerCase();
  const cleanName = String(customer.name).trim();
  const cleanPhone = customer.phone ? String(customer.phone).trim() : null;
  const cleanAddress = customer.address ? String(customer.address).trim() : null;
  const cleanCity = customer.city ? String(customer.city).trim() : null;
  const cleanState = customer.state ? String(customer.state).trim() : null;
  const cleanPincode = customer.pincode ? String(customer.pincode).trim() : null;

  const now = new Date().toISOString();

  // Calculate order total
  let orderTotal = 0;
  const sanitizedItems = items.map(item => {
    const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
    const price = Math.max(0, parseFloat(item.unitPrice || item.price) || 0);
    const itemTotal = qty * price;
    orderTotal += itemTotal;
    return {
      productName: String(item.productName || item.name || 'Batch Tee').trim(),
      size: String(item.size || 'M').trim(),
      quantity: qty,
      unitPrice: price,
      totalPrice: itemTotal
    };
  });

  // Find or create customer
  let customerRecord = db.prepare('SELECT * FROM customers WHERE email = ?').get(cleanEmail);

  if (customerRecord) {
    // Update existing customer stats & contact info
    const updateCustomerStmt = db.prepare(`
      UPDATE customers
      SET name = ?,
          phone = COALESCE(?, phone),
          address = COALESCE(?, address),
          city = COALESCE(?, city),
          state = COALESCE(?, state),
          pincode = COALESCE(?, pincode),
          total_orders = total_orders + 1,
          total_spent = total_spent + ?,
          updated_at = ?
      WHERE id = ?
    `);
    updateCustomerStmt.run(
      cleanName,
      cleanPhone,
      cleanAddress,
      cleanCity,
      cleanState,
      cleanPincode,
      orderTotal,
      now,
      customerRecord.id
    );
    customerRecord = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerRecord.id);
  } else {
    // Insert new customer
    const insertCustomerStmt = db.prepare(`
      INSERT INTO customers (
        name, email, phone, address, city, state, pincode,
        total_orders, total_spent, created_at, updated_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `);
    const info = insertCustomerStmt.run(
      cleanName,
      cleanEmail,
      cleanPhone,
      cleanAddress,
      cleanCity,
      cleanState,
      cleanPincode,
      orderTotal,
      now,
      now,
      notes || null
    );
    customerRecord = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
  }

  // Create Order
  const orderNumber = generateOrderNumber();
  const insertOrderStmt = db.prepare(`
    INSERT INTO orders (
      order_number, customer_id, customer_name, customer_email,
      customer_phone, shipping_address, city, state, pincode,
      total_amount, currency, status, payment_method, payment_status,
      created_at, updated_at, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', 'confirmed', ?, 'pending', ?, ?, ?)
  `);

  const orderResult = insertOrderStmt.run(
    orderNumber,
    customerRecord.id,
    customerRecord.name,
    customerRecord.email,
    cleanPhone,
    cleanAddress,
    cleanCity,
    cleanState,
    cleanPincode,
    orderTotal,
    paymentMethod,
    now,
    now,
    notes || null
  );

  const orderId = orderResult.lastInsertRowid;

  // Insert Order Items
  const insertItemStmt = db.prepare(`
    INSERT INTO order_items (order_id, product_name, size, quantity, unit_price, total_price)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  sanitizedItems.forEach(item => {
    insertItemStmt.run(
      orderId,
      item.productName,
      item.size,
      item.quantity,
      item.unitPrice,
      item.totalPrice
    );
  });

  // Automatically ensure customer is in drop subscribers
  try {
    const subCheck = db.prepare('SELECT id FROM subscribers WHERE email = ?').get(cleanEmail);
    if (!subCheck) {
      db.prepare(`
        INSERT INTO subscribers (email, status, source, created_at, updated_at)
        VALUES (?, 'active', 'order_checkout', ?, ?)
      `).run(cleanEmail, now, now);
    }
  } catch (e) {
    // Subscriber addition is non-blocking
  }

  const createdOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);

  return {
    customer: customerRecord,
    order: createdOrder,
    items: orderItems
  };
});

function createOrder(orderData) {
  return createOrderTx(orderData);
}

/**
 * Get customers who have ordered with search, sorting, and pagination
 */
function getCustomers({ search = '', sortBy = 'recent', limit = 100, offset = 0 } = {}) {
  let query = `
    SELECT 
      c.*,
      (SELECT order_number FROM orders WHERE customer_id = c.id ORDER BY id DESC LIMIT 1) as latest_order_number,
      (SELECT created_at FROM orders WHERE customer_id = c.id ORDER BY id DESC LIMIT 1) as latest_order_date
    FROM customers c
    WHERE 1=1
  `;
  let countQuery = 'SELECT COUNT(*) as count FROM customers WHERE 1=1';
  const params = [];
  const countParams = [];

  if (search && search.trim()) {
    const term = `%${search.trim().toLowerCase()}%`;
    const searchFilter = ' AND (LOWER(c.name) LIKE ? OR LOWER(c.email) LIKE ? OR c.phone LIKE ? OR LOWER(c.city) LIKE ?)';
    query += searchFilter;
    countQuery += ' AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR phone LIKE ? OR LOWER(city) LIKE ?)';
    params.push(term, term, term, term);
    countParams.push(term, term, term, term);
  }

  // Sorting
  if (sortBy === 'spent') {
    query += ' ORDER BY c.total_spent DESC';
  } else if (sortBy === 'orders') {
    query += ' ORDER BY c.total_orders DESC';
  } else if (sortBy === 'name') {
    query += ' ORDER BY c.name ASC';
  } else {
    query += ' ORDER BY c.id DESC';
  }

  query += ' LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const total = db.prepare(countQuery).get(...countParams).count;
  const customers = db.prepare(query).all(...params);

  return {
    total,
    count: customers.length,
    customers
  };
}

/**
 * Get a specific customer by ID along with their full order history
 */
function getCustomerById(id) {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!customer) return null;

  const orders = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC').all(id);

  // Attach items to each order
  const getItemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  orders.forEach(order => {
    order.items = getItemsStmt.all(order.id);
  });

  return {
    customer,
    orders
  };
}

/**
 * Delete a customer and cascade their orders
 */
const deleteCustomerTx = db.transaction((id) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!customer) return false;

  // With FOREIGN KEYS ON, deleting customer cascades orders and order_items
  const stmt = db.prepare('DELETE FROM customers WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
});

function deleteCustomer(id) {
  return deleteCustomerTx(id);
}

/**
 * Get orders with optional search, status filter, and pagination
 */
function getOrders({ search = '', status = '', customerId = null, limit = 100, offset = 0 } = {}) {
  let query = `
    SELECT 
      o.*,
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as items_count,
      (SELECT GROUP_CONCAT(product_name || ' (' || size || ' x' || quantity || ')', ', ') FROM order_items WHERE order_id = o.id) as items_summary
    FROM orders o
    WHERE 1=1
  `;
  let countQuery = 'SELECT COUNT(*) as count FROM orders WHERE 1=1';
  const params = [];
  const countParams = [];

  if (customerId) {
    query += ' AND o.customer_id = ?';
    countQuery += ' AND customer_id = ?';
    params.push(customerId);
    countParams.push(customerId);
  }

  if (status && status.trim()) {
    query += ' AND o.status = ?';
    countQuery += ' AND status = ?';
    params.push(status.trim());
    countParams.push(status.trim());
  }

  if (search && search.trim()) {
    const term = `%${search.trim().toLowerCase()}%`;
    const searchFilter = ' AND (LOWER(o.order_number) LIKE ? OR LOWER(o.customer_name) LIKE ? OR LOWER(o.customer_email) LIKE ? OR o.customer_phone LIKE ? OR LOWER(o.city) LIKE ?)';
    query += searchFilter;
    countQuery += ' AND (LOWER(order_number) LIKE ? OR LOWER(customer_name) LIKE ? OR LOWER(customer_email) LIKE ? OR customer_phone LIKE ? OR LOWER(city) LIKE ?)';
    params.push(term, term, term, term, term);
    countParams.push(term, term, term, term, term);
  }

  query += ' ORDER BY o.id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const total = db.prepare(countQuery).get(...countParams).count;
  const orders = db.prepare(query).all(...params);

  return {
    total,
    count: orders.length,
    orders
  };
}

/**
 * Get order by ID with line items
 */
function getOrderById(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);

  return {
    order,
    items,
    customer
  };
}

/**
 * Update order status
 */
function updateOrderStatus(id, { status, paymentStatus, notes } = {}) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;

  const now = new Date().toISOString();
  const newStatus = status || order.status;
  const newPaymentStatus = paymentStatus || order.payment_status;
  const newNotes = notes !== undefined ? notes : order.notes;

  const stmt = db.prepare(`
    UPDATE orders
    SET status = ?, payment_status = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(newStatus, newPaymentStatus, newNotes, now, id);

  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

/**
 * Delete order and recalculate customer totals
 */
const deleteOrderTx = db.transaction((id) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return false;

  const customerId = order.customer_id;
  db.prepare('DELETE FROM orders WHERE id = ?').run(id);

  // Recalculate customer stats
  const remaining = db.prepare(`
    SELECT COUNT(*) as order_count, COALESCE(SUM(total_amount), 0) as total_spent
    FROM orders
    WHERE customer_id = ?
  `).get(customerId);

  const now = new Date().toISOString();
  if (remaining.order_count === 0) {
    db.prepare('UPDATE customers SET total_orders = 0, total_spent = 0, updated_at = ? WHERE id = ?').run(now, customerId);
  } else {
    db.prepare('UPDATE customers SET total_orders = ?, total_spent = ?, updated_at = ? WHERE id = ?').run(
      remaining.order_count,
      remaining.total_spent,
      now,
      customerId
    );
  }

  return true;
});

function deleteOrder(id) {
  return deleteOrderTx(id);
}

/**
 * Get comprehensive stats across subscribers and customer orders
 */
function getStats() {
  const totalSubscribers = db.prepare('SELECT COUNT(*) as count FROM subscribers').get().count;
  const activeSubscribers = db.prepare("SELECT COUNT(*) as count FROM subscribers WHERE status = 'active'").get().count;

  const customerStats = db.prepare(`
    SELECT 
      COUNT(*) as total_customers,
      COALESCE(SUM(total_spent), 0) as total_revenue
    FROM customers
  `).get();

  const orderStats = db.prepare(`
    SELECT 
      COUNT(*) as total_orders,
      SUM(CASE WHEN status IN ('confirmed', 'processing', 'shipped') THEN 1 ELSE 0 END) as active_orders,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered_orders
    FROM orders
  `).get();

  const totalOrders = orderStats.total_orders || 0;
  const totalRevenue = customerStats.total_revenue || 0;
  const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  const recentCustomers = db.prepare(`
    SELECT id, name, email, phone, city, total_orders, total_spent, created_at
    FROM customers
    ORDER BY id DESC
    LIMIT 5
  `).all();

  const recentOrders = db.prepare(`
    SELECT id, order_number, customer_name, total_amount, status, created_at
    FROM orders
    ORDER BY id DESC
    LIMIT 5
  `).all();

  return {
    totalSubscribers,
    activeSubscribers,
    unsubscribedCount: totalSubscribers - activeSubscribers,
    totalCustomers: customerStats.total_customers,
    totalOrders,
    totalRevenue,
    avgOrderValue,
    activeOrders: orderStats.active_orders || 0,
    deliveredOrders: orderStats.delivered_orders || 0,
    recentCustomers,
    recentOrders
  };
}

/**
 * Seed realistic initial customer orders if the database is empty
 */
function seedInitialData() {
  const count = db.prepare('SELECT COUNT(*) as count FROM customers').get().count;
  if (count > 0) return;

  const sampleOrders = [
    {
      customer: {
        name: 'Amanpreet Singh',
        email: 'aman.singh@gmail.com',
        phone: '+91 98765 43210',
        address: 'House #42, Circular Road, Near Crystal Chowk',
        city: 'Amritsar',
        state: 'Punjab',
        pincode: '143001'
      },
      items: [
        { productName: 'Midnight Z Black (Batch 002)', size: 'L', quantity: 1, unitPrice: 1199 }
      ],
      paymentMethod: 'COD',
      notes: 'Please call before dispatch, Amritsar local pickup/delivery.'
    },
    {
      customer: {
        name: 'Kabir Mehra',
        email: 'kabir.mehra@delhiwear.in',
        phone: '+91 98112 34567',
        address: 'B-14 Hauz Khas Enclave, 2nd Floor',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110016'
      },
      items: [
        { productName: 'Electric Royal Blue (Batch 002)', size: 'XL', quantity: 1, unitPrice: 1199 },
        { productName: 'Featured Piece — Grey Culture 2.0', size: 'XL', quantity: 1, unitPrice: 999 }
      ],
      paymentMethod: 'UPI',
      notes: 'Leave at front desk if unavailable.'
    },
    {
      customer: {
        name: 'Rhea Sharma',
        email: 'rhea.sharma@outlook.com',
        phone: '+91 99201 88234',
        address: 'Flat 402, Pali Hill Apts, Nargis Dutt Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400050'
      },
      items: [
        { productName: 'Cloud Sky Blue (Batch 002)', size: 'S', quantity: 1, unitPrice: 1199 }
      ],
      paymentMethod: 'Card',
      notes: 'Repeat Cult first drop order!'
    },
    {
      customer: {
        name: 'Jaswinder Gill',
        email: 'jas.gill99@yahoo.com',
        phone: '+91 97800 12399',
        address: 'House 1120, Sector 17-B',
        city: 'Chandigarh',
        state: 'Chandigarh',
        pincode: '160017'
      },
      items: [
        { productName: 'Featured Piece — Grey Culture 2.0', size: 'M', quantity: 1, unitPrice: 999 },
        { productName: 'Midnight Z Black (Batch 002)', size: 'M', quantity: 1, unitPrice: 1199 }
      ],
      paymentMethod: 'COD',
      notes: 'Fast delivery requested'
    }
  ];

  for (const sample of sampleOrders) {
    try {
      createOrder(sample);
    } catch (err) {
      console.warn('Error seeding sample order:', err.message);
    }
  }
}

// Automatically seed sample data if empty
seedInitialData();

module.exports = {
  db,
  dbPath,
  addSubscriber,
  getSubscribers,
  deleteSubscriber,
  unsubscribeEmail,
  createOrder,
  getCustomers,
  getCustomerById,
  deleteCustomer,
  getOrders,
  getOrderById,
  updateOrderStatus,
  deleteOrder,
  getStats,
  seedInitialData
};
