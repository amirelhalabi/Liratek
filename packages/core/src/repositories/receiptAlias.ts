/**
 * LIRA-306 FR-040 — the receipt alias. A receipt printed offline reads
 * `RCP-<offline sale id>`; once that sale is replayed, the number must keep
 * finding it on the web. The ONE resolver (rule 14) used by the warranty
 * search (`WarrantyRepository.search`) and the reprint
 * (`SalesService.getSale`): an offline-range id that the shop's id map
 * (`offline_id_map`, never swept) maps to a `sales` row becomes that server
 * sale's id; every other id is returned unchanged. Tenant-scoped through the
 * repository. Server-only (reads the tenant context).
 */
import { isOfflineId } from "../offline/idRange.js";
import { getOfflineIdMapRepository } from "./OfflineIdMapRepository.js";

export function resolveReceiptSaleId(saleId: number): number {
  if (!isOfflineId(saleId)) return saleId;
  const row = getOfflineIdMapRepository().findRow(saleId);
  return row && row.table_name === "sales" ? row.server_id : saleId;
}
