import { getDatabase } from "./db";

let syncTimer: NodeJS.Timeout | null = null;

export function startSyncProcessor() {
  const enabled = process.env.SYNC_ENABLED !== "false";
  if (!enabled) {
    console.log("[SYNC] Disabled by env (SYNC_ENABLED=false).");
    return;
  }

  const intervalMs = Number(process.env.SYNC_INTERVAL_MS || 300000); // default 5 minutes
  console.log(`[SYNC] Starting processor, interval=${intervalMs}ms`);

  const runOnce = async () => {
    try {
      const db = getDatabase();
      const batch = db
        .prepare(
          `SELECT id, table_name, record_id, action_type, payload_json, created_at
         FROM sync_queue
         ORDER BY created_at ASC
         LIMIT 50`,
        )
        .all() as Array<{
        id: number;
        table_name: string;
        record_id: number;
        action_type: string;
        payload_json: string;
        created_at: string;
      }>;

      if (batch.length === 0) {
        console.log("[SYNC] No items to sync.");
        return;
      }

      // Upload if endpoint configured
      const endpoint = process.env.SYNC_ENDPOINT;
      let uploaded = false;
      if (endpoint) {
        const payload = { items: batch };
        let attempt = 0;
        const maxAttempts = 3;
        while (attempt < maxAttempts && !uploaded) {
          attempt++;
          try {
            // Node 18+ has fetch
            const res = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            if (res.ok) {
              uploaded = true;
              break;
            } else {
              throw new Error(`HTTP ${res.status}`);
            }
          } catch (_e) {
            const delay = 500 * Math.pow(2, attempt - 1);
            console.warn(
              `[SYNC] Upload attempt ${attempt} failed, retrying in ${delay}ms`,
            );
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      } else {
        console.log(
          "[SYNC] No SYNC_ENDPOINT configured; skipping upload (noop).",
        );
        uploaded = true;
      }

      if (!uploaded) {
        console.error(
          "[SYNC] Failed to upload after retries; will retry next interval",
        );
        try {
          const db = getDatabase();
          db.prepare(
            `INSERT INTO sync_errors (endpoint, payload_json, error) VALUES (?, ?, ?)`,
          ).run(endpoint || "N/A", JSON.stringify(batch), "UploadFailed");
        } catch {}
        return;
      }

      // Optionally pull updates
      const pull = process.env.SYNC_PULL_ENDPOINT;
      if (pull) {
        try {
          const res = await fetch(pull);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          // In a real implementation we would apply updates here
        } catch (e) {
          try {
            const db = getDatabase();
            db.prepare(
              `INSERT INTO sync_errors (endpoint, payload_json, error) VALUES (?, ?, ?)`,
            ).run(pull, "", (e instanceof Error ? e.message : "PullFailed"));
          } catch {}
        }
      }

      // Mark as synced (delete from queue for now)
      const del = db.prepare("DELETE FROM sync_queue WHERE id = ?");
      const tx = db.transaction((items: typeof batch) => {
        for (const item of items) {
          del.run(item.id);
        }
      });
      tx(batch);

      console.log("[SYNC] Batch processed and removed from queue.");
    } catch (error) {
      console.error("[SYNC] Error during sync:", error);
    }
  };

  // Run immediately then on interval
  runOnce();
  syncTimer = setInterval(runOnce, intervalMs);
}

export function stopSyncProcessor() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}
