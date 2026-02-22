import bcrypt from 'bcryptjs';
import { getClient, query } from '../config/database.js';
import { generateAccessToken, generateRefreshToken } from '../config/jwt.js';
import { generateVerificationCode, generateVerificationToken, sendVerificationCode, sendPasswordResetCode } from './emailService.js';

/**
 * Create a new user
 */
export const createUser = async (email, password, fullName = null) => {
  // Hash password
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  // Generate verification token for email verification link
  const verificationToken = generateVerificationToken();
  const tokenExpiresAt = new Date();
  tokenExpiresAt.setMinutes(tokenExpiresAt.getMinutes() + 15); // 15 minutes expiry

  // Build verification link (backend endpoint that will verify and redirect to frontend)
  const appUrl =
    process.env.APP_URL ||
    process.env.BACKEND_URL ||
    `http://localhost:${process.env.PORT || 3001}`;
  const verifyLinkBase = appUrl.replace(/\/+$/, '');
  const verifyLink = `${verifyLinkBase}/api/auth/verify-email-link?token=${verificationToken}`;

  const client = await getClient();
  let user;

  try {
    await client.query('BEGIN');

    // Insert user (email not verified initially)
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, full_name, is_active, email_verified, verification_code, verification_code_expires_at)
       VALUES ($1, $2, $3, true, false, $4, $5)
       RETURNING id, email, full_name, avatar_url, phone, email_verified, created_at`,
      [email.toLowerCase().trim(), hashedPassword, fullName, verificationToken, tokenExpiresAt]
    );

    user = userResult.rows[0];

    // Create default user role
    await client.query(
      `INSERT INTO user_roles (user_id, role)
       VALUES ($1, 'user')
       ON CONFLICT (user_id, role) DO NOTHING`,
      [user.id]
    );

    // Create profile entry
    await client.query(
      `INSERT INTO profiles (id, email, full_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET email = $2`,
      [user.id, user.email, user.full_name]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // Send verification email after commit so registration does not hold a DB transaction
  try {
    await sendVerificationCode(user.email, verifyLink, user.full_name);
  } catch (error) {
    console.error('Failed to send verification email:', error);
    // Don't fail registration if email fails, but log it
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      avatar_url: user.avatar_url,
      phone: user.phone,
      email_verified: user.email_verified,
    },
  };
};

/**
 * Authenticate user and return tokens
 */
export const authenticateUser = async (email, password) => {
  // Get user with password hash
  const result = await query(
    `SELECT id, email, password_hash, full_name, avatar_url, phone, is_active, email_verified, created_at
     FROM users
     WHERE email = $1`,
    [email.toLowerCase().trim()]
  );

  if (result.rows.length === 0) {
    throw new Error('Invalid email or password');
  }

  const user = result.rows[0];

  if (!user.is_active) {
    throw new Error('Account is inactive. Please contact support.');
  }

  if (!user.email_verified) {
    throw new Error('Please verify your email before logging in.');
  }

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.password_hash);
  if (!isPasswordValid) {
    throw new Error('Invalid email or password');
  }

  // Generate tokens
  const accessToken = generateAccessToken({ userId: user.id });
  const refreshToken = generateRefreshToken({ userId: user.id });

  // Store refresh token
  await query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')
     ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = NOW() + INTERVAL '7 days'`,
    [user.id, refreshToken]
  );

  return {
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      avatar_url: user.avatar_url,
      phone: user.phone,
      email_verified: user.email_verified,
    },
    accessToken,
    refreshToken,
  };
};

/**
 * Get user by ID
 */
export const getUserById = async (userId) => {
  const result = await query(
    `SELECT id, email, full_name, avatar_url, phone, email_verified, created_at
     FROM users
     WHERE id = $1 AND is_active = true`,
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
};

/**
 * Update user password
 */
export const updateUserPassword = async (userId, newPassword) => {
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

  await query(
    `UPDATE users
     SET password_hash = $1, updated_at = NOW()
     WHERE id = $2`,
    [hashedPassword, userId]
  );
};

/**
 * Update user profile
 */
export const updateUserProfile = async (userId, updates) => {
  const allowedFields = ['full_name', 'phone', 'avatar_url'];
  const fields = [];
  const values = [];
  let paramCount = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      fields.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }
  }

  if (fields.length === 0) {
    throw new Error('No valid fields to update');
  }

  values.push(userId);

  await query(
    `UPDATE users
     SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${paramCount}`,
    values
  );

  // Also update profiles table
  if (updates.full_name !== undefined || updates.phone !== undefined || updates.avatar_url !== undefined) {
    const profileFields = [];
    const profileValues = [];
    let profileParamCount = 1;

    if (updates.full_name !== undefined) {
      profileFields.push(`full_name = $${profileParamCount}`);
      profileValues.push(updates.full_name);
      profileParamCount++;
    }
    if (updates.phone !== undefined) {
      profileFields.push(`phone = $${profileParamCount}`);
      profileValues.push(updates.phone);
      profileParamCount++;
    }
    if (updates.avatar_url !== undefined) {
      profileFields.push(`avatar_url = $${profileParamCount}`);
      profileValues.push(updates.avatar_url);
      profileParamCount++;
    }

    profileValues.push(userId);

    await query(
      `UPDATE profiles
       SET ${profileFields.join(', ')}, updated_at = NOW()
       WHERE id = $${profileParamCount}`,
      profileValues
    );
  }

  return getUserById(userId);
};

/**
 * Check if email exists
 */
export const emailExists = async (email) => {
  const result = await query(
    `SELECT id FROM users WHERE email = $1`,
    [email.toLowerCase().trim()]
  );
  return result.rows.length > 0;
};

/**
 * Verify email with verification code
 */
export const verifyEmail = async (email, code) => {
  const result = await query(
    `SELECT id, verification_code, verification_code_expires_at, email_verified
     FROM users
     WHERE email = $1`,
    [email.toLowerCase().trim()]
  );

  if (result.rows.length === 0) {
    throw new Error('User not found');
  }

  const user = result.rows[0];

  if (user.email_verified) {
    throw new Error('Email is already verified');
  }

  if (!user.verification_code) {
    throw new Error('No verification code found. Please request a new one.');
  }

  if (user.verification_code !== code) {
    throw new Error('Invalid verification code');
  }

  const expiresAt = new Date(user.verification_code_expires_at);
  if (expiresAt < new Date()) {
    throw new Error('Verification code has expired. Please request a new one.');
  }

  // Mark email as verified and clear verification code
  await query(
    `UPDATE users
     SET email_verified = true, verification_code = NULL, verification_code_expires_at = NULL, updated_at = NOW()
     WHERE id = $1`,
    [user.id]
  );

  return { success: true };
};

/**
 * Verify email using verification token from link
 */
export const verifyEmailByToken = async (token) => {
  const result = await query(
    `SELECT id, email, verification_code, verification_code_expires_at, email_verified
     FROM users
     WHERE verification_code = $1`,
    [token]
  );

  if (result.rows.length === 0) {
    throw new Error('Invalid or expired verification link');
  }

  const user = result.rows[0];

  if (user.email_verified) {
    // Already verified - no error, just return
    return { success: true };
  }

  if (!user.verification_code) {
    throw new Error('No verification token found. Please request a new verification email.');
  }

  const expiresAt = new Date(user.verification_code_expires_at);
  if (expiresAt < new Date()) {
    throw new Error('Verification link has expired. Please request a new verification email.');
  }

  await query(
    `UPDATE users
     SET email_verified = true, verification_code = NULL, verification_code_expires_at = NULL, updated_at = NOW()
     WHERE id = $1`,
    [user.id]
  );

  return { success: true };
};

/**
 * Resend verification code
 */
export const resendVerificationCode = async (email) => {
  const result = await query(
    `SELECT id, email, full_name, email_verified
     FROM users
     WHERE email = $1`,
    [email.toLowerCase().trim()]
  );

  if (result.rows.length === 0) {
    throw new Error('User not found');
  }

  const user = result.rows[0];

  if (user.email_verified) {
    throw new Error('Email is already verified');
  }

  // Generate new verification token
  const verificationToken = generateVerificationToken();
  const tokenExpiresAt = new Date();
  tokenExpiresAt.setMinutes(tokenExpiresAt.getMinutes() + 15); // 15 minutes expiry

  // Update user with new code
  await query(
    `UPDATE users
     SET verification_code = $1, verification_code_expires_at = $2, updated_at = NOW()
     WHERE id = $3`,
    [verificationToken, tokenExpiresAt, user.id]
  );

  // Send verification email
  const appUrl =
    process.env.APP_URL ||
    process.env.BACKEND_URL ||
    `http://localhost:${process.env.PORT || 3001}`;
  const verifyLinkBase = appUrl.replace(/\/+$/, '');
  const verifyLink = `${verifyLinkBase}/api/auth/verify-email-link?token=${verificationToken}`;

  await sendVerificationCode(user.email, verifyLink, user.full_name);

  return { success: true };
};

/**
 * Request password reset (sends reset code via email)
 */
export const requestPasswordReset = async (email) => {
  const result = await query(
    `SELECT id, email, full_name
     FROM users
     WHERE email = $1 AND is_active = true`,
    [email.toLowerCase().trim()]
  );

  if (result.rows.length === 0) {
    // Don't reveal if email exists for security
    return { success: true };
  }

  const user = result.rows[0];

  // Generate password reset code
  const resetCode = generateVerificationCode();
  const codeExpiresAt = new Date();
  codeExpiresAt.setMinutes(codeExpiresAt.getMinutes() + 15); // 15 minutes expiry

  // Update user with reset code
  await query(
    `UPDATE users
     SET password_reset_code = $1, password_reset_code_expires_at = $2, updated_at = NOW()
     WHERE id = $3`,
    [resetCode, codeExpiresAt, user.id]
  );

  // Send password reset email
  try {
    await sendPasswordResetCode(user.email, resetCode, user.full_name);
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    throw new Error('Failed to send password reset email. Please try again later.');
  }

  return { success: true };
};

/**
 * Reset password with reset code
 */
export const resetPasswordWithCode = async (email, code, newPassword) => {
  const result = await query(
    `SELECT id, password_reset_code, password_reset_code_expires_at
     FROM users
     WHERE email = $1 AND is_active = true`,
    [email.toLowerCase().trim()]
  );

  if (result.rows.length === 0) {
    throw new Error('Invalid email or code');
  }

  const user = result.rows[0];

  if (!user.password_reset_code) {
    throw new Error('No password reset code found. Please request a new one.');
  }

  if (user.password_reset_code !== code) {
    throw new Error('Invalid password reset code');
  }

  const expiresAt = new Date(user.password_reset_code_expires_at);
  if (expiresAt < new Date()) {
    throw new Error('Password reset code has expired. Please request a new one.');
  }

  // Hash new password
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

  // Update password and clear reset code
  await query(
    `UPDATE users
     SET password_hash = $1, password_reset_code = NULL, password_reset_code_expires_at = NULL, updated_at = NOW()
     WHERE id = $2`,
    [hashedPassword, user.id]
  );

  return { success: true };
};
