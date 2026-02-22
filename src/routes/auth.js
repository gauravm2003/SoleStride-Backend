import express from 'express';
import { body, validationResult } from 'express-validator';
import { 
  authenticateUser, 
  createUser, 
  updateUserPassword, 
  updateUserProfile,
  emailExists,
  verifyEmail,
  verifyEmailByToken,
  resendVerificationCode,
  requestPasswordReset,
  resetPasswordWithCode
} from '../services/userService.js';
import { verifyRefreshToken, generateAccessToken } from '../config/jwt.js';
import { query } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

/**
 * Register new user
 * POST /api/auth/register
 */
router.post(
  '/register',
  authLimiter,
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters long'),
    body('fullName')
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Full name must be less than 100 characters'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: errors.array()[0].msg,
        });
      }

      const { email, password, fullName } = req.body;

      // Check if email already exists
      if (await emailExists(email)) {
        return res.status(409).json({
          success: false,
          error: 'Email is already registered. Please log in instead.',
        });
      }

      // Create user
      const result = await createUser(email, password, fullName);

      res.status(201).json({
        success: true,
        message: 'Account created successfully. Please check your email for verification link.',
        data: {
          user: result.user,
          emailVerificationRequired: !result.user.email_verified,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Login user
 * POST /api/auth/login
 */
router.post(
  '/login',
  authLimiter,
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('password')
      .notEmpty()
      .withMessage('Password is required'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: errors.array()[0].msg,
        });
      }

      const { email, password } = req.body;

      // Authenticate user
      const result = await authenticateUser(email, password);

      // Set refresh token as HTTP-only cookie
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: result.user,
          accessToken: result.accessToken,
        },
      });
    } catch (error) {
      if (
        error.message.includes('Invalid') ||
        error.message.includes('inactive') ||
        error.message.includes('verify')
      ) {
        return res.status(401).json({
          success: false,
          error: error.message,
        });
      }
      next(error);
    }
  }
);

/**
 * Logout user
 * POST /api/auth/logout
 */
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    // Delete refresh token from database
    await query(
      `DELETE FROM refresh_tokens WHERE user_id = $1`,
      [req.userId]
    );

    // Clear refresh token cookie
    res.clearCookie('refreshToken');

    res.json({
      success: true,
      message: 'Logout successful',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Refresh access token
 * POST /api/auth/refresh
 */
router.post('/refresh', async (req, res, next) => {
  try {
    // Get refresh token from cookie or body
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token is required',
      });
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);

    // Check if refresh token exists in database and is valid
    const result = await query(
      `SELECT user_id, expires_at 
       FROM refresh_tokens 
       WHERE user_id = $1 AND token = $2`,
      [decoded.userId, refreshToken]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid refresh token',
      });
    }

    const tokenData = result.rows[0];
    const expiresAt = new Date(tokenData.expires_at);

    if (expiresAt < new Date()) {
      // Token expired, delete it
      await query(
        `DELETE FROM refresh_tokens WHERE user_id = $1`,
        [decoded.userId]
      );
      return res.status(401).json({
        success: false,
        error: 'Refresh token has expired',
      });
    }

    // Check if user is still active
    const userResult = await query(
      `SELECT id, email_verified
       FROM users
       WHERE id = $1 AND is_active = true`,
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'User account is inactive',
      });
    }

    if (!userResult.rows[0].email_verified) {
      await query(
        `DELETE FROM refresh_tokens WHERE user_id = $1`,
        [decoded.userId]
      );
      return res.status(401).json({
        success: false,
        error: 'Please verify your email before logging in.',
      });
    }

    // Generate new access token
    const accessToken = generateAccessToken({ userId: decoded.userId });

    res.json({
      success: true,
      data: {
        accessToken,
      },
    });
  } catch (error) {
    if (error.message.includes('expired') || error.message.includes('Invalid')) {
      return res.status(401).json({
        success: false,
        error: error.message,
      });
    }
    next(error);
  }
});

/**
 * Get current user
 * GET /api/auth/me
 */
router.get('/me', authenticate, async (req, res) => {
  res.json({
    success: true,
    data: {
      user: req.user,
    },
  });
});

/**
 * Check current user's role
 * GET /api/auth/has-role?role=admin
 */
router.get('/has-role', authenticate, async (req, res, next) => {
  try {
    const role = String(req.query.role || '').trim();
    if (!role) {
      return res.status(400).json({
        success: false,
        error: 'Role is required',
      });
    }

    const result = await query(
      `SELECT 1
       FROM user_roles
       WHERE user_id = $1 AND role = $2
       LIMIT 1`,
      [req.userId, role]
    );

    res.json({
      success: true,
      data: {
        hasRole: result.rows.length > 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Update current user's profile fields
 * PATCH /api/auth/profile
 */
router.patch(
  '/profile',
  authenticate,
  [
    body('full_name').optional({ nullable: true }).isLength({ max: 100 }).withMessage('Full name must be less than 100 characters'),
    body('phone').optional({ nullable: true }).isLength({ max: 30 }).withMessage('Phone must be less than 30 characters'),
    body('avatar_url').optional({ nullable: true }).isURL().withMessage('Avatar URL must be valid'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: errors.array()[0].msg,
        });
      }

      const updates = {
        full_name: req.body.full_name,
        phone: req.body.phone,
        avatar_url: req.body.avatar_url,
      };

      const user = await updateUserProfile(req.userId, updates);

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          user,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Request password reset
 * POST /api/auth/forgot-password
 */
router.post(
  '/forgot-password',
  authLimiter,
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: errors.array()[0].msg,
        });
      }

      const { email } = req.body;

      // Request password reset (sends email with code)
      try {
        await requestPasswordReset(email);
      } catch (error) {
        // Log error but don't reveal if email exists
        console.error('Password reset error:', error);
      }

      // Always return success to prevent email enumeration
      res.json({
        success: true,
        message: 'If an account with that email exists, a password reset code has been sent.',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Reset password with code (from forgot-password flow)
 * POST /api/auth/reset-password
 */
router.post(
  '/reset-password',
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('code')
      .isLength({ min: 6, max: 6 })
      .withMessage('Verification code must be 6 digits'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters long'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: errors.array()[0].msg,
        });
      }

      const { email, code, password } = req.body;

      await resetPasswordWithCode(email, code, password);

      res.json({
        success: true,
        message: 'Password reset successfully. You can now login with your new password.',
      });
    } catch (error) {
      if (error.message.includes('Invalid') || error.message.includes('expired') || error.message.includes('not found')) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }
      next(error);
    }
  }
);

/**
 * Update password (for authenticated users)
 * POST /api/auth/update-password
 */
router.post(
  '/update-password',
  authenticate,
  [
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters long'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: errors.array()[0].msg,
        });
      }

      const { password } = req.body;

      await updateUserPassword(req.userId, password);

      res.json({
        success: true,
        message: 'Password updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Verify email with code
 * POST /api/auth/verify-email
 */
router.post(
  '/verify-email',
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('code')
      .isLength({ min: 6, max: 6 })
      .withMessage('Verification code must be 6 digits'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: errors.array()[0].msg,
        });
      }

      const { email, code } = req.body;

      await verifyEmail(email, code);

      res.json({
        success: true,
        message: 'Email verified successfully',
      });
    } catch (error) {
      if (error.message.includes('Invalid') || error.message.includes('expired') || error.message.includes('already verified') || error.message.includes('not found')) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }
      next(error);
    }
  }
);

/**
 * Resend verification code
 * POST /api/auth/resend-verification
 */
router.post(
  '/resend-verification',
  authLimiter,
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: errors.array()[0].msg,
        });
      }

      const { email } = req.body;

      await resendVerificationCode(email);

      res.json({
        success: true,
        message: 'Verification email sent. Please check your inbox.',
      });
    } catch (error) {
      if (error.message.includes('already verified') || error.message.includes('not found')) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }
      next(error);
    }
  }
);

/**
 * Verify email via link
 * GET /api/auth/verify-email-link?token=...
 */
router.get('/verify-email-link', async (req, res, next) => {
  try {
    const token = req.query.token;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Verification token is required',
      });
    }

    const frontendBase =
      process.env.FRONTEND_URL ||
      process.env.CORS_ORIGIN ||
      'http://localhost:8080';
    const frontendUrl = frontendBase.replace(/\/+$/, '');

    try {
      await verifyEmailByToken(token);
      // Redirect to frontend with success flag
      return res.redirect(
        302,
        `${frontendUrl}/auth?verified=1`
      );
    } catch (error) {
      // Redirect to frontend with failure flag and optional message
      const reason = encodeURIComponent(error.message || 'Verification failed');
      return res.redirect(
        302,
        `${frontendUrl}/auth?verified=0&reason=${reason}`
      );
    }
  } catch (error) {
    next(error);
  }
});

export default router;
