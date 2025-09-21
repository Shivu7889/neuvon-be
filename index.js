const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MySQL connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'user',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'contact',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Create MySQL connection pool
const pool = mysql.createPool(dbConfig);

// Create contacts table if it doesn't exist
async function createContactsTable() {
  try {
    const connection = await pool.getConnection();
    
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS contacts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `;
    
    await connection.execute(createTableQuery);
    connection.release();
    console.log('Contacts table created or already exists');
  } catch (error) {
    console.error('Error creating contacts table:', error);
  }
}

// Initialize database
createContactsTable();

// API Routes
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, message } = req.body;

    // Validate required fields
    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and message are required fields'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    // Insert contact into database
    const connection = await pool.getConnection();
    
    const insertQuery = `
      INSERT INTO contacts (name, email, message)
      VALUES (?, ?, ?)
    `;
    
    const [result] = await connection.execute(insertQuery, [name, email, message]);
    connection.release();

    console.log('New contact saved:', { id: result.insertId, name, email });

    res.status(201).json({
      success: true,
      message: 'Contact form submitted successfully',
      data: {
        id: result.insertId,
        name,
        email,
        message,
        created_at: new Date()
      }
    });

  } catch (error) {
    console.error('Error saving contact:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error. Please try again later.'
    });
  }
});

// Get all contacts (admin endpoint)
app.get('/api/contacts', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    const selectQuery = 'SELECT * FROM contacts ORDER BY created_at DESC';
    const [rows] = await connection.execute(selectQuery);
    connection.release();

    res.json({
      success: true,
      data: rows
    });

  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date()
  });
});

// Default route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Contact Form API Server is running',
    endpoints: {
      'POST /api/contact': 'Submit contact form',
      'GET /api/contacts': 'Get all contacts (admin)',
      'GET /api/health': 'Health check'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`API endpoints:`);
  console.log(`  POST http://localhost:${PORT}/api/contact`);
  console.log(`  GET  http://localhost:${PORT}/api/contacts`);
  console.log(`  GET  http://localhost:${PORT}/api/health`);
});

module.exports = app;