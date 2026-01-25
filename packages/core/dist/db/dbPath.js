import fs from 'fs';
import os from 'os';
import path from 'path';
/**
 * Shared database path resolver used by both Desktop and Web.
 *
 * Resolution order:
 * 1) DATABASE_PATH env var
 * 2) ~/Documents/LiraTek/db-path.txt (one-line absolute path)
 * 3) macOS fallback: ~/Library/Application Support/liratek/phone_shop.db
 * 4) Cross-platform fallback: ~/Documents/LiraTek/liratek.db
 */
export function resolveDatabasePath() {
    const env = process.env.DATABASE_PATH?.trim();
    if (env) {
        return { path: env, source: 'env:DATABASE_PATH' };
    }
    const configFile = path.join(os.homedir(), 'Documents', 'LiraTek', 'db-path.txt');
    if (fs.existsSync(configFile)) {
        const p = fs.readFileSync(configFile, 'utf8').trim();
        if (p) {
            return { path: p, source: 'file:db-path.txt', configFile };
        }
    }
    if (process.platform === 'darwin') {
        return {
            path: path.join(os.homedir(), 'Library', 'Application Support', 'liratek', 'phone_shop.db'),
            source: 'default:macOS-application-support',
        };
    }
    return {
        path: path.join(os.homedir(), 'Documents', 'LiraTek', 'liratek.db'),
        source: 'default:documents',
    };
}
