/**
 * LIRA-306 T105 — pins TODAY's online running balances that order by row id
 * (FR-042, O-new-19). Pins today's behaviour — not a failing-first guard.
 *
 * O-new-19 (owner-confirmed): lists that use the row number as "time" keep
 * today's order. A replayed offline row gets a server id at SEND time while
 * carrying the event's own created_at, so it sits in these id-ordered
 * balances where it was SENT — exactly like a backdated entry does today.
 *
 * T106 audit (2026-10-11) of the remaining `ORDER BY id DESC` / `, id DESC`
 * "latest row" queries in packages/core/src (excluding migrations/tests):
 *
 * KEPT — they mean "most recently entered", which is correct with replay:
 *   - TransactionRepository.getBySourceId / getActiveSaleTransactionId /
 *     the sale-refund lookup (~:1990, :2021, :5618) and
 *     CustomerSessionRepository (~:275): the unified row of ONE source row
 *     (a 1:1 link; id DESC only picks the live row after a void/re-insert).
 *   - SessionPaymentRepository (~:233): the session-debt row just written in
 *     the same checkout.
 *   - basketMemberCoverage (~:122): LIFO over one basket's members — all
 *     entered by the same checkout, replayed in the PC's own order.
 *   - WarrantyClaimRepository.findByRepairJob (~:129): the job's newest claim.
 *   - CarrierLineMovementRepository.getLaterUnreversedValidityMovement /
 *     getOlderReversedValidityMovement (~:170/:193): the reversal-order guard
 *     is about the order movements were APPLIED to the line (pinned below).
 *   - History/listing views ordered newest-entered first (display only):
 *     CarrierLineMovementRepository.getByCarrierLineId (~:115),
 *     CarrierLineOwedDeliveryRepository (~:128), StockAdjustmentRepository
 *     (~:110/:120), ProductUnitRepository (~:575/:617), Activity/Audit logs,
 *     SigninCodeRepository (sign-in codes are never offline).
 *   - `created_at DESC, id DESC` / `created_at ASC, id ASC` queries order by
 *     business time already; id is only the tie-break (incl. the FIFO stock
 *     batches and exchange lots, which now carry the event's time).
 *
 * FOLLOW-UP (business latest, NOT changed here — needs a ticket):
 *   - ClosingRepository.getLastCheckpointActuals (~:344,
 *     `SELECT id FROM daily_closings … ORDER BY id DESC LIMIT 1`) — the
 *     baseline for the next checkpoint is "the latest checkpoint by id". An
 *     offline drawer count applied later from the review list (N8) gets a
 *     higher id than an online count taken AFTER it, and would become the
 *     baseline. Should be `ORDER BY closing time DESC, id DESC` after checking
 *     backdated closings (same caveat as O-new-19's undo).
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { TransactionRepository } from "../TransactionRepository";
import { getCarrierLineMovementRepository, resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { installReplayDb, uninstallReplayDb } from "../../offline/testHelpers/replayHarness";

type BalanceProbe = { _clientBalanceBeforeRow(clientId: number, beforeRowId: number): { usd: number; lbp: number } };

let db: Database.Database;
beforeEach(() => {
  ({ db } = installReplayDb());
  resetCarrierLineMovementRepository();
});
afterEach(() => uninstallReplayDb(db));

describe("_clientBalanceBeforeRow — id order, not created_at (pins today)", () => {
  beforeEach(() => {
    db.exec(`
      INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (801, 1, 'Rami', '70800800');
      -- entered in id order; 803 is BACKDATED (typed earlier time) / a replayed earlier event
      INSERT INTO debt_ledger (id, tenant_id, client_id, transaction_type, amount_usd, amount_lbp, created_at)
        VALUES (801, 1, 801, 'Sale Debt', 10, 0, '2026-10-05 09:00:00');
      INSERT INTO debt_ledger (id, tenant_id, client_id, transaction_type, amount_usd, amount_lbp, created_at)
        VALUES (802, 1, 801, 'Session Debt', 20, 900000, '2026-10-06 09:00:00');
      INSERT INTO debt_ledger (id, tenant_id, client_id, transaction_type, amount_usd, amount_lbp, created_at)
        VALUES (803, 1, 801, 'Repayment', -5, 0, '2026-10-01 09:00:00');
    `);
  });
  const probe = () => new TransactionRepository() as unknown as BalanceProbe;

  it("sums every row with a lower id, whatever its created_at", () => {
    expect(runWithTenant(1, () => probe()._clientBalanceBeforeRow(801, 802))).toEqual({ usd: 10, lbp: 0 });
  });

  it("a backdated / replayed earlier row (higher id, older created_at) is NOT before a lower-id row (O-new-19)", () => {
    // 803 happened on 10-01 but was entered after 802: it is not in 802's "before"
    expect(runWithTenant(1, () => probe()._clientBalanceBeforeRow(801, 803))).toEqual({ usd: 30, lbp: 900000 });
    expect(runWithTenant(1, () => probe()._clientBalanceBeforeRow(801, 804))).toEqual({ usd: 25, lbp: 900000 });
  });
});

describe("carrier-line movement reversal-order guard — id order (pins today)", () => {
  beforeEach(() => {
    db.exec(`
      INSERT INTO carrier_lines (id, tenant_id, carrier, phone_number) VALUES (801, 1, 'alfa', '03800800');
      INSERT INTO carrier_line_movements (id, tenant_id, carrier_line_id, validity_days_delta, reason, is_reversed, created_at)
        VALUES (811, 1, 801, 30, 'charge', 1, '2026-10-05 09:00:00');
      INSERT INTO carrier_line_movements (id, tenant_id, carrier_line_id, validity_days_delta, reason, is_reversed, created_at)
        VALUES (812, 1, 801, 30, 'charge', 0, '2026-10-06 09:00:00');
      -- entered last, but its created_at is the oldest (backdated / replayed)
      INSERT INTO carrier_line_movements (id, tenant_id, carrier_line_id, validity_days_delta, reason, is_reversed, created_at)
        VALUES (813, 1, 801, 30, 'charge', 0, '2026-10-01 09:00:00');
    `);
  });

  it("'later unreversed' means a higher id, even when its created_at is older", () => {
    const later = runWithTenant(1, () => getCarrierLineMovementRepository().getLaterUnreversedValidityMovement(801, 812));
    expect(later?.id).toBe(813);
  });

  it("'older reversed' means a lower id", () => {
    const older = runWithTenant(1, () => getCarrierLineMovementRepository().getOlderReversedValidityMovement(801, 813));
    expect(older?.id).toBe(811);
    const none = runWithTenant(1, () => getCarrierLineMovementRepository().getOlderReversedValidityMovement(801, 811));
    expect(none).toBeNull();
  });
});
