export interface GeneratePdfResult {
    success: boolean;
    path?: string;
    error?: string;
}
export interface BackupResult {
    success: boolean;
    path?: string;
    error?: string;
}
export interface ListBackupsResult {
    success: boolean;
    backups?: Array<{
        path: string;
        filename: string;
        createdAtMs: number;
    }>;
    error?: string;
}
export interface RestoreDbResult {
    success: boolean;
    error?: string;
}
export interface VerifyBackupResult {
    success: boolean;
    ok?: boolean;
    error?: string;
}
export declare class ReportService {
    private getBackupsDir;
    private getDbPath;
    /**
     * Generate a PDF from HTML content
     */
    generatePdf(html: string, filename?: string): Promise<GeneratePdfResult>;
    /**
     * Backup the database to Documents/LiratekBackups
     */
    backupDatabase(): Promise<BackupResult>;
    /**
     * List backups in Documents/LiratekBackups
     */
    listBackups(): Promise<ListBackupsResult>;
    /**
     * Remove older backups, keeping the most recent `keepCount`.
     */
    pruneBackups(keepCount?: number): Promise<{
        success: boolean;
        deleted?: number;
        error?: string;
    }>;
    /**
     * Verify a backup file using PRAGMA integrity_check.
     */
    verifyBackup(backupPath: string): Promise<VerifyBackupResult>;
    /**
     * Restore the DB from a backup file.
     * Note: caller should quit/relaunch after restore.
     */
    restoreDatabaseFromBackup(backupPath: string): Promise<RestoreDbResult>;
}
