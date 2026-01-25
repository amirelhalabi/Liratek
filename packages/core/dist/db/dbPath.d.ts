export type DbPathResolutionSource = 'env:DATABASE_PATH' | 'file:db-path.txt' | 'default:macOS-application-support' | 'default:documents';
export interface ResolvedDbPath {
    path: string;
    source: DbPathResolutionSource;
    configFile?: string;
}
/**
 * Shared database path resolver used by both Desktop and Web.
 *
 * Resolution order:
 * 1) DATABASE_PATH env var
 * 2) ~/Documents/LiraTek/db-path.txt (one-line absolute path)
 * 3) macOS fallback: ~/Library/Application Support/liratek/phone_shop.db
 * 4) Cross-platform fallback: ~/Documents/LiraTek/liratek.db
 */
export declare function resolveDatabasePath(): ResolvedDbPath;
