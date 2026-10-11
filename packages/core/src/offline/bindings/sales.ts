/**
 * Offline bindings — sales family (LIRA-306). Each calls the SAME core
 * service the REST route calls (POST /api/sales/process →
 * `getSalesService().processSale(body, req.user.userId)`), with the actor
 * from the event instead of the JWT (E2, O-new-7).
 */
import { getSalesService } from "../../services/SalesService.js";
import type { SaleRequest } from "../../repositories/SalesRepository.js";
import type { BindingResult, OfflineBinding } from "./types.js";

const salesProcess: OfflineBinding = {
  channel: "sales:process",
  run: (payload, ctx) =>
    getSalesService().processSale(payload as unknown as SaleRequest, ctx.actorUserId) as unknown as BindingResult,
  mainRow: (result) => (typeof result.id === "number" ? { table: "sales", id: result.id } : null),
};

export const SALES_BINDINGS: readonly OfflineBinding[] = [salesProcess];
