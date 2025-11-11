const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Configure multer for file uploads in memory for Vercel
const storage = multer.memoryStorage(); // Store files in memory instead of disk

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed (JPEG, JPG, PNG, GIF, WebP)!'));
    }
  }
});

// For Vercel, we'll use a temporary directory if we need to write files
const os = require('os');
const tmpDir = os.tmpdir();
console.log('Using temporary directory for file operations:', tmpDir);

const allowedOrigins = [
  'http://localhost:8080',
  'https://neuvonsoftware.com',
  'https://www.neuvonsoftware.com',
  'https://neuvon-be.vercel.app'
];
// Middleware

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.some(allowedOrigin => 
      origin === allowedOrigin || 
      origin.startsWith(allowedOrigin.replace('https://', 'http://')) // Handle http->https redirects
    )) {
      return callback(null, true);
    }
    
    const msg = `The CORS policy for this site does not allow access from ${origin}`;
    return callback(new Error(msg), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar'],
}));

app.options('*', cors());

app.use(express.json());
app.use('/uploads', express.static(uploadsDir)); // Serve uploaded files

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

// Create blogs table if it doesn't exist
async function createBlogsTable() {
  try {
    const connection = await pool.getConnection();
    
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS blogs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        slug VARCHAR(255) UNIQUE NOT NULL,
        title VARCHAR(500) NOT NULL,
        excerpt TEXT NOT NULL,
        content LONGTEXT NOT NULL,
        cover_image VARCHAR(500),
        author_name VARCHAR(255) NOT NULL,
        author_role VARCHAR(255) NOT NULL,
        author_image VARCHAR(255),
        category VARCHAR(100) NOT NULL,
        tags JSON,
        read_time VARCHAR(50) NOT NULL,
        published_at DATE NOT NULL,
        status ENUM('draft', 'published') DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_slug (slug),
        INDEX idx_category (category),
        INDEX idx_status (status),
        INDEX idx_published_at (published_at)
      )
    `;
    
    await connection.execute(createTableQuery);
    
    // Add author_image column if it doesn't exist (for existing tables)
    try {
      const [authorImageColumns] = await connection.execute(`
        SHOW COLUMNS FROM blogs LIKE 'author_image'
      `);
      
      if (authorImageColumns.length === 0) {
        await connection.execute(`
          ALTER TABLE blogs 
          ADD COLUMN author_image VARCHAR(255) AFTER author_role
        `);
        console.log('✓ Author_image column added successfully');
      } else {
        console.log('✓ Author_image column already exists');
      }
    } catch (alterError) {
      console.error('Error checking/adding author_image column:', alterError.message);
    }

    // Add cover_image column if it doesn't exist (for existing tables)
    try {
      const [coverImageColumns] = await connection.execute(`
        SHOW COLUMNS FROM blogs LIKE 'cover_image'
      `);
      
      if (coverImageColumns.length === 0) {
        await connection.execute(`
          ALTER TABLE blogs 
          ADD COLUMN cover_image VARCHAR(500) AFTER content
        `);
        console.log('✓ Cover_image column added successfully');
      } else {
        console.log('✓ Cover_image column already exists');
      }
    } catch (alterError) {
      console.error('Error checking/adding cover_image column:', alterError.message);
    }
    
    connection.release();
    console.log('✓ Blogs table ready');
  } catch (error) {
    console.error('Error creating blogs table:', error);
  }
}

// Initialize database
createContactsTable();
createBlogsTable();

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

// ============ BLOG API ENDPOINTS ============

// Upload blog cover image
app.post('/api/upload-blog-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // For Vercel, we'll use a cloud storage solution like AWS S3 or Cloudinary in production
    // For now, we'll just return a success response with file details
    // In a production environment, you should upload to a cloud storage service here
    
    // Example response (modify as needed for your frontend)
    res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      // Return the file buffer as base64 for the frontend to handle
      // In production, you would return the URL of the uploaded file in cloud storage
      file: {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        // In a real app, you would upload to S3/Cloudinary and return the URL
        // For now, we'll just send a placeholder
        url: `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`,
        // In production, replace the above with something like:
        // url: `https://your-cloud-storage-bucket.s3.amazonaws.com/${Date.now()}-${req.file.originalname}`
      }
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading file',
      error: error.message
    });
  }
});

// Get all published blogs
app.get('/api/blogs', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    const selectQuery = `
      SELECT id, slug, title, excerpt, cover_image, author_name, author_role, author_image,
             category, tags, read_time, published_at, created_at
      FROM blogs 
      WHERE status = 'published'
      ORDER BY published_at DESC
    `;
    const [rows] = await connection.execute(selectQuery);
    connection.release();

    // Parse JSON tags
    const blogs = rows.map(blog => ({
      ...blog,
      tags: typeof blog.tags === 'string' ? JSON.parse(blog.tags) : blog.tags
    }));

    res.json({
      success: true,
      data: blogs
    });

  } catch (error) {
    console.error('Error fetching blogs:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get single blog by slug
app.get('/api/blogs/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const connection = await pool.getConnection();
    
    const selectQuery = `
      SELECT * FROM blogs 
      WHERE slug = ? AND status = 'published'
    `;
    const [rows] = await connection.execute(selectQuery, [slug]);
    connection.release();

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blog post not found'
      });
    }

    const blog = {
      ...rows[0],
      tags: typeof rows[0].tags === 'string' ? JSON.parse(rows[0].tags) : rows[0].tags
    };

    res.json({
      success: true,
      data: blog
    });

  } catch (error) {
    console.error('Error fetching blog:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get all blogs (admin - includes drafts)
app.get('/api/admin/blogs', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    const selectQuery = 'SELECT * FROM blogs ORDER BY created_at DESC';
    const [rows] = await connection.execute(selectQuery);
    connection.release();

    const blogs = rows.map(blog => ({
      ...blog,
      tags: typeof blog.tags === 'string' ? JSON.parse(blog.tags) : blog.tags
    }));

    res.json({
      success: true,
      data: blogs
    });

  } catch (error) {
    console.error('Error fetching blogs:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Create new blog
app.post('/api/admin/blogs', async (req, res) => {
  try {
    const { 
      slug, title, excerpt, content, cover_image, author_name, author_role, author_image,
      category, tags, read_time, published_at, status 
    } = req.body;

    // Validate required fields
    if (!slug || !title || !excerpt || !content || !author_name || 
        !author_role || !category || !read_time || !published_at) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided'
      });
    }

    const connection = await pool.getConnection();
    
    const insertQuery = `
      INSERT INTO blogs (
        slug, title, excerpt, content, cover_image, author_name, author_role, author_image,
        category, tags, read_time, published_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const tagsJson = JSON.stringify(tags || []);
    const [result] = await connection.execute(insertQuery, [
      slug, title, excerpt, content, cover_image || null, author_name, author_role, author_image || null,
      category, tagsJson, read_time, published_at, status || 'draft'
    ]);
    connection.release();

    console.log('New blog created:', { id: result.insertId, slug, title });

    res.status(201).json({
      success: true,
      message: 'Blog created successfully',
      data: {
        id: result.insertId,
        slug
      }
    });

  } catch (error) {
    console.error('Error creating blog:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'A blog with this slug already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update blog
app.put('/api/admin/blogs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      slug, title, excerpt, content, cover_image, author_name, author_role, author_image,
      category, tags, read_time, published_at, status 
    } = req.body;

    const connection = await pool.getConnection();
    
    const updateQuery = `
      UPDATE blogs SET
        slug = ?, title = ?, excerpt = ?, content = ?, cover_image = ?,
        author_name = ?, author_role = ?, author_image = ?, category = ?,
        tags = ?, read_time = ?, published_at = ?, status = ?
      WHERE id = ?
    `;
    
    const tagsJson = JSON.stringify(tags || []);
    const [result] = await connection.execute(updateQuery, [
      slug, title, excerpt, content, cover_image || null, author_name, author_role, author_image || null,
      category, tagsJson, read_time, published_at, status || 'draft', id
    ]);
    connection.release();

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blog not found'
      });
    }

    res.json({
      success: true,
      message: 'Blog updated successfully'
    });

  } catch (error) {
    console.error('Error updating blog:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'A blog with this slug already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete blog
app.delete('/api/admin/blogs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const connection = await pool.getConnection();
    
    const deleteQuery = 'DELETE FROM blogs WHERE id = ?';
    const [result] = await connection.execute(deleteQuery, [id]);
    connection.release();

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blog not found'
      });
    }

    res.json({
      success: true,
      message: 'Blog deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting blog:', error);
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
    message: 'API Server is running',
    endpoints: {
      contact: {
        'POST /api/contact': 'Submit contact form',
        'GET /api/contacts': 'Get all contacts (admin)'
      },
      blog: {
        'GET /api/blogs': 'Get all published blogs',
        'GET /api/blogs/:slug': 'Get single blog by slug',
        'GET /api/admin/blogs': 'Get all blogs including drafts (admin)',
        'POST /api/admin/blogs': 'Create new blog (admin)',
        'PUT /api/admin/blogs/:id': 'Update blog (admin)',
        'DELETE /api/admin/blogs/:id': 'Delete blog (admin)'
      },
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
