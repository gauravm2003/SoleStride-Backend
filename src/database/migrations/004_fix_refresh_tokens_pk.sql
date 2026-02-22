-- Fix refresh_tokens schema created by older migration versions
-- Goal: allow ON CONFLICT (user_id) upsert pattern and keep token unique

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'refresh_tokens'
  ) THEN
    -- Drop existing primary key if present (name may vary, but default is refresh_tokens_pkey)
    IF EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_name = 'refresh_tokens'
        AND constraint_type = 'PRIMARY KEY'
    ) THEN
      ALTER TABLE refresh_tokens DROP CONSTRAINT IF EXISTS refresh_tokens_pkey;
    END IF;

    -- Ensure user_id is NOT NULL
    ALTER TABLE refresh_tokens ALTER COLUMN user_id SET NOT NULL;

    -- Ensure token is NOT NULL
    ALTER TABLE refresh_tokens ALTER COLUMN token SET NOT NULL;

    -- Ensure unique constraint on token
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_name = 'refresh_tokens'
        AND constraint_type = 'UNIQUE'
        AND constraint_name = 'refresh_tokens_token_key'
    ) THEN
      ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_token_key UNIQUE (token);
    END IF;

    -- Set primary key to user_id (one refresh token row per user)
    ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (user_id);
  END IF;
END $$;

