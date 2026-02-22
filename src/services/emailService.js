import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

// Create transporter based on environment
const createTransporter = () => {
  // For development, you can use Gmail or other SMTP services
  // For production, use a proper email service like SendGrid, AWS SES, etc.
  
  if (process.env.EMAIL_SERVICE === 'gmail') {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.warn('⚠️  Gmail email service configured but EMAIL_USER or EMAIL_PASSWORD not set');
      return null;
    }
    
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD, // Use App Password for Gmail
      },
    });
  }

  // Generic SMTP configuration
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    console.warn('⚠️  SMTP email service configured but SMTP_HOST, SMTP_USER, or SMTP_PASSWORD not set');
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
};

const transporter = createTransporter();

// Verify transporter connection (optional, for testing)
if (transporter) {
  transporter.verify((error, success) => {
    if (error) {
      console.error('❌ Email transporter verification failed:', error.message);
      console.error('   Please check your email configuration in .env');
    } else {
      console.log('✅ Email transporter verified successfully');
    }
  });
} else {
  console.warn('⚠️  Email service not configured. Email sending will be disabled.');
  console.warn('   Please configure email settings in .env (see EMAIL_SETUP.md)');
}

// Email templates
const emailTemplates = {
  /**
   * Email verification link template
   */
  verificationCode: (link, name) => ({
    subject: 'Verify Your Email - SoleMate',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">SoleMate</h1>
        </div>
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <h2 style="color: #333; margin-top: 0;">Verify Your Email Address</h2>
          <p>Hello ${name || 'there'},</p>
          <p>Thank you for signing up for SoleMate! To complete your registration, please verify your email address by clicking the button below:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${link}" style="display: inline-block; padding: 12px 24px; background: #667eea; color: #fff; text-decoration: none; border-radius: 999px; font-weight: bold;">
              Verify Email
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="color: #666; font-size: 12px; word-break: break-all;">${link}</p>
          <p style="color: #666; font-size: 14px;">This link will expire in 15 minutes.</p>
          <p style="color: #666; font-size: 14px;">If you didn't create an account with SoleMate, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
          <p style="color: #999; font-size: 12px; text-align: center;">
            © ${new Date().getFullYear()} SoleMate. All rights reserved.
          </p>
        </div>
      </body>
      </html>
    `,
    text: `
      Verify Your Email Address - SoleMate
      
      Hello ${name || 'there'},
      
      Thank you for signing up for SoleMate! To complete your registration, please verify your email address by opening the link below:
      
      Verification Link: ${link}
      
      This link will expire in 15 minutes.
      
      If you didn't create an account with SoleMate, you can safely ignore this email.
      
      © ${new Date().getFullYear()} SoleMate. All rights reserved.
    `,
  }),

  /**
   * Password reset code template
   */
  passwordResetCode: (code, name) => ({
    subject: 'Reset Your Password - SoleMate',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Password</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">SoleMate</h1>
        </div>
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <h2 style="color: #333; margin-top: 0;">Reset Your Password</h2>
          <p>Hello ${name || 'there'},</p>
          <p>We received a request to reset your password. Use the code below to reset your password:</p>
          <div style="background: white; border: 2px dashed #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #667eea; font-family: 'Courier New', monospace;">
              ${code}
            </div>
          </div>
          <p style="color: #666; font-size: 14px;">This code will expire in 15 minutes.</p>
          <p style="color: #ff6b6b; font-size: 14px;"><strong>If you didn't request a password reset, please ignore this email or contact support if you have concerns.</strong></p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
          <p style="color: #999; font-size: 12px; text-align: center;">
            © ${new Date().getFullYear()} SoleMate. All rights reserved.
          </p>
        </div>
      </body>
      </html>
    `,
    text: `
      Reset Your Password - SoleMate
      
      Hello ${name || 'there'},
      
      We received a request to reset your password. Use the code below to reset your password:
      
      Reset Code: ${code}
      
      This code will expire in 15 minutes.
      
      If you didn't request a password reset, please ignore this email or contact support if you have concerns.
      
      © ${new Date().getFullYear()} SoleMate. All rights reserved.
    `,
  }),
};

/**
 * Send email using nodemailer
 */
export const sendEmail = async (to, subject, html, text) => {
  if (!transporter) {
    console.error('Email transporter not configured. Cannot send email.');
    throw new Error('Email service is not configured. Please contact support.');
  }

  try {
    const mailOptions = {
      from: `"SoleMate" <${process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@solemate.com'}>`,
      to,
      subject,
      html,
      text,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Error sending email:', error);
    throw new Error('Failed to send email. Please try again later.');
  }
};

/**
 * Send email verification code
 */
export const sendVerificationCode = async (email, link, name) => {
  const template = emailTemplates.verificationCode(link, name);
  return await sendEmail(email, template.subject, template.html, template.text);
};

/**
 * Send password reset code
 */
export const sendPasswordResetCode = async (email, code, name) => {
  const template = emailTemplates.passwordResetCode(code, name);
  return await sendEmail(email, template.subject, template.html, template.text);
};

/**
 * Generate a random 6-digit verification code
 */
export const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Generate a secure random email verification token (for link-based verification)
 */
export const generateVerificationToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

export default {
  sendEmail,
  sendVerificationCode,
  sendPasswordResetCode,
  generateVerificationCode,
  generateVerificationToken,
};
