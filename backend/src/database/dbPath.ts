import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Resolve the database path for web mode.
 *
 * Precedence:
 * 1) process.env.DATABASE_PATH
 * 2) User-local config file: ~/Documents/LiraTek/db-path.txt
 * 3) Default legacy location (macOS): ~/Library/Application Support/liratek/phone_shop.db
 */
export function resolveDatabasePath(): string {
  if (process.env.DATABASE_PATH && process.env.DATABASE_PATH.trim()) {
    return process.env.DATABASE_PATH.trim();
  }

  const configPath = path.join(os.homedir(), 'Documents', 'LiraTek', 'db-path.txt');
  if (fs.existsSync(configPath)) {
    const p = fs.readFileSync(configPath, 'utf8').trim();
    if (p) return p;
  }

  // Default fallback (kept for backwards compatibility)
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'liratek',
      'phone_shop.db',
    );
  }

  // Cross-platform safe fallback
  return path.join(os.homedir(), 'Documents', 'LiraTek', 'liratek.db');
}
