import express from 'express';
import { body, param, query as queryValidator, validationResult } from 'express-validator';
import multer from 'multer';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../config/database.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, '../../uploads/products');

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, WEBP, and GIF images are allowed'));
    }
    cb(null, true);
  },
});

router.use(authenticate, requireAdmin);

const validate = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      error: errors.array()[0].msg,
    });
    return false;
  }
  return true;
};

router.post('/upload/product-image', (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: 'Image must be 5MB or smaller',
        });
      }

      return res.status(400).json({
        success: false,
        error: err.message || 'Invalid upload',
      });
    }
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Image file is required',
      });
    }

    const ext = MIME_TO_EXT[req.file.mimetype];
    if (!ext) {
      return res.status(400).json({
        success: false,
        error: 'Unsupported image type',
      });
    }

    await mkdir(uploadDir, { recursive: true });

    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const fullPath = path.join(uploadDir, fileName);
    await writeFile(fullPath, req.file.buffer);

    const backendBase = (process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const imageUrl = `${backendBase}/uploads/products/${fileName}`;

    res.status(201).json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        imageUrl,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/stats', async (req, res, next) => {
  try {
    const [productsRes, ordersRes, usersRes] = await Promise.all([
      query(`SELECT id, in_stock FROM products`),
      query(`SELECT id, total, status FROM orders`),
      query(`SELECT id FROM profiles`),
    ]);

    const products = productsRes.rows;
    const orders = ordersRes.rows;
    const totalRevenue = orders.reduce((sum, order) => sum + Number(order.total), 0);
    const pendingOrders = orders.filter((o) => o.status === 'pending').length;
    const outOfStock = products.filter((p) => !p.in_stock).length;

    res.json({
      success: true,
      data: {
        totalProducts: products.length,
        totalOrders: orders.length,
        totalUsers: usersRes.rows.length,
        totalRevenue,
        pendingOrders,
        outOfStock,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get(
  '/orders',
  [queryValidator('limit').optional().isInt({ min: 1, max: 100 })],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const limit = req.query.limit ? Number(req.query.limit) : null;
      const params = [];
      let sql = `
        SELECT o.id, o.user_id, o.total, o.status, o.shipping_address, o.created_at, o.updated_at,
               p.full_name as customer_name, p.email as customer_email
        FROM orders o
        LEFT JOIN profiles p ON p.id = o.user_id
        ORDER BY o.created_at DESC
      `;

      if (limit) {
        params.push(limit);
        sql += ` LIMIT $1`;
      }

      const result = await query(sql, params);

      res.json({
        success: true,
        data: {
          orders: result.rows,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/orders/:orderId/items',
  [param('orderId').isUUID().withMessage('Valid orderId is required')],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const result = await query(
        `SELECT id, order_id, product_id, product_name, quantity, size, price, created_at
         FROM order_items
         WHERE order_id = $1
         ORDER BY created_at ASC`,
        [req.params.orderId]
      );

      res.json({
        success: true,
        data: {
          items: result.rows,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/orders/:orderId/status',
  [
    param('orderId').isUUID().withMessage('Valid orderId is required'),
    body('status').isIn(['pending', 'processing', 'shipped', 'completed', 'cancelled']).withMessage('Invalid status'),
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const result = await query(
        `UPDATE orders
         SET status = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, user_id, total, status, shipping_address, created_at, updated_at`,
        [req.body.status, req.params.orderId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Order not found',
        });
      }

      res.json({
        success: true,
        message: 'Order status updated',
        data: {
          order: result.rows[0],
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get('/products', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, description, category, price, original_price, image_url, sizes, colors,
              in_stock, featured, stock_quantity, created_at, updated_at
       FROM products
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      data: {
        products: result.rows,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/products',
  [
    body('name').isString().notEmpty().withMessage('Name is required'),
    body('category').isString().notEmpty().withMessage('Category is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a valid number'),
    body('original_price').optional({ nullable: true }).isFloat({ min: 0 }),
    body('description').optional({ nullable: true }).isString(),
    body('image_url').optional({ nullable: true }).isString(),
    body('sizes').optional({ nullable: true }).isArray(),
    body('colors').optional({ nullable: true }).isArray(),
    body('featured').optional().isBoolean(),
    body('stock_quantity').optional().isInt({ min: 0 }),
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const stockQuantity = Number(req.body.stock_quantity ?? 0);
      const result = await query(
        `INSERT INTO products
          (name, description, category, price, original_price, image_url, sizes, colors, featured, stock_quantity, in_stock)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9, $10, $11)
         RETURNING id, name, description, category, price, original_price, image_url, sizes, colors,
                   in_stock, featured, stock_quantity, created_at, updated_at`,
        [
          req.body.name,
          req.body.description || null,
          req.body.category,
          req.body.price,
          req.body.original_price || null,
          req.body.image_url || null,
          req.body.sizes || [],
          req.body.colors || [],
          Boolean(req.body.featured),
          stockQuantity,
          stockQuantity > 0,
        ]
      );

      res.status(201).json({
        success: true,
        message: 'Product created',
        data: {
          product: result.rows[0],
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/products/:productId',
  [
    param('productId').isUUID().withMessage('Valid productId is required'),
    body('name').optional().isString().notEmpty(),
    body('category').optional().isString().notEmpty(),
    body('price').optional().isFloat({ min: 0 }),
    body('original_price').optional({ nullable: true }).isFloat({ min: 0 }),
    body('description').optional({ nullable: true }).isString(),
    body('image_url').optional({ nullable: true }).isString(),
    body('sizes').optional({ nullable: true }).isArray(),
    body('colors').optional({ nullable: true }).isArray(),
    body('featured').optional().isBoolean(),
    body('stock_quantity').optional().isInt({ min: 0 }),
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const currentResult = await query(
        `SELECT * FROM products WHERE id = $1 LIMIT 1`,
        [req.params.productId]
      );

      if (currentResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Product not found',
        });
      }

      const current = currentResult.rows[0];
      const stockQuantity = req.body.stock_quantity ?? current.stock_quantity;
      const inStock = Number(stockQuantity) > 0;

      const result = await query(
        `UPDATE products
         SET name = $1,
             description = $2,
             category = $3,
             price = $4,
             original_price = $5,
             image_url = $6,
             sizes = $7::text[],
             colors = $8::text[],
             featured = $9,
             stock_quantity = $10,
             in_stock = $11,
             updated_at = NOW()
         WHERE id = $12
         RETURNING id, name, description, category, price, original_price, image_url, sizes, colors,
                   in_stock, featured, stock_quantity, created_at, updated_at`,
        [
          req.body.name ?? current.name,
          req.body.description ?? current.description,
          req.body.category ?? current.category,
          req.body.price ?? current.price,
          req.body.original_price ?? current.original_price,
          req.body.image_url ?? current.image_url,
          req.body.sizes ?? current.sizes ?? [],
          req.body.colors ?? current.colors ?? [],
          req.body.featured ?? current.featured,
          stockQuantity,
          inStock,
          req.params.productId,
        ]
      );

      res.json({
        success: true,
        message: 'Product updated',
        data: {
          product: result.rows[0],
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/products/:productId',
  [param('productId').isUUID().withMessage('Valid productId is required')],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const result = await query(
        `DELETE FROM products WHERE id = $1 RETURNING id`,
        [req.params.productId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Product not found',
        });
      }

      res.json({
        success: true,
        message: 'Product deleted',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
