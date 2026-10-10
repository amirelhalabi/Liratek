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
  type WarrantyRepository,
  type WarrantyLineRow,
  type WarrantyUnitRow,
} from "../repositories/WarrantyRepository.js";
import {
  warrantySearchSchema,
  type WarrantySearchInput,
  type WarrantySearchRow,
  type WarrantySearchUnit,
} from "../validators/warranty.js";
import { receiptNumberFor } from "../utils/receiptNumber.js";
import {
  isSaleLineFullyRefunded,
  warrantyState,
  type WarrantyState,
} from "../utils/warrantyState.js";
import { warrantyLogger } from "../utils/logger.js";

/** When a state filter is applied, the state is only known after the read,
 *  so read a wider window and trim to the caller's limit afterwards. */
const STATE_FILTER_WINDOW = 1000;

export class WarrantyService {
  constructor(private readonly repo: WarrantyRepository) {}

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

    const rows = lines.map((line) =>
      this.toRow(line, unitsByLine.get(line.sale_item_id) ?? [], query.client_day),
    );
    const filtered = query.state
      ? rows.filter((r) => r.state === query.state).slice(0, query.limit)
      : rows;
    warrantyLogger.debug(
      { q: query.q, state: query.state, found: filtered.length },
      "Warranty search",
    );
    return filtered;
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

let instance: WarrantyService | null = null;

export function getWarrantyService(): WarrantyService {
  if (!instance) instance = new WarrantyService(getWarrantyRepository());
  return instance;
}

/** Reset the singleton (for testing). */
export function resetWarrantyService(): void {
  instance = null;
}
