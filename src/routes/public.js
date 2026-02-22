import express from 'express';
import { body, param, validationResult } from 'express-validator';
import { query } from '../config/database.js';
import { sendEmail } from '../services/emailService.js';

const router = express.Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

router.get('/products', async (req, res, next) => {
  try {
    const where = [];
    const params = [];

    const featuredRaw = req.query.featured;
    if (featuredRaw !== undefined) {
      if (featuredRaw === 'true' || featuredRaw === true) {
        params.push(true);
      } else if (featuredRaw === 'false' || featuredRaw === false) {
        params.push(false);
      } else {
        return res.status(400).json({
          success: false,
          error: 'featured must be true or false',
        });
      }
      where.push(`featured = $${params.length}`);
    }

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      if (search.length > 100) {
        return res.status(400).json({
          success: false,
          error: 'search must be 100 characters or less',
        });
      }
      params.push(`%${search}%`);
      where.push(
        `(name ILIKE $${params.length} OR category ILIKE $${params.length} OR COALESCE(description, '') ILIKE $${params.length})`
      );
    }

    const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
    const ids = idsParam
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (ids.length > 0) {
      const invalidId = ids.find((id) => !UUID_REGEX.test(id));
      if (invalidId) {
        return res.status(400).json({
          success: false,
          error: 'ids must be a comma separated list of UUIDs',
        });
      }

      params.push(ids);
      where.push(`id = ANY($${params.length}::uuid[])`);
    }

    const limitRaw = req.query.limit;
    let limit = null;
    if (limitRaw !== undefined) {
      limit = Number(limitRaw);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return res.status(400).json({
          success: false,
          error: 'limit must be an integer between 1 and 100',
        });
      }
    }

    let sql = `
      SELECT id, name, description, category, price, original_price, image_url, sizes, colors,
             in_stock, featured, stock_quantity, created_at, updated_at
      FROM products
    `;

    if (where.length > 0) {
      sql += ` WHERE ${where.join(' AND ')}`;
    }

    sql += ` ORDER BY created_at DESC`;

    if (limit) {
      params.push(limit);
      sql += ` LIMIT $${params.length}`;
    }

    const result = await query(sql, params);
    let products = result.rows;

    if (ids.length > 0) {
      const idOrder = new Map(ids.map((id, index) => [id, index]));
      products = [...products].sort((a, b) => {
        const aOrder = idOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const bOrder = idOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder;
      });
    }

    res.json({
      success: true,
      data: {
        products,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get(
  '/products/:productId',
  [param('productId').isUUID().withMessage('Valid productId is required')],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const result = await query(
        `SELECT id, name, description, category, price, original_price, image_url, sizes, colors,
                in_stock, featured, stock_quantity, created_at, updated_at
         FROM products
         WHERE id = $1
         LIMIT 1`,
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
        data: {
          product: result.rows[0],
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/products/:productId/reviews',
  [param('productId').isUUID().withMessage('Valid productId is required')],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const result = await query(
        `SELECT r.id, r.product_id, r.rating, r.title, r.content, r.created_at,
                COALESCE(p.full_name, 'Anonymous') AS reviewer_name
         FROM reviews r
         LEFT JOIN profiles p ON p.id = r.user_id
         WHERE r.product_id = $1
         ORDER BY r.created_at DESC`,
        [req.params.productId]
      );

      res.json({
        success: true,
        data: {
          reviews: result.rows,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/contact',
  [
    body('name')
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Name must be between 1 and 100 characters'),
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('subject')
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage('Subject must be between 1 and 200 characters'),
    body('message')
      .trim()
      .isLength({ min: 10, max: 5000 })
      .withMessage('Message must be between 10 and 5000 characters'),
  ],
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;

      const { name, email, subject, message } = req.body;

      const insertResult = await query(
        `INSERT INTO contact_inquiries (name, email, subject, message)
         VALUES ($1, $2, $3, $4)
         RETURNING id, created_at`,
        [name, email, subject, message]
      );

      const inquiry = insertResult.rows[0];

      const supportEmail =
        process.env.CONTACT_TO_EMAIL ||
        process.env.SUPPORT_EMAIL ||
        process.env.EMAIL_FROM ||
        process.env.EMAIL_USER ||
        null;

      if (supportEmail) {
        try {
          await sendEmail(
            supportEmail,
            `New contact inquiry: ${subject}`,
            `
              <p><strong>New contact inquiry received</strong></p>
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Subject:</strong> ${subject}</p>
              <p><strong>Message:</strong></p>
              <p>${message.replace(/\n/g, '<br/>')}</p>
            `,
            `New contact inquiry received\n\nName: ${name}\nEmail: ${email}\nSubject: ${subject}\n\nMessage:\n${message}`
          );
        } catch (error) {
          console.error('Failed to send support contact email:', error);
        }
      }

      try {
        await sendEmail(
          email,
          'We received your message - SoleMate',
          `
            <p>Hi ${name},</p>
            <p>Thanks for contacting SoleMate. We have received your message and will get back to you soon.</p>
            <p><strong>Your subject:</strong> ${subject}</p>
            <p>Reference ID: ${inquiry.id}</p>
          `,
          `Hi ${name},\n\nThanks for contacting SoleMate. We received your message and will get back to you soon.\n\nSubject: ${subject}\nReference ID: ${inquiry.id}`
        );
      } catch (error) {
        console.error('Failed to send customer acknowledgement email:', error);
      }

      res.status(201).json({
        success: true,
        message: 'Your message has been sent successfully.',
        data: {
          inquiryId: inquiry.id,
          createdAt: inquiry.created_at,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
