const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * The backup file's time stamp, `YYYY-MM-DD-HHmm`, in THIS browser's local
 * time (rule 27): the server runs in UTC, so it is the client that says what
 * time it is for the shop. Matches `shopBackupQuerySchema`'s pattern.
 */
export function backupStamp(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
