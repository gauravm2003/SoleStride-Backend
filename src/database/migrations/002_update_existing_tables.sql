-- Migration to update existing Supabase tables to reference our new users table
-- This should be run AFTER 001_create_users_table.sql

-- Note: Before running this migration, you may need to:
-- 1. Migrate existing users from auth.users to the new users table (if any)
-- 2. Update foreign key constraints

-- Update user_roles table foreign key if it references auth.users
-- First, drop the old foreign key constraint if it exists
DO $$
BEGIN
  -- Skip if table doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_roles'
  ) THEN
    RETURN;
  END IF;

  -- Check if constraint exists and drop it
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'user_roles_user_id_fkey' 
    AND table_name = 'user_roles'
  ) THEN
    ALTER TABLE user_roles DROP CONSTRAINT user_roles_user_id_fkey;
  END IF;
END $$;

-- Add new foreign key constraint to reference our users table
DO $$
BEGIN
  -- Skip if table doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_roles'
  ) THEN
    RETURN;
  END IF;

  -- Clean up any orphaned user_roles that reference non-existent users
  -- These typically come from old Supabase auth.users rows that we are not migrating
  DELETE FROM user_roles
  WHERE user_id NOT IN (SELECT id FROM users);

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'user_roles_user_id_fkey' 
    AND table_name = 'user_roles'
  ) THEN
    ALTER TABLE user_roles 
    ADD CONSTRAINT user_roles_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Update profiles table foreign key if it references auth.users
DO $$
BEGIN
  -- Skip if table doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    RETURN;
  END IF;

  -- Check if constraint exists and drop it
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'profiles_id_fkey' 
    AND table_name = 'profiles'
  ) THEN
    ALTER TABLE profiles DROP CONSTRAINT profiles_id_fkey;
  END IF;
END $$;

-- Add new foreign key constraint to reference our users table
DO $$
BEGIN
  -- Skip if table doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    RETURN;
  END IF;

  -- Remove any profiles that don't have a corresponding user in our new users table
  DELETE FROM profiles
  WHERE id NOT IN (SELECT id FROM users);

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'profiles_id_fkey' 
    AND table_name = 'profiles'
  ) THEN
    ALTER TABLE profiles 
    ADD CONSTRAINT profiles_id_fkey 
    FOREIGN KEY (id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Update orders table foreign key if it references auth.users
DO $$
BEGIN
  -- Skip if table doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'orders'
  ) THEN
    RETURN;
  END IF;

  -- Check if constraint exists and drop it
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'orders_user_id_fkey' 
    AND table_name = 'orders'
  ) THEN
    ALTER TABLE orders DROP CONSTRAINT orders_user_id_fkey;
  END IF;
END $$;

-- Add new foreign key constraint to reference our users table
DO $$
BEGIN
  -- Skip if table doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'orders'
  ) THEN
    RETURN;
  END IF;

  -- Remove any orders that reference users that no longer exist in our new users table
  DELETE FROM orders
  WHERE user_id NOT IN (SELECT id FROM users);

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'orders_user_id_fkey' 
    AND table_name = 'orders'
  ) THEN
    ALTER TABLE orders 
    ADD CONSTRAINT orders_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Note: If you have existing users in auth.users that you want to migrate:
-- You'll need to create a script to:
-- 1. Copy user data from auth.users to users table
-- 2. Generate password hashes (you'll need to ask users to reset passwords, or use a migration script)
-- 3. Update all foreign key references
