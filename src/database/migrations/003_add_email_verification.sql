-- Migration to add email verification fields to existing users table
-- This migration adds columns if they don't exist (safe to run multiple times)

DO $$
BEGIN
  -- Add email_verified column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'email_verified'
  ) THEN
    ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT false;
  END IF;

  -- Add verification_code column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'verification_code'
  ) THEN
    ALTER TABLE users ADD COLUMN verification_code TEXT;
  END IF;

  -- Add verification_code_expires_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'verification_code_expires_at'
  ) THEN
    ALTER TABLE users ADD COLUMN verification_code_expires_at TIMESTAMP WITH TIME ZONE;
  END IF;

  -- Add password_reset_code column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'password_reset_code'
  ) THEN
    ALTER TABLE users ADD COLUMN password_reset_code TEXT;
  END IF;

  -- Add password_reset_code_expires_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'password_reset_code_expires_at'
  ) THEN
    ALTER TABLE users ADD COLUMN password_reset_code_expires_at TIMESTAMP WITH TIME ZONE;
  END IF;
END $$;

-- Create index for verification codes
CREATE INDEX IF NOT EXISTS idx_users_verification_code ON users(verification_code);
CREATE INDEX IF NOT EXISTS idx_users_password_reset_code ON users(password_reset_code);
