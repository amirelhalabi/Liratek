import {
  MaintenanceRepository,
  MaintenanceRow,
  MaintenanceJob,
  MaintenancePaymentLine,
  MaintenancePartInput,
  MaintenancePartRow,
  MaintenanceStatusHistoryRow,
} from "../repositories/MaintenanceRepository.js";
import { toErrorString } from "../utils/errors.js";
import { maintenanceLogger } from "../utils/logger.js";

/**
 * A jobs-list row with its attached parts (LIRA-176 phase 6). `parts` is
 * always an array — `[]` when the job has none — never `undefined`, so
 * consumers don't need an extra null-check.
 */
export interface MaintenanceJobWithParts extends MaintenanceRow {
  parts: MaintenancePartRow[];
}

export interface SaveJobParams {
  id?: number;
  client_id?: number | null;
  client_name?: string | null;
  client_phone?: string | null;
  device_name: string;
  issue_description?: string | null;
  cost_usd?: number;
  price_usd?: number;
  cost_lbp?: number;
  price_lbp?: number;
  discount_usd?: number;
  final_amount_usd?: number;
  final_amount_lbp?: number;
  /** Job pricing currency: "USD" or "LBP". Defaults to "USD". */
  currency?: string;
  paid_usd?: number;
  paid_lbp?: number;
  exchange_rate?: number;
  status?: string;
  paid_by?: string;
  note?: string | null;
  /** Split-method payment lines (from CheckoutModal) */
  payments?: MaintenancePaymentLine[];
  change_given_usd?: number;
  change_given_lbp?: number;
  /** T3 keep-change (KC-3): kept change per currency → profit stamp. */
  kept_change_usd?: number;
  kept_change_lbp?: number;
  transaction_time?: string;
  /**
   * Session-basket deferred payment mode. When true, the job + its unified
   * transaction are created but the customer-cash drawer post, change, and debt
   * are skipped — the basket recorder owns the customer payment and back-fills
   * the job's paid state. Non-session callers leave this falsy → unchanged.
   */
  deferPayment?: boolean;
  /**
   * LIRA-176 phase 4 — attached parts (always USD-priced/costed). `undefined`
   * means "leave the job's parts untouched" (see
   * `MaintenanceRepository.syncParts`'s doc comment) — NEVER default this to
   * `[]` anywhere on this path, or a legacy/status-only resave would wipe a
   * job's parts and leak stock.
   */
  parts?: MaintenancePartInput[];
  /** Bypass the stock-availability guard in `syncParts` (rare/admin override). */
  allowOutOfStock?: boolean;
}

export class MaintenanceService {
  private repo: MaintenanceRepository;

  constructor(repo?: MaintenanceRepository) {
    this.repo = repo ?? new MaintenanceRepository();
  }

  /**
   * Save (create or update) a maintenance job
   */
  saveJob(params: SaveJobParams): {
    success: boolean;
    id?: number;
    error?: string;
  } {
    try {
      if (params.transaction_time) {
        const txTime = new Date(params.transaction_time);
        if (isNaN(txTime.getTime())) {
          throw new Error("Invalid transaction_time format");
        }
        if (txTime > new Date()) {
          throw new Error("transaction_time cannot be in the future");
        }
      }

      return this.repo.withTransaction(() => {
        // Handle client auto-creation if name provided but no ID
        let clientId = params.client_id ?? null;
        if (!clientId && params.client_name) {
          try {
            clientId = this.repo.findOrCreateClient(
              params.client_name,
              params.client_phone,
            );
          } catch (e) {
            maintenanceLogger.error(
              { error: e, clientName: params.client_name },
              "Auto-create client failed",
            );
          }
        }

        // LIRA-176 phase 4, owner decision 2026-09-07 ("option 4"): parts are
        // ALWAYS USD (products only carry cost_price_usd/selling_price_usd;
        // nothing here is ever converted). Labour keeps its existing
        // job-currency columns/meaning. The frontend sends LABOUR-ONLY final
        // amounts — this service folds the parts total in before it reaches
        // the repository.
        const isLbpJob = (params.currency ?? "USD") === "LBP";
        const labourFinal = isLbpJob
          ? (params.final_amount_lbp ?? 0)
          : (params.final_amount_usd ?? 0);
        const labourCost = isLbpJob
          ? (params.cost_lbp ?? 0)
          : (params.cost_usd ?? 0);
        const labourProfit = labourFinal - labourCost;

        // Fields shared by every write on this save — final_amount_*/parts_*
        // are handled separately below since they depend on parts, which
        // aren't known (create path) or must be synced first (update path).
        const baseJobData: Omit<
          MaintenanceJob,
          | "final_amount_usd"
          | "final_amount_lbp"
          | "parts_cost_usd"
          | "parts_price_usd"
        > = {
          client_id: clientId,
          client_name: params.client_name ?? null,
          device_name: params.device_name,
          issue_description: params.issue_description ?? null,
          cost_usd: params.cost_usd ?? 0,
          price_usd: params.price_usd ?? 0,
          cost_lbp: params.cost_lbp ?? 0,
          price_lbp: params.price_lbp ?? 0,
          discount_usd: params.discount_usd ?? 0,
          currency: params.currency ?? "USD",
          paid_usd: params.paid_usd ?? 0,
          paid_lbp: params.paid_lbp ?? 0,
          exchange_rate: params.exchange_rate ?? 0,
          // "Received" mirrors the validator's own default. "In Progress"
          // (with a space) was never a valid status — the real enum value is
          // `In_Progress` — so an omitted status silently landed a job in an
          // unfilterable state.
          status: params.status ?? "Received",
          paid_by: params.paid_by ?? "CASH",
          note: params.note ?? null,
          transaction_time: params.transaction_time,
        };

        // Determine primary payment method from payment lines
        if (params.payments?.length) {
          // Use the first non-DEBT method as primary paid_by
          const primaryMethod = params.payments.find(
            (p) => p.method !== "CUSTOMER_ACCOUNT",
          );
          if (primaryMethod) {
            baseJobData.paid_by = primaryMethod.method;
          }
        }

        const defer = params.deferPayment === true;
        const isPaidStatus =
          params.status === "Delivered_Paid" || params.status === "Delivered";

        // Shared processPayments opts builder. `parts` here is a PRICE-ONLY
        // receipt snapshot (never cost/margin — see processPayments' own
        // doc), read fresh from the just-synced part rows.
        const buildPaymentOpts = (
          jobId: number,
          partsPriceUsd: number,
          partsMarginUsd: number,
        ) => ({
          currency: params.currency ?? "USD",
          finalAmount: labourFinal,
          profit: labourProfit,
          partsPriceUsd,
          partsMarginUsd,
          exchangeRate: params.exchange_rate ?? 1,
          clientId,
          changeUsd: params.change_given_usd,
          changeLbp: params.change_given_lbp,
          keptChangeUsd: params.kept_change_usd,
          keptChangeLbp: params.kept_change_lbp,
          note: params.note,
          defer,
          deviceName: baseJobData.device_name,
          issueDescription: baseJobData.issue_description,
          parts: this.repo.getParts(jobId).map((row) => ({
            name: row.product_name,
            quantity: row.quantity,
            unit_price_usd: row.unit_price_usd,
          })),
        });

        if (params.id) {
          // ---- Update path ----
          // `syncParts` MUST run BEFORE `updateJob`. `updateJob`'s
          // post-payment amount lock compares the INCOMING final_amount_*/
          // parts_* fields against the STORED ones (MAINTENANCE_AMOUNT_FIELDS
          // includes parts_cost_usd/parts_price_usd). If updateJob ran first
          // with labour-only finals while the stored row already held
          // labour-plus-parts, an innocent notes-only edit of a paid job
          // would falsely trip the lock (stored parts total != incoming 0).
          // Running syncParts first and folding the resulting parts totals
          // into jobData BEFORE calling updateJob keeps both sides of that
          // comparison consistent. Do not reorder this — a later "tidy up"
          // would reintroduce the bug.
          this.repo.syncParts(params.id, params.parts, {
            allowOutOfStock: params.allowOutOfStock,
          });

          const jobAfterParts = this.repo.findById(params.id);
          const partsPriceUsd = jobAfterParts?.parts_price_usd ?? 0;
          const partsCostUsd = jobAfterParts?.parts_cost_usd ?? 0;
          const partsMarginUsd = partsPriceUsd - partsCostUsd;

          const jobData: MaintenanceJob = {
            ...baseJobData,
            final_amount_usd: partsPriceUsd + (isLbpJob ? 0 : labourFinal),
            final_amount_lbp: isLbpJob ? labourFinal : 0,
            parts_price_usd: partsPriceUsd,
            parts_cost_usd: partsCostUsd,
          };

          this.repo.updateJob(params.id, jobData);

          // Process payments only on first transition to paid status.
          // Deferred (session basket): always create the unified transaction (so
          // the basket can link + back-fill it) even with no payment lines.
          if (
            (defer || (isPaidStatus && params.payments?.length)) &&
            !this.repo.hasPayments(params.id)
          ) {
            this.repo.processPayments(
              params.id,
              params.payments ?? [],
              buildPaymentOpts(params.id, partsPriceUsd, partsMarginUsd),
            );
          }

          // Log status change for completion
          if (isPaidStatus) {
            maintenanceLogger.info(
              {
                jobId: params.id,
                device: params.device_name,
                amountUSD: jobData.final_amount_usd,
                status: params.status,
              },
              `Job ${params.id} completed: ${params.device_name} - $${jobData.final_amount_usd}`,
            );
          }
          return { success: true, id: params.id };
        } else {
          // ---- Create path ----
          // Parts totals aren't known until the job row exists (syncParts
          // needs a jobId), so create with labour-only finals first.
          const jobData: MaintenanceJob = {
            ...baseJobData,
            final_amount_usd: isLbpJob ? 0 : labourFinal,
            final_amount_lbp: isLbpJob ? labourFinal : 0,
          };
          const newId = this.repo.createJob(jobData);

          this.repo.syncParts(newId, params.parts, {
            allowOutOfStock: params.allowOutOfStock,
          });

          const jobAfterParts = this.repo.findById(newId);
          const partsPriceUsd = jobAfterParts?.parts_price_usd ?? 0;
          const partsCostUsd = jobAfterParts?.parts_cost_usd ?? 0;
          const partsMarginUsd = partsPriceUsd - partsCostUsd;

          // Only issue the corrective write when the job actually has parts
          // — keeps the no-parts path at exactly as many writes as before
          // parts existed.
          if (partsPriceUsd !== 0 || partsCostUsd !== 0) {
            this.repo.updateJob(newId, {
              ...jobData,
              final_amount_usd: partsPriceUsd + (isLbpJob ? 0 : labourFinal),
              parts_price_usd: partsPriceUsd,
              parts_cost_usd: partsCostUsd,
            });
          }

          // If creating with payment data (checkout from new job form).
          // Deferred (session basket): always create the unified transaction (so
          // the basket can link + back-fill it) even with no payment lines.
          if (defer || (isPaidStatus && params.payments?.length)) {
            this.repo.processPayments(
              newId,
              params.payments ?? [],
              buildPaymentOpts(newId, partsPriceUsd, partsMarginUsd),
            );
          }

          maintenanceLogger.info(
            {
              jobId: newId,
              device: params.device_name,
              priceUSD: params.price_usd,
            },
            `New job: ${params.device_name} - $${params.price_usd}`,
          );
          return { success: true, id: newId };
        }
      });
    } catch (error) {
      maintenanceLogger.error(
        { error, params },
        "MaintenanceService.saveJob error",
      );
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Get all jobs, optionally filtered by status. Each row carries its
   * attached parts (LIRA-176 phase 6) — fetched in ONE batch query via
   * `getPartsForJobs`, never per-row, to avoid an N+1.
   */
  getJobs(statusFilter?: string): MaintenanceJobWithParts[] {
    try {
      const rows = this.repo.getJobs(statusFilter);
      const partsByJobId = this.repo.getPartsForJobs(rows.map((r) => r.id));
      return rows.map((row) => ({
        ...row,
        parts: partsByJobId.get(row.id) ?? [],
      }));
    } catch (error) {
      maintenanceLogger.error(
        { error, statusFilter },
        "MaintenanceService.getJobs error",
      );
      return [];
    }
  }

  /**
   * Full status transition history for one job, chronological (oldest
   * first). Thin pass-through, following the same shape as `getJobs`.
   */
  getStatusHistory(jobId: number): MaintenanceStatusHistoryRow[] {
    try {
      return this.repo.getStatusHistory(jobId);
    } catch (error) {
      maintenanceLogger.error(
        { error, jobId },
        "MaintenanceService.getStatusHistory error",
      );
      return [];
    }
  }

  /**
   * Delete a job by ID
   */
  deleteJob(id: number): { success: boolean; error?: string } {
    try {
      this.repo.deleteJob(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Update non-financial metadata on a maintenance job.
   * Records old/new values for audit trail.
   */
  updateMaintenanceMetadata(
    id: number,
    data: {
      client_name?: string;
      device_name?: string;
      issue_description?: string;
      note?: string;
    },
    editedBy: string,
  ): {
    success: boolean;
    entity?: MaintenanceRow;
    oldValues?: Record<string, unknown>;
    error?: string;
  } {
    const existing = this.repo.findById(id);
    if (!existing) {
      return { success: false, error: "Maintenance job not found" };
    }

    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    const fields = [
      "client_name",
      "device_name",
      "issue_description",
      "note",
    ] as const;

    for (const field of fields) {
      if (data[field] !== undefined && data[field] !== existing[field]) {
        oldValues[field] = existing[field];
        newValues[field] = data[field];
      }
    }

    if (Object.keys(newValues).length === 0) {
      return { success: true, entity: existing };
    }

    const updated = this.repo.updateMetadata(id, data, editedBy);
    if (!updated) {
      return { success: false, error: "Failed to update" };
    }

    maintenanceLogger.info(
      { id, editedBy, oldValues, newValues },
      "Maintenance metadata updated",
    );

    return { success: true, entity: updated, oldValues };
  }
}

// Singleton instance
let maintenanceServiceInstance: MaintenanceService | null = null;

export function getMaintenanceService(): MaintenanceService {
  if (!maintenanceServiceInstance) {
    maintenanceServiceInstance = new MaintenanceService();
  }
  return maintenanceServiceInstance;
}

export function resetMaintenanceService(): void {
  maintenanceServiceInstance = null;
}
