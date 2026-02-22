import express from 'express';
import { body, param, validationResult } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { getClient, query } from '../config/database.js';

const router = express.Router();

router.use(authenticate);

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

/**
 * Wishlist
 */
router.get('/wishlist', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT product_id
       FROM wishlist
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.userId]
    );

    res.json({
      success: true,
      data: {
        wishlistIds: result.rows.map((r) => r.product_id),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/wishlist',
  [body('productId').isUUID().withMessage('Valid productId is required')],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      await query(
        `INSERT INTO wishlist (user_id, product_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, product_id) DO NOTHING`,
        [req.userId, req.body.productId]
      );

      res.status(201).json({
        success: true,
        message: 'Added to wishlist',
      });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/wishlist/:productId',
  [param('productId').isUUID().withMessage('Valid productId is required')],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      await query(
        `DELETE FROM wishlist WHERE user_id = $1 AND product_id = $2`,
        [req.userId, req.params.productId]
      );

      res.json({
        success: true,
        message: 'Removed from wishlist',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Orders
 */
router.get('/orders', async (req, res, next) => {
  try {
    const ordersResult = await query(
      `SELECT id, user_id, status, total, shipping_address, created_at, updated_at
       FROM orders
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.userId]
    );

    const orders = ordersResult.rows;
    if (orders.length === 0) {
      return res.json({
        success: true,
        data: {
          orders: [],
        },
      });
    }

    const orderIds = orders.map((o) => o.id);
    const itemsResult = await query(
      `SELECT id, order_id, product_id, product_name, quantity, size, price, created_at
       FROM order_items
       WHERE order_id = ANY($1::uuid[])
       ORDER BY created_at ASC`,
      [orderIds]
    );

    const itemsByOrderId = new Map();
    for (const item of itemsResult.rows) {
      if (!itemsByOrderId.has(item.order_id)) itemsByOrderId.set(item.order_id, []);
      itemsByOrderId.get(item.order_id).push(item);
    }

    res.json({
      success: true,
      data: {
        orders: orders.map((order) => ({
          ...order,
          order_items: itemsByOrderId.get(order.id) || [],
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get(
  '/orders/:orderId',
  [param('orderId').isUUID().withMessage('Valid orderId is required')],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const orderResult = await query(
        `SELECT id, user_id, status, total, shipping_address, created_at, updated_at
         FROM orders
         WHERE id = $1 AND user_id = $2
         LIMIT 1`,
        [req.params.orderId, req.userId]
      );

      if (orderResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Order not found',
        });
      }

      const itemsResult = await query(
        `SELECT id, order_id, product_id, product_name, quantity, size, price, created_at
         FROM order_items
         WHERE order_id = $1
         ORDER BY created_at ASC`,
        [req.params.orderId]
      );

      res.json({
        success: true,
        data: {
          order: orderResult.rows[0],
          items: itemsResult.rows,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/orders',
  [
    body('items').isArray({ min: 1 }).withMessage('At least one order item is required'),
    body('items.*.productId').isUUID().withMessage('Valid productId is required'),
    body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
    body('items.*.price').isFloat({ min: 0 }).withMessage('Price must be a valid number'),
    body('items.*.size').optional().isString(),
    body('items.*.product_name').optional().isString(),
    body('total').isFloat({ min: 0 }).withMessage('Total must be a valid number'),
    body('shippingAddress').isObject().withMessage('Shipping address is required'),
  ],
  async (req, res, next) => {
    let client;
    try {
      if (!validate(req, res)) return;

      const { items, total, shippingAddress } = req.body;
      client = await getClient();
      await client.query('BEGIN');

      for (const item of items) {
        const stockResult = await client.query(
          `SELECT id, name, stock_quantity
           FROM products
           WHERE id = $1
           FOR UPDATE`,
          [item.productId]
        );

        if (stockResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            error: 'One or more products no longer exist',
          });
        }

        const product = stockResult.rows[0];
        if (product.stock_quantity < item.quantity) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            error: `Insufficient stock for "${product.name}"`,
          });
        }

        await client.query(
          `UPDATE products
           SET stock_quantity = stock_quantity - $1,
               in_stock = (stock_quantity - $1) > 0,
               updated_at = NOW()
           WHERE id = $2`,
          [item.quantity, item.productId]
        );
      }

      const orderResult = await client.query(
        `INSERT INTO orders (user_id, total, status, shipping_address)
         VALUES ($1, $2, 'pending', $3::jsonb)
         RETURNING id, user_id, status, total, shipping_address, created_at, updated_at`,
        [req.userId, total, JSON.stringify(shippingAddress)]
      );

      const order = orderResult.rows[0];

      for (const item of items) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, product_name, quantity, size, price)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            order.id,
            item.productId,
            item.product_name || 'Product',
            item.quantity,
            item.size || null,
            item.price,
          ]
        );
      }

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Order placed successfully',
        data: {
          order,
        },
      });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      next(error);
    } finally {
      if (client) client.release();
    }
  }
);

/**
 * Reviews
 */
router.get(
  '/reviews/:productId/me',
  [param('productId').isUUID().withMessage('Valid productId is required')],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const result = await query(
        `SELECT id, product_id, user_id, rating, title, content, created_at, updated_at
         FROM reviews
         WHERE product_id = $1 AND user_id = $2
         LIMIT 1`,
        [req.params.productId, req.userId]
      );

      res.json({
        success: true,
        data: {
          review: result.rows[0] || null,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/reviews',
  [
    body('productId').isUUID().withMessage('Valid productId is required'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
    body('title').optional({ nullable: true }).isString(),
    body('content').optional({ nullable: true }).isString(),
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const { productId, rating, title, content } = req.body;

      const result = await query(
        `INSERT INTO reviews (product_id, user_id, rating, title, content)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, product_id, user_id, rating, title, content, created_at, updated_at`,
        [productId, req.userId, rating, title || null, content || null]
      );

      res.status(201).json({
        success: true,
        message: 'Review submitted',
        data: {
          review: result.rows[0],
        },
      });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          success: false,
          error: 'You already reviewed this product',
        });
      }
      next(error);
    }
  }
);

export default router;
