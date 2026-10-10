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
  type WarrantySearchInput,
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

/** When a state filter is applied, the state is only known after the read,
 *  so read a wider window and trim to the caller's limit afterwards. */
const STATE_FILTER_WINDOW = 1000;

export class WarrantyService {
  private readonly claims: WarrantyClaimRepository;
  private readonly defective: DefectiveItemRepository;
  private readonly side: WarrantyClaimSideRepository;

  constructor(
    private readonly repo: WarrantyRepository,
    deps: {
      claims?: WarrantyClaimRepository;
      defective?: DefectiveItemRepository;
      side?: WarrantyClaimSideRepository;
    } = {},
  ) {
    this.claims = deps.claims ?? getWarrantyClaimRepository();
    this.defective = deps.defective ?? getDefectiveItemRepository();
    this.side = deps.side ?? getWarrantyClaimSideRepository();
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
      this.bookCost(
        claimId,
        line.client_id,
        actor.userId,
        -lineCost,
        `WARRANTY: refund of faulty ${productName} (claim #${claimId})`,
      );
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
      this.bookCost(
        claimId,
        line.client_id,
        actor.userId,
        -consumed.totalCostUsd,
        `WARRANTY: replacement ${productName} (claim #${claimId})`,
      );
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
    this.bookCost(
      claim.id,
      job.client_id,
      actorUserId ?? claim.user_id,
      -cost,
      `WARRANTY: repair parts for ${job.device_name} (claim #${claim.id})`,
    );
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
        const held = this.defective.findByClaim(claim.id);
        if (held && held.status === "SENT_TO_SUPPLIER") {
          throw new WarrantyClaimError(
            "DEFECTIVE_ALREADY_SENT",
            "The faulty item was sent to the supplier — close or cancel that return first.",
          );
        }
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
          this.bookCost(
            item.warranty_claim_id,
            line?.client_id ?? null,
            actor.userId,
            item.unit_cost_usd * item.quantity,
            `WARRANTY: not faulty, back to stock (claim #${item.warranty_claim_id})`,
          );
        }
        return this.listDefective({}).find((d) => d.id === item.id)!;
      });
    });
  }

  /**
   * The ONE writer of WARRANTY_COST rows. No payment legs, no drawer: a
   * profit-only row on the claim. `is_auto` is derived from the claim link
   * here (rule 26) — never passed by a caller.
   */
  private bookCost(
    claimId: number,
    clientId: number | null,
    userId: number,
    profitUsd: number,
    summary: string,
    reversesId?: number,
  ): number {
    const id = getTransactionRepository().createTransaction({
      type: TRANSACTION_TYPES.WARRANTY_COST,
      source_table: "warranty_claims",
      source_id: claimId,
      user_id: userId,
      amount_usd: 0,
      amount_lbp: 0,
      profit_usd: Math.round(profitUsd * 100) / 100,
      profit_lbp: 0,
      client_id: clientId,
      summary,
      metadata_json: {
        warranty_claim_id: claimId,
        is_auto: claimId != null,
        ...(reversesId != null ? { reverses: reversesId } : {}),
      },
    });
    if (reversesId != null) this.claims.setReverses(id, reversesId);
    return id;
  }

  /** Negate every live WARRANTY_COST row of a claim (rule 20). */
  private reverseCosts(claim: WarrantyClaimEntity, userId: number): void {
    const rows = this.claims.costRowsForClaim(claim.id);
    const reversed = new Set(
      rows.filter((r) => r.reverses_id != null).map((r) => r.reverses_id!),
    );
    for (const r of rows) {
      if (r.reverses_id != null || reversed.has(r.id)) continue;
      this.bookCost(
        claim.id,
        r.client_id,
        userId,
        -r.profit_usd,
        `WARRANTY: claim #${claim.id} voided`,
        r.id,
      );
    }
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

export function getWarrantyService(): WarrantyService {
  if (!instance) instance = new WarrantyService(getWarrantyRepository());
  return instance;
}

/** Reset the singleton (for testing). */
export function resetWarrantyService(): void {
  instance = null;
}
