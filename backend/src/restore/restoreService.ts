/**
 * LIRA-377 — the ONE place the backend builds core's `ShopRestoreService`
 * with its ports: the shop-file swap (`getShopFilePort`), the Litestream
 * source, the restore directories, `create_db.sql`, an offline merge round
 * after every restore, and the support address for the owner email.
 *
 * `null` outside per-tenant mode (no swap port): the routes then answer
 * "Restore is only available on the web app". Tests inject a service.
 */
import {
  ShopRestoreService,
  getShopRestoreService,
  getShopRestoresRepository,
  getShopRestoreRepository,
  getShopRestoreFileRepository,
} from "@liratek/core";
import { getShopFilePort, getShopRestoreEnvironment } from "../database/connection.js";
import { scheduleOfflineRound } from "../offline/processorTimer.js";
import { resolveSupportEmail } from "../email/emailConfig.js";
import { createLitestreamSource, litestreamEnvFrom } from "./litestreamSource.js";

let override: ShopRestoreService | null | undefined;

/** Test seam only: a service (or `null` = "not per-tenant mode"); `undefined` resets. */
export function setShopRestoreServiceForTests(svc: ShopRestoreService | null | undefined): void {
  override = svc;
}

export function shopRestoreService(): ShopRestoreService | null {
  if (override !== undefined) return override;
  const shopFile = getShopFilePort();
  const env = getShopRestoreEnvironment();
  if (!shopFile || !env) return null;
  return getShopRestoreService(
    () =>
      new ShopRestoreService({
        restores: getShopRestoresRepository(),
        candidates: getShopRestoreRepository(),
        files: getShopRestoreFileRepository(),
        ports: {
          shopFile,
          source: createLitestreamSource({ env: litestreamEnvFrom(process.env) }),
          dirs: env.dirs,
          createDbSql: env.createDbSql,
          // Nothing else schedules a round for PC events that waited out the
          // swap (OfflineMergeProcessor.hold/release).
          afterRestore: (tenantId) => scheduleOfflineRound(tenantId),
          supportEmail: () => resolveSupportEmail(),
        },
      }),
  );
}
