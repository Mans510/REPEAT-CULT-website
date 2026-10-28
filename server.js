const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Email validation helper
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return regex.test(email.trim());
}

// -------------------------------------------------------------
// REST API Endpoints
// -------------------------------------------------------------

/**
 * Health check & database status
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    database: {
      type: 'SQLite3',
      file: db.dbPath,
      exists: fs.existsSync(db.dbPath)
    }
  });
});

/**
 * Comprehensive overview statistics (Customers, Orders, Revenue, Subscribers)
 */
app.get('/api/stats', (req, res) => {
  try {
    const stats = db.getStats();
    res.json({ success: true, stats });
  } catch (err) {
    console.error('Error in /api/stats:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// CUSTOMERS API ENDPOINTS
// -------------------------------------------------------------

/**
 * List all customers who have ordered (with search, sort, pagination)
 */
app.get('/api/customers', (req, res) => {
  try {
    const { search = '', sortBy = 'recent', limit = 100, offset = 0 } = req.query;
    const result = db.getCustomers({
      search,
      sortBy,
      limit: parseInt(limit, 10) || 100,
      offset: parseInt(offset, 10) || 0
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('Error in /api/customers:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Export customers who ordered as CSV
 */
app.get('/api/customers/export', (req, res) => {
  try {
    const { customers } = db.getCustomers({ limit: 10000 });

    const headers = [
      'Customer ID',
      'Name',
      'Email',
      'Phone',
      'Address',
      'City',
      'State',
      'PIN Code',
      'Total Orders',
      'Total Spent (INR)',
      'Customer Since',
      'Latest Order Number',
      'Latest Order Date'
    ];

    const rows = customers.map(c => [
      c.id,
      `"${(c.name || '').replace(/"/g, '""')}"`,
      `"${(c.email || '').replace(/"/g, '""')}"`,
      `"${(c.phone || '').replace(/"/g, '""')}"`,
      `"${(c.address || '').replace(/"/g, '""')}"`,
      `"${(c.city || '').replace(/"/g, '""')}"`,
      `"${(c.state || '').replace(/"/g, '""')}"`,
      `"${(c.pincode || '').replace(/"/g, '""')}"`,
      c.total_orders,
      c.total_spent,
      `"${c.created_at || ''}"`,
      `"${c.latest_order_number || ''}"`,
      `"${c.latest_order_date || ''}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="repeat_cult_customers.csv"');
    res.send(csvContent);
  } catch (err) {
    console.error('Error in /api/customers/export:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Get specific customer with order history
 */
app.get('/api/customers/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid customer ID' });
    }

    const data = db.getCustomerById(id);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    res.json({ success: true, ...data });
  } catch (err) {
    console.error('Error in /api/customers/:id:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Delete a customer
 */
app.delete('/api/customers/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid customer ID' });
    }

    const deleted = db.deleteCustomer(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    res.json({ success: true, message: 'Customer and associated records deleted.' });
  } catch (err) {
    console.error('Error in /api/customers/:id:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// ORDERS & CHECKOUT API ENDPOINTS
// -------------------------------------------------------------

/**
 * Place a new customer order (eCommerce checkout)
 */
app.post('/api/orders', (req, res) => {
  try {
    const { customer, items, paymentMethod = 'COD', notes = '' } = req.body;

    if (!customer || !customer.name || !customer.name.trim()) {
      return res.status(400).json({ success: false, error: 'Customer name is required' });
    }

    if (!customer.email || !isValidEmail(customer.email)) {
      return res.status(400).json({ success: false, error: 'A valid customer email is required' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one item is required in the order' });
    }

    const result = db.createOrder({
      customer,
      items,
      paymentMethod,
      notes
    });

    res.status(201).json({
      success: true,
      message: 'Order placed successfully! Recorded in Repeat Cult database.',
      order: result.order,
      customer: result.customer,
      items: result.items
    });
  } catch (err) {
    console.error('Error in /api/orders:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to place order' });
  }
});

/**
 * List all orders (with filters and search)
 */
app.get('/api/orders', (req, res) => {
  try {
    const { search = '', status = '', customerId = null, limit = 100, offset = 0 } = req.query;
    const result = db.getOrders({
      search,
      status,
      customerId: customerId ? parseInt(customerId, 10) : null,
      limit: parseInt(limit, 10) || 100,
      offset: parseInt(offset, 10) || 0
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('Error in /api/orders:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Get order details by ID
 */
app.get('/api/orders/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid order ID' });
    }

    const data = db.getOrderById(id);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    res.json({ success: true, ...data });
  } catch (err) {
    console.error('Error in /api/orders/:id:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Update order status (pending, confirmed, processing, shipped, delivered, cancelled)
 */
app.patch('/api/orders/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid order ID' });
    }

    const { status, paymentStatus, notes } = req.body;
    const updated = db.updateOrderStatus(id, { status, paymentStatus, notes });

    if (!updated) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    res.json({
      success: true,
      message: 'Order updated successfully',
      order: updated
    });
  } catch (err) {
    console.error('Error in PATCH /api/orders/:id:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Delete an order
 */
app.delete('/api/orders/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid order ID' });
    }

    const deleted = db.deleteOrder(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    res.json({ success: true, message: 'Order removed successfully' });
  } catch (err) {
    console.error('Error in /api/orders/:id:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Export orders as CSV
 */
app.get('/api/orders/export', (req, res) => {
  try {
    const { orders } = db.getOrders({ limit: 10000 });

    const headers = [
      'Order ID',
      'Order Number',
      'Customer Name',
      'Customer Email',
      'Customer Phone',
      'City',
      'State',
      'Items Summary',
      'Total Amount (INR)',
      'Status',
      'Payment Method',
      'Payment Status',
      'Created At'
    ];

    const rows = orders.map(o => [
      o.id,
      `"${(o.order_number || '').replace(/"/g, '""')}"`,
      `"${(o.customer_name || '').replace(/"/g, '""')}"`,
      `"${(o.customer_email || '').replace(/"/g, '""')}"`,
      `"${(o.customer_phone || '').replace(/"/g, '""')}"`,
      `"${(o.city || '').replace(/"/g, '""')}"`,
      `"${(o.state || '').replace(/"/g, '""')}"`,
      `"${(o.items_summary || '').replace(/"/g, '""')}"`,
      o.total_amount,
      `"${o.status}"`,
      `"${o.payment_method}"`,
      `"${o.payment_status}"`,
      `"${o.created_at}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="repeat_cult_orders.csv"');
    res.send(csvContent);
  } catch (err) {
    console.error('Error in /api/orders/export:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// NEWSLETTER & SUBSCRIBER ENDPOINTS
// -------------------------------------------------------------

/**
 * Subscribe to newsletter / batch drop waitlist
 */
app.post('/api/newsletter/subscribe', (req, res) => {
  try {
    const { email, source } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address.'
      });
    }

    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;

    const result = db.addSubscriber({
      email,
      source: source || 'website_footer',
      ipAddress,
      userAgent
    });

    res.status(result.isNew ? 201 : 200).json({
      success: true,
      alreadySubscribed: result.alreadySubscribed,
      reActivated: result.reActivated || false,
      message: result.message,
      subscriber: {
        id: result.subscriber.id,
        email: result.subscriber.email,
        status: result.subscriber.status,
        created_at: result.subscriber.created_at
      }
    });
  } catch (err) {
    console.error('Error in /api/newsletter/subscribe:', err);
    res.status(500).json({
      success: false,
      error: 'An internal server error occurred. Please try again.'
    });
  }
});

/**
 * List all subscribers (with search, filter, pagination)
 */
app.get('/api/newsletter/subscribers', (req, res) => {
  try {
    const { search = '', status = '', limit = 100, offset = 0 } = req.query;
    const result = db.getSubscribers({
      search,
      status,
      limit: parseInt(limit, 10) || 100,
      offset: parseInt(offset, 10) || 0
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('Error in /api/newsletter/subscribers:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Export subscribers as CSV
 */
app.get('/api/newsletter/export', (req, res) => {
  try {
    const { subscribers } = db.getSubscribers({ limit: 10000 });

    const headers = ['ID', 'Email', 'Status', 'Source', 'Created At'];
    const rows = subscribers.map(s => [
      s.id,
      `"${s.email.replace(/"/g, '""')}"`,
      `"${s.status}"`,
      `"${s.source || ''}"`,
      `"${s.created_at}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="repeat_cult_subscribers.csv"');
    res.send(csvContent);
  } catch (err) {
    console.error('Error in /api/newsletter/export:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Delete a subscriber
 */
app.delete('/api/newsletter/subscribers/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid subscriber ID.' });
    }

    const deleted = db.deleteSubscriber(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Subscriber not found.' });
    }

    res.json({ success: true, message: 'Subscriber removed successfully.' });
  } catch (err) {
    console.error('Error in /api/newsletter/subscribers/:id:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Unsubscribe an email
 */
app.post('/api/newsletter/unsubscribe', (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required.' });
    }

    const updated = db.unsubscribeEmail(email);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Email not found.' });
    }

    res.json({ success: true, message: 'Successfully unsubscribed from batch drops.' });
  } catch (err) {
    console.error('Error in /api/newsletter/unsubscribe:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Static File Serving & Fallbacks
// -------------------------------------------------------------

// Explicitly route admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Static files mapping for uppercase/lowercase file extensions on cross-platform systems
app.get('/style.css', (req, res) => {
  const file = fs.existsSync(path.join(__dirname, 'style.CSS')) ? 'style.CSS' : 'style.css';
  res.sendFile(path.join(__dirname, file));
});

app.get('/script.js', (req, res) => {
  const file = fs.existsSync(path.join(__dirname, 'script.JS')) ? 'script.JS' : 'script.js';
  res.sendFile(path.join(__dirname, file));
});

app.use(express.static(__dirname, {
  index: ['index.HTML', 'index.html']
}));

// Root fallback to index.HTML
app.get('/', (req, res) => {
  const file = fs.existsSync(path.join(__dirname, 'index.HTML')) ? 'index.HTML' : 'index.html';
  res.sendFile(path.join(__dirname, file));
});

// Start the server
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`⚡ REPEAT CULT Backend & Database Running`);
  console.log(`📍 URL:        http://localhost:${PORT}`);
  console.log(`📊 Admin:      http://localhost:${PORT}/admin`);
  console.log(`💾 Database:   ${db.dbPath}`);
  console.log(`========================================\n`);
});
