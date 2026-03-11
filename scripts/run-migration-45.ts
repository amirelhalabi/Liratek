import Database from 'better-sqlite3';
import { resolveDatabasePath } from '@liratek/core';

const dbPathInfo = resolveDatabasePath();
console.log(`Using database: ${dbPathInfo.path} (${dbPathInfo.source})`);

const db = new Database(dbPathInfo.path);

console.log('Running migration v45: remove_reports_transactions_modules...');

try {
  // Remove modules
  db.exec(`DELETE FROM modules WHERE key IN ('reports', 'transactions')`);
  console.log('✓ Removed modules from modules table');
  
  // Remove from currency_modules junction
  db.exec(`DELETE FROM currency_modules WHERE module_key IN ('reports', 'transactions')`);
  console.log('✓ Removed modules from currency_modules table');
  
  // Verify
  const remaining = db.prepare(`SELECT key, label FROM modules WHERE key IN ('reports', 'transactions')`).all();
  if (remaining.length === 0) {
    console.log('✅ Migration completed successfully!');
  } else {
    console.log('❌ Migration failed - modules still exist:', remaining);
  }
} catch (error) {
  console.error('❌ Migration error:', error);
} finally {
  db.close();
}
