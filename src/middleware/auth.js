import { verifyAccessToken } from '../config/jwt.js';
import { query } from '../config/database.js';

/**
 * Middleware to authenticate requests using JWT
 * Verifies the access token and attaches user info to req.user
 */
export const authenticate = async (req, res, next) => {
  try {
    // Get token from Authorization header or cookies
    let token = null;
    
    // Check Authorization header (Bearer token)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
    // Check cookies as fallback
    else if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please provide a valid token.',
      });
    }

    // Verify token
    const decoded = verifyAccessToken(token);

    // Get user from database
    const result = await query(
      `SELECT id, email, full_name, avatar_url, phone, email_verified, created_at 
       FROM users 
       WHERE id = $1 AND is_active = true`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'User not found or account is inactive.',
      });
    }

    // Attach user to request object
    req.user = result.rows[0];
    req.userId = decoded.userId;

    next();
  } catch (error) {
    if (error.message.includes('expired')) {
      return res.status(401).json({
        success: false,
        error: 'Token has expired. Please refresh your token.',
      });
    }
    
    return res.status(401).json({
      success: false,
      error: 'Invalid authentication token.',
    });
  }
};

/**
 * Middleware to check if user has admin role
 * Must be used after authenticate middleware
 */
export const requireAdmin = async (req, res, next) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
    }

    // Check if user has admin role
    const result = await query(
      `SELECT role FROM user_roles 
       WHERE user_id = $1 AND role = 'admin'`,
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required.',
      });
    }

    req.userRole = 'admin';
    next();
  } catch (error) {
    console.error('Admin check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Error checking admin privileges.',
    });
  }
};
