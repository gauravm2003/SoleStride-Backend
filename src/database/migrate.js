import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { query } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const runMigrations = async () => {
  try {
    console.log('🔄 Running database migrations...');

    const migrationsDir = join(__dirname, 'migrations');
    const migrationFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort(); // 001_, 002_, 003_...

    if (migrationFiles.length === 0) {
      console.log('ℹ️  No migration files found.');
      process.exit(0);
    }

    for (const file of migrationFiles) {
      const migrationPath = join(migrationsDir, file);
      console.log(`➡️  Applying migration: ${file}`);
      const migrationSQL = readFileSync(migrationPath, 'utf-8');
      await query(migrationSQL);
    }

    console.log('✅ Database migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

runMigrations();
