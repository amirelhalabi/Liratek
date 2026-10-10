/**
 * LIRA-296 — warranty for any item.
 *
 * P1: `search` — find warranty lines by customer, phone, receipt number,
 * product or serial/IMEI, each stamped with its state.
 *
 * Rule 13: no SQL here — every read goes through `WarrantyRepository`.
 * Rule 14: the state comes from the ONE shared helper (`warrantyState`).
 * Rule 27: "today" is the client's `client_day`, never the server's clock.
 *
 * Node-only (exported from `services/index.ts`, never from `browser.ts`).
 */
import {
  getWarrantyRepository,
  getWarrantyClaimSideRepository,
  type WarrantyRepository,
  type WarrantyClaimSideRepository,
  type WarrantyLineRow,
  type WarrantyUnitRow,
} from "../repositories/WarrantyRepository.js";
import {
  getWarrantyClaimRepository,
  type WarrantyClaimRepository,
  type WarrantyClaimEntity,
} from "../repositories/WarrantyClaimRepository.js";
import {
  getDefectiveItemRepository,
  type DefectiveItemRepository,
} from "../repositories/DefectiveItemRepository.js";
import {
  getSupplierReturnRepository,
  type SupplierReturnRepository,
  type SupplierReturnEntity,
} from "../repositories/SupplierReturnRepository.js";
import { getSupplierRepository } from "../repositories/SupplierRepository.js";
import {
  getWarrantyReportRepository,
  type WarrantyReportRepository,
} from "../repositories/WarrantyReportRepository.js";
import { getSalesRepository } from "../repositories/SalesRepository.js";
import { getTransactionRepository } from "../repositories/TransactionRepository.js";
import { getStockBatchRepository } from "../repositories/StockBatchRepository.js";
import { MaintenanceRepository } from "../repositories/MaintenanceRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import {
  warrantySearchSchema,
  createWarrantyClaimSchema,
  voidWarrantyClaimSchema,
  warrantyClaimsForSchema,
  listDefectiveItemsSchema,
  resolveDefectiveSchema,
  createSupplierReturnSchema,
  closeSupplierReturnSchema,
  listSupplierReturnsSchema,
  type CreateSupplierReturnInput,
  type CloseSupplierReturnInput,
  type ListSupplierReturnsInput,
  type SupplierReturnView,
  warrantyReportSchema,
  type WarrantyReportInput,
  type WarrantyReport,
  type WarrantyReportItem,
  type WarrantySearchInput,
  type WarrantySearchResult,
  type WarrantySearchRow,
  type WarrantySearchUnit,
  type CreateWarrantyClaimInput,
  type CreateWarrantyClaimData,
  type VoidWarrantyClaimInput,
  type WarrantyClaimsForInput,
  type ListDefectiveItemsInput,
  type ResolveDefectiveInput,
  type WarrantyClaimView,
  type WarrantyClaimResultData,
  type WarrantyClaimErrorCode,
  type DefectiveItemView,
} from "../validators/warranty.js";
import { receiptNumberFor } from "../utils/receiptNumber.js";
import {
  isSaleLineFullyRefunded,
  warrantyState,
  type WarrantyState,
} from "../utils/warrantyState.js";
import { warrantyLogger } from "../utils/logger.js";

/** Who is acting (the transport resolves it from the session/JWT). */
export interface WarrantyActor {
  userId: number;
  role: string;
}

/** The envelope every claim operation answers with (rule 19c). */
export type WarrantyOpResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code: WarrantyClaimErrorCode };

/** A refusal with its machine code — thrown inside a claim's transaction so
 *  everything it wrote rolls back, then turned into the envelope. */
class WarrantyClaimError extends Error {
  constructor(
    readonly code: WarrantyClaimErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WarrantyClaimError";
  }
}

const isAdmin = (actor: WarrantyActor) => actor.role === "admin";

/** What a WARRANTY_COST row is (metadata `kind`). */
export type WarrantyCostKind =
  | "COST"
  | "NOT_FAULTY"
  | "SUPPLIER_CREDIT"
  | "SUPPLIER_REPLACED"
  | "REVERSAL";

/** When a state filter is applied, the state is only known after the read,
 *  so read a wider window and trim to the caller's limit afterwards. */
const STATE_FILTER_WINDOW = 1000;

export class WarrantyService {
  private readonly claims: WarrantyClaimRepository;
  private readonly defective: DefectiveItemRepository;
  private readonly side: WarrantyClaimSideRepository;
  private readonly returns: SupplierReturnRepository;
  private readonly reports: WarrantyReportRepository;

  constructor(
    private readonly repo: WarrantyRepository,
    deps: {
      claims?: WarrantyClaimRepository;
      defective?: DefectiveItemRepository;
      side?: WarrantyClaimSideRepository;
      returns?: SupplierReturnRepository;
      reports?: WarrantyReportRepository;
    } = {},
  ) {
    this.claims = deps.claims ?? getWarrantyClaimRepository();
    this.defective = deps.defective ?? getDefectiveItemRepository();
    this.side = deps.side ?? getWarrantyClaimSideRepository();
    this.returns = deps.returns ?? getSupplierReturnRepository();
    this.reports = deps.reports ?? getWarrantyReportRepository();
  }

  /** Warranty lines matching the input, newest sale first. Throws a
   *  ZodError on invalid input (the transports validate first anyway). */
  search(input: WarrantySearchInput): WarrantySearchRow[] {
    const query = warrantySearchSchema.parse(input);
    const lines = this.repo.search({
      q: query.q,
      from: query.from,
      to: query.to,
      limit: query.state
        ? Math.max(query.limit, STATE_FILTER_WINDOW)
        : query.limit,
    });
    const unitsByLine = new Map<number, WarrantyUnitRow[]>();
    for (const unit of this.repo.unitsForLines(
      lines.map((l) => l.sale_item_id),
    )) {
      const list = unitsByLine.get(unit.sale_item_id) ?? [];
      list.push(unit);
      unitsByLine.set(unit.sale_item_id, list);
    }

    const openClaims = this.claims.openClaimIdsForLines(
      lines.map((l) => l.sale_item_id),
    );
    const rows = lines.map((line) => ({
      ...this.toRow(
        line,
        unitsByLine.get(line.sale_item_id) ?? [],
        query.client_day,
      ),
      openClaimId: openClaims.get(line.sale_item_id) ?? null,
    }));
    // P2 (user story 5) — repairs carrying their own warranty.
    const repairs = this.repo
      .searchRepairs({
        q: query.q,
        from: query.from,
        to: query.to,
        limit: query.state
          ? Math.max(query.limit, STATE_FILTER_WINDOW)
          : query.limit,
      })
      .map(
        (r): WarrantySearchRow => ({
          source: "REPAIR",
          saleId: null,
          receiptNumber: null,
          saleItemId: null,
          maintenanceId: r.maintenance_id,
          soldAt: r.sold_at,
          customer: {
            id: r.client_id,
            name: r.customer_name,
            phone: r.customer_phone,
          },
          product: { id: null, name: r.device_name, barcode: null },
          quantity: 1,
          refundedQuantity: r.is_refunded ? 1 : 0,
          coveredQuantity: r.is_refunded ? 0 : 1,
          units: [],
          warrantyUntil: r.warranty_until,
          warrantyMonths: r.warranty_months,
          state: warrantyState(r.warranty_until, query.client_day, {
            fullyRefunded: !!r.is_refunded,
          }),
          openClaimId: null,
        }),
      );
    const merged = [...rows, ...repairs].sort((a, b) =>
      a.soldAt < b.soldAt ? 1 : a.soldAt > b.soldAt ? -1 : 0,
    );
    const filtered = (
      query.state ? merged.filter((r) => r.state === query.state) : merged
    ).slice(0, query.limit);
    warrantyLogger.debug(
      { q: query.q, state: query.state, found: filtered.length },
      "Warranty search",
    );
    return filtered;
  }

  /**
   * LIRA-296 follow-up (owner decision 2026-10-10) — {@link search}, plus the
   * in-stock units whose IMEI/serial IS the query when no warranty row came
   * back: a phone on the shelf has no warranty until it is sold, and the
   * Warranty page says so instead of "nothing found". `inStockUnits` is left
   * out when there is nothing to report.
   */
  searchWithStock(input: WarrantySearchInput): WarrantySearchResult {
    const rows = this.search(input);
    const q = input.q?.trim();
    if (rows.length > 0 || !q) return { rows };
    const units = this.repo.findInStockUnitsBySerial(q);
    if (units.length === 0) return { rows };
    return {
      rows,
      inStockUnits: units.map((u) => ({
        imei: u.imei,
        productName: u.product_name,
      })),
    };
  }

  // ===========================================================================
  // P2 — claims (repair / replace / refund), void, defective holding
  // ===========================================================================

  /**
   * Start a claim on ONE covered unit of a sale line. Everything the claim
   * writes happens in one database transaction; a refusal writes nothing.
   *
   *   REFUND  — the existing "Refund item" money path with `restock: false`;
   *             the faulty unit goes to the defective holding at the line's
   *             cost; WARRANTY_COST −cost.
   *   REPLACE — one unit off the shelf (FIFO, owned by the claim); a tracked
   *             replacement is SOLD under the claim, covered until the
   *             ORIGINAL end date (D2); the faulty unit is held as
   *             defective; WARRANTY_COST −replacement cost. The sale is
   *             untouched.
   *   REPAIR  — a free repair job for the same customer, linked to the
   *             claim; the claim stays OPEN until the job is delivered.
   */
  createClaim(
    input: CreateWarrantyClaimInput,
    actor: WarrantyActor,
  ): WarrantyOpResult<WarrantyClaimResultData> {
    return this.run("createClaim", () => {
      const data = createWarrantyClaimSchema.parse(input);
      if (data.action !== "REPAIR" && !isAdmin(actor)) {
        throw new WarrantyClaimError(
          "FORBIDDEN_ACTION",
          "Only an admin can replace or refund under warranty. Staff can start a repair.",
        );
      }
      if (data.maintenance_id != null) {
        return this.createRepairWarrantyClaim(data, actor);
      }
      return this.claims.withTransaction(() =>
        this.createSaleLineClaim(data, actor),
      );
    });
  }

  private createSaleLineClaim(
    data: CreateWarrantyClaimData,
    actor: WarrantyActor,
  ): WarrantyClaimResultData {
    const line = this.side.lineForClaim(data.sale_item_id!);
    if (!line) throw new WarrantyClaimError("NOT_FOUND", "Sale line not found");

    // The unit being claimed (tracked lines are one unit per line).
    let unitOverride: string | null = null;
    if (data.unit_id != null) {
      const unit = this.side.unit(data.unit_id);
      if (!unit || unit.sale_item_id !== line.sale_item_id) {
        throw new WarrantyClaimError(
          "INVALID",
          "That unit was not sold on this line",
        );
      }
      if (unit.status !== "SOLD" || unit.is_defective) {
        throw new WarrantyClaimError(
          "NOT_COVERED",
          "This unit is no longer covered (it was refunded or returned).",
        );
      }
      unitOverride = unit.warranty_override_until;
      if (this.claims.findOpenForUnit(unit.id)) {
        throw new WarrantyClaimError(
          "ALREADY_CLAIMED",
          "This unit already has an open warranty claim.",
        );
      }
    }

    const fullyRefunded = isSaleLineFullyRefunded(line);
    const state = warrantyState(line.warranty_until, data.client_day, {
      overrideUntil: unitOverride,
      fullyRefunded,
    });
    this.assertCovered(state, data.override_reason, actor);

    const covered = fullyRefunded
      ? 0
      : Math.max(0, line.quantity - line.refunded_quantity);
    if (this.claims.countLiveNonRefundForLine(line.sale_item_id) >= covered) {
      throw new WarrantyClaimError(
        "NO_COVERED_UNIT_LEFT",
        "Every covered unit of this line already has a claim.",
      );
    }

    const claimId = this.claims.insertClaim({
      saleItemId: line.sale_item_id,
      maintenanceId: null,
      unitId: data.unit_id ?? null,
      action: data.action,
      status: data.action === "REPAIR" ? "OPEN" : "DONE",
      overrideReason:
        state === "EXPIRED" ? (data.override_reason ?? null) : null,
      notes: data.notes ?? null,
      userId: actor.userId,
    });
    const result: Omit<WarrantyClaimResultData, "claim"> = {};
    const lineCost = line.cost_price_snapshot_usd ?? 0;
    const productName = line.product_name ?? "item";

    if (data.action === "REFUND") {
      const refundTransactionId = getSalesRepository().refundSaleItem({
        saleId: line.sale_id,
        saleItemId: line.sale_item_id,
        refundQuantity: 1,
        userId: actor.userId,
        restock: false,
        warrantyClaimId: claimId,
        ...(data.refund?.legs ? { refundLegs: data.refund.legs } : {}),
        ...(data.refund?.exchange_rate != null
          ? { exchangeRate: data.refund.exchange_rate }
          : {}),
        ...(data.refund?.kept_change
          ? {
              keptChange: {
                usd: data.refund.kept_change.kept_change_usd ?? 0,
                lbp: data.refund.kept_change.kept_change_lbp ?? 0,
              },
            }
          : {}),
      });
      this.claims.setLinks(claimId, { refundTransactionId });
      this.defective.insertItem({
        productId: line.product_id,
        unitId: data.unit_id ?? null,
        quantity: 1,
        unitCostUsd: lineCost,
        warrantyClaimId: claimId,
      });
      this.bookCost({
        claimId,
        clientId: line.client_id,
        userId: actor.userId,
        usd: -lineCost,
        summary: `WARRANTY: refund of faulty ${productName} (claim #${claimId})`,
        kind: "COST",
      });
      result.refundTransactionId = refundTransactionId;
    } else if (data.action === "REPLACE") {
      const product = this.side.product(line.product_id);
      if (!product)
        throw new WarrantyClaimError("NOT_FOUND", "Product not found");
      if (product.in_stock_units > 0 && data.replacement_unit_id == null) {
        throw new WarrantyClaimError(
          "REPLACEMENT_UNIT_REQUIRED",
          "Pick which unit (serial/IMEI) you are giving the customer.",
        );
      }
      if (!this.side.takeOneFromStock(line.product_id)) {
        throw new WarrantyClaimError(
          "OUT_OF_STOCK",
          `${productName} is out of stock — offer a repair or a refund instead.`,
        );
      }
      const consumed = getStockBatchRepository().consume(line.product_id, 1, {
        warrantyClaimId: claimId,
        reason: "ADJUSTMENT",
        fallbackUnitCostUsd: product.cost_price_usd,
      });
      if (data.replacement_unit_id != null) {
        const repl = this.side.unit(data.replacement_unit_id);
        if (!repl || repl.product_id !== line.product_id) {
          throw new WarrantyClaimError(
            "INVALID",
            "That replacement unit is not this product",
          );
        }
        // D2: coverage does not restart — the replacement keeps the
        // original end date (the claimed unit's override, else the line's).
        const originalEnd = unitOverride ?? line.warranty_until;
        if (!this.side.markReplacementSold(repl.id, claimId, originalEnd)) {
          throw new WarrantyClaimError(
            "OUT_OF_STOCK",
            "That replacement unit is not in stock",
          );
        }
        this.claims.setLinks(claimId, { replacementUnitId: repl.id });
        result.replacementUnitId = repl.id;
      }
      if (data.unit_id != null) this.side.setUnitDefective(data.unit_id, true);
      this.defective.insertItem({
        productId: line.product_id,
        unitId: data.unit_id ?? null,
        quantity: 1,
        unitCostUsd: lineCost,
        warrantyClaimId: claimId,
      });
      this.bookCost({
        claimId,
        clientId: line.client_id,
        userId: actor.userId,
        usd: -consumed.totalCostUsd,
        summary: `WARRANTY: replacement ${productName} (claim #${claimId})`,
        kind: "COST",
      });
    } else {
      const jobs = new MaintenanceRepository();
      const jobId = jobs.createJob(
        {
          client_id: line.client_id,
          client_name: line.customer_name,
          device_name: productName,
          issue_description:
            data.notes ?? `Warranty repair (claim #${claimId})`,
          cost_usd: 0,
          price_usd: 0,
          final_amount_usd: 0,
          status: "Received",
          note: `Warranty claim #${claimId} — sale ${receiptNumberFor(line.sale_id)}`,
        },
        actor.userId,
      );
      jobs.setWarrantyClaim(jobId, claimId);
      this.claims.setLinks(claimId, { repairJobId: jobId });
      result.repairJobId = jobId;
    }

    warrantyLogger.info(
      { claimId, action: data.action, saleItemId: line.sale_item_id },
      "Warranty claim created",
    );
    return { claim: this.view(claimId), ...result };
  }

  /** P2/US5 — a claim on a repair's own warranty: REPAIR only. */
  private createRepairWarrantyClaim(
    data: CreateWarrantyClaimData,
    actor: WarrantyActor,
  ): WarrantyClaimResultData {
    if (data.action !== "REPAIR") {
      throw new WarrantyClaimError(
        "FORBIDDEN_ACTION",
        "A repair's warranty can only be honoured with another repair.",
      );
    }
    return this.claims.withTransaction(() => {
      const jobs = new MaintenanceRepository();
      const job = jobs.findById(data.maintenance_id!);
      if (!job)
        throw new WarrantyClaimError("NOT_FOUND", "Repair job not found");
      const state = warrantyState(job.warranty_until ?? null, data.client_day, {
        fullyRefunded: !!job.is_refunded,
      });
      this.assertCovered(state, data.override_reason, actor);
      if (this.claims.countLiveForJob(job.id) > 0) {
        throw new WarrantyClaimError(
          "ALREADY_CLAIMED",
          "This repair already has a warranty claim.",
        );
      }
      const claimId = this.claims.insertClaim({
        saleItemId: null,
        maintenanceId: job.id,
        unitId: null,
        action: "REPAIR",
        status: "OPEN",
        overrideReason:
          state === "EXPIRED" ? (data.override_reason ?? null) : null,
        notes: data.notes ?? null,
        userId: actor.userId,
      });
      const jobId = jobs.createJob(
        {
          client_id: job.client_id,
          client_name: job.client_name,
          device_name: job.device_name,
          issue_description: data.notes ?? `Warranty on repair #${job.id}`,
          cost_usd: 0,
          price_usd: 0,
          final_amount_usd: 0,
          status: "Received",
          note: `Warranty claim #${claimId} — repair #${job.id}`,
        },
        actor.userId,
      );
      jobs.setWarrantyClaim(jobId, claimId);
      this.claims.setLinks(claimId, { repairJobId: jobId });
      return { claim: this.view(claimId), repairJobId: jobId };
    });
  }

  /** VOID refuses always; EXPIRED needs an admin and a reason. */
  private assertCovered(
    state: string,
    overrideReason: string | undefined,
    actor: WarrantyActor,
  ): void {
    if (state === "COVERED") return;
    if (state === "EXPIRED" && overrideReason && isAdmin(actor)) return;
    if (state === "EXPIRED") {
      throw new WarrantyClaimError(
        "NOT_COVERED",
        "This warranty has expired. Only an admin can honour it, with a reason.",
      );
    }
    throw new WarrantyClaimError(
      "NOT_COVERED",
      state === "VOID"
        ? "This item was refunded — its warranty is void."
        : "This item has no warranty.",
    );
  }

  /**
   * LIRA-296 — a warranty repair job reached Delivered: book its cost
   * (parts + labour cost) as WARRANTY_COST, once, and close the claim.
   * Called by `MaintenanceService.saveJob`; idempotent (the job form resaves
   * on every status change).
   */
  onRepairDelivered(
    jobId: number,
    actorUserId: number | null | undefined,
  ): void {
    const claim = this.claims.findByRepairJob(jobId);
    if (!claim || claim.status !== "OPEN") return;
    const live = this.claims
      .costRowsForClaim(claim.id)
      .filter((r) => r.reverses_id == null);
    if (live.length > 0) return;
    const job = new MaintenanceRepository().findById(jobId);
    if (!job) return;
    const cost = (job.cost_usd ?? 0) + (job.parts_cost_usd ?? 0);
    this.bookCost({
      claimId: claim.id,
      clientId: job.client_id,
      userId: actorUserId ?? claim.user_id,
      usd: -cost,
      summary: `WARRANTY: repair parts for ${job.device_name} (claim #${claim.id})`,
      kind: "COST",
    });
    this.claims.setStatus(claim.id, "DONE");
  }

  /** Void a claim: reverse everything it wrote, then mark it VOIDED. Admin. */
  voidClaim(
    input: VoidWarrantyClaimInput,
    actor: WarrantyActor,
  ): WarrantyOpResult<WarrantyClaimView> {
    return this.run("voidClaim", () => {
      const { claim_id } = voidWarrantyClaimSchema.parse(input);
      if (!isAdmin(actor)) {
        throw new WarrantyClaimError(
          "FORBIDDEN_ACTION",
          "Only an admin can void a warranty claim.",
        );
      }
      return this.claims.withTransaction(() => {
        const claim = this.claims.findById(claim_id);
        if (!claim)
          throw new WarrantyClaimError("NOT_FOUND", "Claim not found");
        if (claim.status === "VOIDED") {
          throw new WarrantyClaimError(
            "ALREADY_VOIDED",
            "This claim is already void.",
          );
        }
        const returns = this.returns.listForClaim(claim.id);
        if (returns.some((r) => r.status === "SENT")) {
          throw new WarrantyClaimError(
            "DEFECTIVE_ALREADY_SENT",
            "The faulty item is with the supplier — record the supplier's answer first.",
          );
        }
        // Closed supplier returns are undone first (rule 20); the item is
        // then HELD again and the rest of the void runs as before.
        if (returns.length > 0) {
          this.undoSupplierReturns(claim, returns, actor.userId);
        }
        const held = this.defective.findByClaim(claim.id);
        if (held && held.status !== "HELD") {
          throw new WarrantyClaimError(
            "DEFECTIVE_RESOLVED",
            "The faulty item was already written off or put back in stock — this claim can't be voided.",
          );
        }

        if (claim.action === "REFUND" && claim.refund_transaction_id != null) {
          getSalesRepository().undoSaleItemRefund({
            refundTransactionId: claim.refund_transaction_id,
            userId: actor.userId,
            fromWarrantyClaim: true,
          });
        }
        if (claim.action === "REPLACE" && claim.sale_item_id != null) {
          const line = this.side.lineForClaim(claim.sale_item_id);
          if (line) {
            this.side.adjustStock(line.product_id, 1);
            getStockBatchRepository().restoreForWarrantyClaim(claim.id);
          }
          if (claim.replacement_unit_id != null) {
            this.side.releaseReplacement(claim.replacement_unit_id);
          }
          if (claim.unit_id != null)
            this.side.setUnitDefective(claim.unit_id, false);
        }
        if (claim.action === "REPAIR" && claim.repair_job_id != null) {
          new MaintenanceRepository().voidWarrantyJob(
            claim.repair_job_id,
            actor.userId,
          );
        }
        if (held) this.defective.delete(held.id);
        this.reverseCosts(claim, actor.userId);
        this.claims.markVoided(claim.id);
        warrantyLogger.info({ claimId: claim.id }, "Warranty claim voided");
        return this.view(claim.id);
      });
    });
  }

  /** Claim history for a sale line, a repair job or a unit, newest first. */
  claimsFor(input: WarrantyClaimsForInput): WarrantyClaimView[] {
    const q = warrantyClaimsForSchema.parse(input);
    return this.claims
      .listFor({
        ...(q.sale_item_id != null ? { saleItemId: q.sale_item_id } : {}),
        ...(q.maintenance_id != null
          ? { maintenanceId: q.maintenance_id }
          : {}),
        ...(q.unit_id != null ? { unitId: q.unit_id } : {}),
      })
      .map(toClaimView);
  }

  /** The defective-items holding (admin list). */
  listDefective(input: ListDefectiveItemsInput = {}): DefectiveItemView[] {
    const q = listDefectiveItemsSchema.parse(input);
    return this.defective.list(q.status).map((d) => ({
      id: d.id,
      product_id: d.product_id,
      product_name: d.product_name ?? null,
      unit_id: d.unit_id,
      serial: d.serial ?? null,
      quantity: d.quantity,
      unit_cost_usd: d.unit_cost_usd,
      warranty_claim_id: d.warranty_claim_id,
      claim_action: d.claim_action ?? null,
      sale_item_id: d.sale_item_id ?? null,
      status: d.status,
      resolved_at: d.resolved_at,
      created_at: d.created_at,
    }));
  }

  /**
   * Resolve a HELD defective item (admin):
   *   WRITE_OFF  — it stays out of stock; the cost already booked stands.
   *   NOT_FAULTY — back to sellable stock at its cost (+cost WARRANTY_COST):
   *                a refunded line's unit goes back to the batch it came
   *                from; a replaced one (the sale still stands) gets a fresh
   *                batch at its cost.
   */
  resolveDefective(
    input: ResolveDefectiveInput,
    actor: WarrantyActor,
  ): WarrantyOpResult<DefectiveItemView> {
    return this.run("resolveDefective", () => {
      const q = resolveDefectiveSchema.parse(input);
      if (!isAdmin(actor)) {
        throw new WarrantyClaimError(
          "FORBIDDEN_ACTION",
          "Only an admin can resolve defective items.",
        );
      }
      return this.claims.withTransaction(() => {
        const item = this.defective.findById(q.defective_item_id);
        if (!item)
          throw new WarrantyClaimError("NOT_FOUND", "Defective item not found");
        if (item.status !== "HELD") {
          throw new WarrantyClaimError(
            "NOT_HELD",
            "Only an item still held can be resolved.",
          );
        }
        if (q.outcome === "WRITE_OFF") {
          this.defective.setStatus(item.id, "WRITTEN_OFF", null);
        } else {
          const claim = this.claims.findById(item.warranty_claim_id);
          this.side.adjustStock(item.product_id, item.quantity);
          let restockBatchId: number | null = null;
          if (claim?.action === "REFUND" && claim.sale_item_id != null) {
            getStockBatchRepository().restoreForSaleItem(
              claim.sale_item_id,
              item.quantity,
            );
          } else {
            restockBatchId = getStockBatchRepository().createBatch({
              product_id: item.product_id,
              supplier_id: null,
              quantity: item.quantity,
              unit_cost_usd: item.unit_cost_usd,
              books_debt: false,
              created_by: actor.userId,
            });
          }
          if (item.unit_id != null) this.side.returnUnitToStock(item.unit_id);
          this.defective.setStatus(
            item.id,
            "RETURNED_TO_STOCK",
            restockBatchId,
          );
          const line =
            claim?.sale_item_id != null
              ? this.side.lineForClaim(claim.sale_item_id)
              : null;
          this.bookCost({
            claimId: item.warranty_claim_id,
            clientId: line?.client_id ?? null,
            userId: actor.userId,
            usd: item.unit_cost_usd * item.quantity,
            summary: `WARRANTY: not faulty, back to stock (claim #${item.warranty_claim_id})`,
            kind: "NOT_FAULTY",
          });
        }
        return this.listDefective({}).find((d) => d.id === item.id)!;
      });
    });
  }

  /**
   * The ONE writer of WARRANTY_COST rows. No payment legs, no drawer: a
   * profit-only row on the claim, per currency. `is_auto` is derived from
   * the claim link here (rule 26) — never passed by a caller. `kind` says
   * what the row is (the report splits gross cost from supplier recovery by
   * it — the sign alone can't: not-faulty and reversal rows are positive
   * too).
   */
  private bookCost(row: {
    claimId: number;
    clientId: number | null;
    userId: number;
    usd: number;
    lbp?: number;
    summary: string;
    kind: WarrantyCostKind;
    reversesId?: number;
    supplierReturnId?: number;
  }): number {
    const id = getTransactionRepository().createTransaction({
      type: TRANSACTION_TYPES.WARRANTY_COST,
      source_table: "warranty_claims",
      source_id: row.claimId,
      user_id: row.userId,
      amount_usd: 0,
      amount_lbp: 0,
      profit_usd: Math.round(row.usd * 100) / 100,
      profit_lbp: Math.round(row.lbp ?? 0),
      client_id: row.clientId,
      summary: row.summary,
      metadata_json: {
        warranty_claim_id: row.claimId,
        is_auto: row.claimId != null,
        kind: row.kind,
        ...(row.supplierReturnId != null
          ? { supplier_return_id: row.supplierReturnId }
          : {}),
        ...(row.reversesId != null ? { reverses: row.reversesId } : {}),
      },
    });
    if (row.reversesId != null) this.claims.setReverses(id, row.reversesId);
    return id;
  }

  /** Negate every live WARRANTY_COST row of a claim, per currency (rule 20). */
  private reverseCosts(claim: WarrantyClaimEntity, userId: number): void {
    const rows = this.claims.costRowsForClaim(claim.id);
    const reversed = new Set(
      rows.filter((r) => r.reverses_id != null).map((r) => r.reverses_id!),
    );
    for (const r of rows) {
      if (r.reverses_id != null || reversed.has(r.id)) continue;
      this.bookCost({
        claimId: claim.id,
        clientId: r.client_id,
        userId,
        usd: -r.profit_usd,
        lbp: -(r.profit_lbp ?? 0),
        summary: `WARRANTY: claim #${claim.id} voided`,
        kind: "REVERSAL",
        reversesId: r.id,
      });
    }
  }

  /**
   * Undo every CLOSED supplier return of a claim being voided (rule 20 —
   * the void is their reversal owner), then drop the return rows:
   *   CREDITED — an opposite paper ADJUSTMENT puts the supplier balance
   *              back (its +credit cost row is negated by reverseCosts);
   *   REPLACED — the restock batch and the unit come off the shelf again
   *              (refused when it was sold since);
   *   REJECTED — nothing was written, and the item is left as it is (HELD,
   *              or resolved since — then the void is refused).
   * After a credit or a replacement the defective item ends HELD, as the
   * rest of the void expects.
   */
  private undoSupplierReturns(
    claim: WarrantyClaimEntity,
    returns: SupplierReturnEntity[],
    userId: number,
  ): void {
    const restockBatches: number[] = [];
    for (const r of returns) {
      if (r.status === "CREDITED") {
        getSupplierRepository().addLedgerEntry({
          supplier_id: r.supplier_id,
          entry_type: "ADJUSTMENT",
          amount_usd: Math.abs(r.credit_usd),
          amount_lbp: Math.abs(r.credit_lbp),
          note: `Warranty claim #${claim.id} voided — supplier credit on return #${r.id} reversed`,
          created_by: userId,
        });
      }
      if (r.status === "REPLACED") {
        const item = this.defective.findById(r.defective_item_id);
        if (item) {
          if (
            item.unit_id != null &&
            !this.side.unitBackToDefective(item.unit_id)
          ) {
            throw new WarrantyClaimError(
              "RESTOCK_ALREADY_SOLD",
              "The supplier's replacement was already sold — this claim can't be voided.",
            );
          }
          this.side.adjustStock(item.product_id, -item.quantity);
        }
        if (r.restock_batch_id != null) restockBatches.push(r.restock_batch_id);
      }
      // Only a credit or a replacement moved the item (and nothing else can
      // move it after them). A REJECTED return left it HELD, where the owner
      // may since have resolved it — leave that alone so the
      // DEFECTIVE_RESOLVED guard below still refuses the void.
      if (r.status === "CREDITED" || r.status === "REPLACED") {
        this.defective.setStatus(r.defective_item_id, "HELD", null);
      }
    }
    // Drop the links first (defective_items.restock_batch_id is cleared
    // above; the return rows go now), then the restock batches themselves.
    this.returns.deleteForClaim(claim.id);
    for (const batchId of restockBatches) {
      if (!getStockBatchRepository().removeUntouchedBatch(batchId)) {
        throw new WarrantyClaimError(
          "RESTOCK_ALREADY_SOLD",
          "The supplier's replacement was already sold — this claim can't be voided.",
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // P3 — warranty report (US8). Admin (the transports gate it).
  // -------------------------------------------------------------------------

  /**
   * Items still covered on the shop's day, grouped by category, and the
   * claims made in [from, to] with their cost: gross (what claims cost),
   * supplier recovered (credits and replacements), net = gross − recovered
   * — and net equals minus the Profits "Warranty cost" line for the same
   * days, because both read the same rows with the same bounds.
   */
  report(input: WarrantyReportInput): WarrantyReport {
    const q = warrantyReportSchema.parse(input);
    const today = q.client_day;

    const lines = this.reports.coveredSaleLines(today);
    const unitsByLine = new Map<number, WarrantyUnitRow[]>();
    for (const unit of this.repo.unitsForLines(
      lines.map((l) => l.sale_item_id),
    )) {
      const list = unitsByLine.get(unit.sale_item_id) ?? [];
      list.push(unit);
      unitsByLine.set(unit.sale_item_id, list);
    }
    const groups = new Map<string, WarrantyReportItem[]>();
    const add = (category: string, item: WarrantyReportItem) => {
      const list = groups.get(category) ?? [];
      list.push(item);
      groups.set(category, list);
    };
    for (const line of lines) {
      const row = this.toRow(
        line,
        unitsByLine.get(line.sale_item_id) ?? [],
        today,
      );
      if (row.state !== "COVERED" || row.coveredQuantity <= 0) continue;
      add(line.category, {
        source: "SALE",
        saleId: row.saleId,
        receiptNumber: row.receiptNumber,
        saleItemId: row.saleItemId,
        maintenanceId: null,
        productName: row.product.name,
        customerName: row.customer.name,
        customerPhone: row.customer.phone,
        coveredQuantity: row.coveredQuantity,
        warrantyUntil: row.warrantyUntil ?? "",
      });
    }
    for (const r of this.reports.coveredRepairs(today)) {
      const state = warrantyState(r.warranty_until, today, {
        fullyRefunded: !!r.is_refunded,
      });
      if (state !== "COVERED") continue;
      add("Repairs", {
        source: "REPAIR",
        saleId: null,
        receiptNumber: null,
        saleItemId: null,
        maintenanceId: r.maintenance_id,
        productName: r.device_name,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        coveredQuantity: 1,
        warrantyUntil: r.warranty_until,
      });
    }
    const underWarranty = [...groups.entries()]
      .map(([category, items]) => ({
        category,
        count: items.reduce((n, i) => n + i.coveredQuantity, 0),
        items,
      }))
      .sort((a, b) => a.category.localeCompare(b.category));

    // Same window shape as ProfitService (`from 00:00:00` … `to 23:59:59`,
    // the operator's local day via dateRange).
    const fromDt = `${q.from} 00:00:00`;
    const toDt = `${q.to} 23:59:59`;
    const byAction = { REPAIR: 0, REPLACE: 0, REFUND: 0 };
    for (const c of this.reports.claimCounts(fromDt, toDt)) {
      byAction[c.action] = c.n;
    }
    const split = this.reports.costSplit(fromDt, toDt);
    // `+ 0` turns a −0 (no rows) into 0, so nothing prints "-$0.00".
    const round2 = (n: number) => Math.round(n * 100) / 100 + 0;
    const netCostUsd = round2(-split.net_usd);
    const recoveredUsd = round2(split.recovered_usd);
    const netCostLbp = Math.round(-split.net_lbp) + 0;
    const recoveredLbp = Math.round(split.recovered_lbp) + 0;
    return {
      underWarranty,
      claims: {
        byAction,
        total: byAction.REPAIR + byAction.REPLACE + byAction.REFUND,
        grossCostUsd: round2(netCostUsd + recoveredUsd),
        supplierRecoveredUsd: recoveredUsd,
        netCostUsd,
        grossCostLbp: netCostLbp + recoveredLbp,
        supplierRecoveredLbp: recoveredLbp,
        netCostLbp,
      },
    };
  }

  // -------------------------------------------------------------------------
  // P3 — supplier returns (US7). Admin only.
  // -------------------------------------------------------------------------

  /** Send a HELD defective item back to a supplier (status SENT). The
   *  supplier defaults from the FIFO batch the sold unit came from. */
  createSupplierReturn(
    input: CreateSupplierReturnInput,
    actor: WarrantyActor,
  ): WarrantyOpResult<SupplierReturnView> {
    return this.run("createSupplierReturn", () => {
      const q = createSupplierReturnSchema.parse(input);
      if (!isAdmin(actor)) {
        throw new WarrantyClaimError(
          "FORBIDDEN_ACTION",
          "Only an admin can send items back to a supplier.",
        );
      }
      return this.claims.withTransaction(() => {
        const item = this.defective.findById(q.defective_item_id);
        if (!item)
          throw new WarrantyClaimError("NOT_FOUND", "Defective item not found");
        if (item.status !== "HELD") {
          throw new WarrantyClaimError(
            "NOT_HELD",
            "Only an item still held can be sent to a supplier.",
          );
        }
        const claim = this.claims.findById(item.warranty_claim_id);
        const supplierId =
          q.supplier_id ??
          (claim?.sale_item_id != null
            ? this.side.supplierForSaleItem(claim.sale_item_id)
            : null);
        if (supplierId == null) {
          throw new WarrantyClaimError(
            "SUPPLIER_REQUIRED",
            "No supplier is on record for this item — pick the supplier.",
          );
        }
        if (!this.side.supplierExists(supplierId)) {
          throw new WarrantyClaimError("NOT_FOUND", "Supplier not found");
        }
        const id = this.returns.insertReturn({
          defectiveItemId: item.id,
          warrantyClaimId: item.warranty_claim_id,
          supplierId,
          userId: actor.userId,
          notes: q.notes ?? null,
        });
        this.defective.setStatus(item.id, "SENT_TO_SUPPLIER", null);
        warrantyLogger.info(
          { supplierReturnId: id, defectiveItemId: item.id, supplierId },
          "Defective item sent to supplier",
        );
        return this.returnView(id);
      });
    });
  }

  /** Record the supplier's answer to a SENT return. */
  closeSupplierReturn(
    input: CloseSupplierReturnInput,
    actor: WarrantyActor,
  ): WarrantyOpResult<SupplierReturnView> {
    return this.run("closeSupplierReturn", () => {
      const q = closeSupplierReturnSchema.parse(input);
      if (!isAdmin(actor)) {
        throw new WarrantyClaimError(
          "FORBIDDEN_ACTION",
          "Only an admin can close a supplier return.",
        );
      }
      return this.claims.withTransaction(() => {
        const ret = this.returns.findById(q.supplier_return_id);
        if (!ret)
          throw new WarrantyClaimError("NOT_FOUND", "Supplier return not found");
        if (ret.status !== "SENT") {
          throw new WarrantyClaimError(
            "RETURN_NOT_OPEN",
            "This supplier return is already closed.",
          );
        }
        const item = this.defective.findById(ret.defective_item_id);
        if (!item)
          throw new WarrantyClaimError("NOT_FOUND", "Defective item not found");
        const claim = this.claims.findById(ret.warranty_claim_id);
        const clientId =
          claim?.sale_item_id != null
            ? (this.side.lineForClaim(claim.sale_item_id)?.client_id ?? null)
            : null;
        const notes = q.notes ?? null;

        if (q.outcome === "CREDITED") {
          const creditUsd = q.credit_usd ?? 0;
          const creditLbp = q.credit_lbp ?? 0;
          // A supplier credit lowers what the shop owes: a NEGATIVE paper
          // ADJUSTMENT (no drawer) — POSTING_MAP "Supplier paper adjustment".
          const ledger = getSupplierRepository().addLedgerEntry({
            supplier_id: ret.supplier_id,
            entry_type: "ADJUSTMENT",
            amount_usd: -creditUsd,
            amount_lbp: -creditLbp,
            note: `Warranty return #${ret.id} credited (claim #${ret.warranty_claim_id})`,
            created_by: actor.userId,
          });
          const costId = this.bookCost({
            claimId: ret.warranty_claim_id,
            clientId,
            userId: actor.userId,
            usd: creditUsd,
            lbp: creditLbp,
            summary: `WARRANTY: supplier credit on return #${ret.id} (claim #${ret.warranty_claim_id})`,
            kind: "SUPPLIER_CREDIT",
            supplierReturnId: ret.id,
          });
          // The supplier keeps the item: it stays SENT_TO_SUPPLIER, now
          // resolved.
          this.defective.setStatus(item.id, "SENT_TO_SUPPLIER", null);
          this.returns.close(ret.id, {
            status: "CREDITED",
            creditUsd,
            creditLbp,
            ledgerEntryId: ledger.id,
            costTransactionId: costId,
            restockBatchId: null,
            closedBy: actor.userId,
            notes,
          });
        } else if (q.outcome === "REPLACED") {
          this.side.adjustStock(item.product_id, item.quantity);
          const batchId = getStockBatchRepository().createBatch({
            product_id: item.product_id,
            supplier_id: ret.supplier_id,
            quantity: item.quantity,
            unit_cost_usd: item.unit_cost_usd,
            books_debt: false,
            created_by: actor.userId,
          });
          if (item.unit_id != null) this.side.returnUnitToStock(item.unit_id);
          this.defective.setStatus(item.id, "RETURNED_TO_STOCK", batchId);
          const costId = this.bookCost({
            claimId: ret.warranty_claim_id,
            clientId,
            userId: actor.userId,
            usd: item.unit_cost_usd * item.quantity,
            summary: `WARRANTY: supplier replacement on return #${ret.id} (claim #${ret.warranty_claim_id})`,
            kind: "SUPPLIER_REPLACED",
            supplierReturnId: ret.id,
          });
          this.returns.close(ret.id, {
            status: "REPLACED",
            creditUsd: 0,
            creditLbp: 0,
            ledgerEntryId: null,
            costTransactionId: costId,
            restockBatchId: batchId,
            closedBy: actor.userId,
            notes,
          });
        } else {
          // REJECTED: nothing moves. The item comes back to the holding so
          // the owner can write it off or mark it not faulty.
          this.defective.setStatus(item.id, "HELD", null);
          this.returns.close(ret.id, {
            status: "REJECTED",
            creditUsd: 0,
            creditLbp: 0,
            ledgerEntryId: null,
            costTransactionId: null,
            restockBatchId: null,
            closedBy: actor.userId,
            notes,
          });
        }
        warrantyLogger.info(
          { supplierReturnId: ret.id, outcome: q.outcome },
          "Supplier return closed",
        );
        return this.returnView(ret.id);
      });
    });
  }

  /** Supplier returns (admin list), newest first. */
  listSupplierReturns(input: ListSupplierReturnsInput = {}): SupplierReturnView[] {
    const q = listSupplierReturnsSchema.parse(input);
    return this.returns.list(q.status).map(toReturnView);
  }

  private returnView(id: number): SupplierReturnView {
    const row = this.returns.list().find((r) => r.id === id);
    if (!row)
      throw new WarrantyClaimError("NOT_FOUND", "Supplier return not found");
    return toReturnView(row);
  }

  private view(claimId: number): WarrantyClaimView {
    const claim = this.claims.findById(claimId);
    if (!claim) throw new WarrantyClaimError("NOT_FOUND", "Claim not found");
    return toClaimView(claim);
  }

  /** Run an operation; a refusal or a schema error becomes the envelope. */
  private run<T>(op: string, fn: () => T): WarrantyOpResult<T> {
    try {
      return { success: true, data: fn() };
    } catch (error) {
      if (error instanceof WarrantyClaimError) {
        return { success: false, error: error.message, code: error.code };
      }
      if (error instanceof Error && error.name === "ZodError") {
        return { success: false, error: error.message, code: "INVALID" };
      }
      warrantyLogger.error({ error, op }, "Warranty operation failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        code: "INVALID",
      };
    }
  }

  private toRow(
    line: WarrantyLineRow,
    units: WarrantyUnitRow[],
    today: string,
  ): WarrantySearchRow {
    const fullyRefunded = isSaleLineFullyRefunded(line);
    const unitRows: WarrantySearchUnit[] = units.map((u) => ({
      id: u.id,
      serial: u.imei,
      // A unit a refund put back in stock no longer belongs to this sale.
      state:
        u.status === "IN_STOCK"
          ? "VOID"
          : warrantyState(line.warranty_until, today, {
              overrideUntil: u.warranty_override_until,
              fullyRefunded,
            }),
      overrideUntil: u.warranty_override_until,
    }));

    // A single-unit line follows its unit (an operator override wins);
    // otherwise the line's own stamp and refund state decide.
    const state: WarrantyState =
      unitRows.length === 1 && units[0]!.status === "SOLD"
        ? unitRows[0]!.state
        : warrantyState(line.warranty_until, today, { fullyRefunded });

    const covered = fullyRefunded
      ? 0
      : Math.max(0, line.quantity - line.refunded_quantity);

    return {
      source: "SALE",
      saleId: line.sale_id,
      receiptNumber: receiptNumberFor(line.sale_id),
      saleItemId: line.sale_item_id,
      maintenanceId: null,
      soldAt: line.sold_at,
      customer: {
        id: line.client_id,
        name: line.customer_name,
        phone: line.customer_phone,
      },
      product: {
        id: line.product_id,
        name: line.product_name ?? "Unknown product",
        barcode: line.barcode,
      },
      quantity: line.quantity,
      refundedQuantity: line.refunded_quantity,
      coveredQuantity: covered,
      units: unitRows,
      warrantyUntil: line.warranty_until,
      warrantyMonths: line.warranty_months,
      state,
      openClaimId: null,
    };
  }
}

function toClaimView(c: WarrantyClaimEntity): WarrantyClaimView {
  return {
    id: c.id,
    sale_item_id: c.sale_item_id,
    maintenance_id: c.maintenance_id,
    unit_id: c.unit_id,
    action: c.action,
    status: c.status,
    override_reason: c.override_reason,
    notes: c.notes,
    user_id: c.user_id,
    username: c.username ?? null,
    repair_job_id: c.repair_job_id,
    replacement_unit_id: c.replacement_unit_id,
    refund_transaction_id: c.refund_transaction_id,
    voided_at: c.voided_at,
    created_at: c.created_at,
  };
}

let instance: WarrantyService | null = null;

function toReturnView(r: SupplierReturnEntity): SupplierReturnView {
  return {
    id: r.id,
    defective_item_id: r.defective_item_id,
    warranty_claim_id: r.warranty_claim_id,
    supplier_id: r.supplier_id,
    supplier_name: r.supplier_name ?? null,
    product_id: r.product_id ?? null,
    product_name: r.product_name ?? null,
    serial: r.serial ?? null,
    unit_cost_usd: r.unit_cost_usd ?? null,
    status: r.status,
    credit_usd: r.credit_usd,
    credit_lbp: r.credit_lbp,
    notes: r.notes,
    sent_at: r.sent_at,
    closed_at: r.closed_at,
    user_id: r.user_id,
    closed_by: r.closed_by,
  };
}

export function getWarrantyService(): WarrantyService {
  if (!instance) instance = new WarrantyService(getWarrantyRepository());
  return instance;
}

/** Reset the singleton (for testing). */
export function resetWarrantyService(): void {
  instance = null;
}
