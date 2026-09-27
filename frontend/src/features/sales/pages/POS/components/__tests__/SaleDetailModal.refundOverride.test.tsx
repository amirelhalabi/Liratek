/** @jest-environment jsdom */
/**
 * LIRA-231 — SaleDetailModal's "Refund Sale" and "Refund item" buttons now
 * open the SAME refund-tender-selection modal the Transactions page uses
 * (RefundMethodModal, mocked here as a thin stub so this test proves the
 * WIRING — preview fetched, modal opened/not-opened, override forwarded —
 * without re-rendering CounterpartySettleModal/MultiPaymentInput, which
 * RefundMethodModal.test.tsx already covers on its own), pre-filled from a
 * new `getSaleRefundPreview` read.
 *
 * 2026-09-26 owner decision addition — the POS refund window gets the SAME
 * "Returned phones" section (linked phone units + unitExtras forwarding) the
 * Transactions page's refund modal has always had. The four "units"/
 * "unitExtras" cases below, and the added 3rd/5th `undefined` argument on
 * the pre-existing "forwards refundLegs" assertions, are labelled NOT
 * PROVEN FAILING-FIRST: the SaleDetailModal change landed in the same pass
 * as these tests. The core-layer proof for the same capability
 * (`SalesRepository.refundUnitExtras.test.ts`) WAS run failing-first in the
 * normal way.
 *
 * LIRA-232 (SESSION_ITEM_REFUND_PLAN.md §4) — a session-linked sale no
 * longer shows the LIRA-231 block message: both buttons now resolve the
 * sale's {sessionId, transactionId} and open the SAME RefundMethodModal
 * through the shared `useSessionItemRefund` hook, calling
 * `refundSessionBasketItem` instead of `refundSale`/`refundSaleItem`. The
 * two "shows the block message" tests below are REWRITTEN (rule 24) into
 * guards that the OLD block path is no longer taken for a session-linked
 * sale — not deleted, since the block message/refusal is still the correct
 * behavior for the DESKTOP entry points `refundSale`/`refundSaleItem`
 * themselves (server-side guard, unchanged), just no longer what the UI
 * does when it detects `sessionLinked`.
 *
 * Round-2 review (finding 1, 2026-09-26) — REWRITTEN AGAIN: the
 * {sessionId, transactionId} pair used to come from a
 * `getTransactionBySource` + `getSessionForTransaction` two-hop lookup that
 * resolved the basket member as "the newest ACTIVE unified transaction for
 * source sales/saleId" — correct only until the FIRST item refund (after
 * that, the newest active row for the same source is the REFUND, not the
 * original SALE member), which is exactly the bug this ticket's POS step
 * hit. The two session-linked tests below now assert the pair comes
 * straight from `getSaleRefundPreview`'s own `sessionId`/
 * `sessionTransactionId` fields, and (rule 24) that the old two-hop lookup
 * is NOT called at all — that surface (`getTransactionBySource`/
 * `getSessionForTransaction`, the IPC channel and REST route behind it) was
 * removed in the same change. NOT proven failing-first: the SaleDetailModal
 * rewrite landed in the same pass as this test rewrite (see MEMORY/rule 17 —
 * finished code is never re-broken just to re-prove a guard).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { appEvents } from "@liratek/ui";
import SaleDetailModal from "../SaleDetailModal";
import type { getSaleRefundPreview } from "@/api/backendApi";

const mockGetSale = jest.fn();
const mockGetSaleItems = jest.fn();
const mockGetSaleRefundPreview = jest.fn();
const mockRefundSale = jest.fn();
const mockRefundSaleItem = jest.fn();
const mockGetProductUnitsForSaleItems = jest.fn();
const mockGetSessionItemRefundPreview = jest.fn();
const mockRefundSessionBasketItem = jest.fn();

/**
 * LIRA-232 round-3 review (finding 1) — every `getSaleRefundPreview` fixture
 * below is typed against the ADAPTER's own return type
 * (`frontend/src/api/backendApi.ts`, rule 21) instead of a bare object
 * literal. This is what makes it impossible to repeat the exact bug this
 * finding named: `sessionTransactionId: 55` was mocked here once as a shape
 * core never actually returned, and the test stayed green anyway because
 * nothing checked the fixture against the real contract. Passing a literal
 * straight into a parameter of this type gets TypeScript's excess-property
 * check for free — an extra/misspelled field is now a compile error, not a
 * silently-passing test (rule 24).
 */
type SaleRefundPreviewResult = Awaited<ReturnType<typeof getSaleRefundPreview>>;
function mockPreview(value: SaleRefundPreviewResult) {
  mockGetSaleRefundPreview.mockResolvedValue(value);
}

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getSale: mockGetSale,
    getSaleItems: mockGetSaleItems,
    getSaleRefundPreview: mockGetSaleRefundPreview,
    refundSale: mockRefundSale,
    refundSaleItem: mockRefundSaleItem,
    updateSaleMetadata: jest.fn(),
    getAllSettings: jest.fn().mockResolvedValue([]),
    getSessionItemRefundPreview: mockGetSessionItemRefundPreview,
    refundSessionBasketItem: mockRefundSessionBasketItem,
  }),
}));

jest.mock("@/api/backendApi", () => ({
  getProductUnitsForSaleItems: (...args: unknown[]) =>
    mockGetProductUnitsForSaleItems(...args),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
  }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Test Shop", phone: "", location: "", logo: "" }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

// Thin stub — RefundMethodModal.test.tsx already covers its own internal
// pre-fill/validation logic; this file only proves SaleDetailModal opens it
// (or doesn't) at the right time and forwards its `onConfirm` payload, and
// (2026-09-26) that it receives the `units` prop the "Returned phones"
// section renders from.
jest.mock("@/features/audit/components/RefundMethodModal", () => ({
  RefundMethodModal: ({
    units = [],
    exchangeRate,
    bookedRateSource,
    onConfirm,
    onCancel,
  }: {
    units?: Array<{ id: number; imei: string }>;
    exchangeRate?: number;
    bookedRateSource?: string;
    onConfirm: (
      refundLegs: undefined,
      unitExtras?: Array<{ unit_id: number; is_defective?: boolean }>,
      rate?: number,
    ) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="refund-method-modal">
      <span data-testid="refund-modal-unit-ids">
        {units.map((u) => u.id).join(",")}
      </span>
      {/* LIRA-236 — the props SaleDetailModal is expected to pass so the
          popup opens with the sale's/preview's own booked rate. */}
      <span data-testid="refund-modal-exchange-rate">{exchangeRate}</span>
      <span data-testid="refund-modal-booked-rate-source">
        {bookedRateSource ?? ""}
      </span>
      <button onClick={() => onConfirm(undefined)}>Confirm Refund (stub)</button>
      <button
        onClick={() =>
          onConfirm(undefined, [{ unit_id: units[0]?.id, is_defective: true }])
        }
      >
        Confirm Refund With Extras (stub)
      </button>
      {/* LIRA-236 — proves the rate the popup was showing reaches
          api.refundSale/refundSaleItem as the trailing argument. */}
      <button onClick={() => onConfirm(undefined, undefined, 92000)}>
        Confirm Refund With Rate (stub)
      </button>
      <button onClick={onCancel}>Cancel (stub)</button>
    </div>
  ),
}));

const SALE = {
  id: 4,
  client_id: null,
  client_name: "Walk-in Customer",
  client_phone: null,
  total_amount_usd: 500,
  discount_usd: 0,
  final_amount_usd: 500,
  paid_usd: 500,
  paid_lbp: 0,
  change_given_usd: 0,
  change_given_lbp: 0,
  exchange_rate_snapshot: 90000,
  status: "completed",
  created_at: "2026-09-26 10:00:00",
};

const ITEM = {
  id: 9,
  sale_id: 4,
  product_id: 1,
  quantity: 1,
  sold_price_usd: 500,
  name: "iPhone 13",
  barcode: "12345",
  refunded_quantity: 0,
};

describe("SaleDetailModal — LIRA-231 refund-method-override wiring", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSale.mockResolvedValue(SALE);
    mockGetSaleItems.mockResolvedValue([ITEM]);
    mockGetProductUnitsForSaleItems.mockResolvedValue([]);
  });

  it('"Refund Sale": fetches the preview, opens RefundMethodModal, and forwards refundLegs on confirm', async () => {
    mockPreview({
      success: true,
      legs: [
        {
          direction: "in",
          amount: 500,
          signed_amount: 500,
          currency_code: "USD",
          method: "CASH",
          drawer_name: "General",
        },
      ],
      sessionLinked: false,
    });
    mockRefundSale.mockResolvedValue({ success: true, refundId: 501 });

    render(<SaleDetailModal saleId={4} onClose={jest.fn()} />);
    await screen.findByText("Sale #4");

    fireEvent.click(await screen.findByText("Refund Sale"));

    await waitFor(() =>
      expect(mockGetSaleRefundPreview).toHaveBeenCalledWith(4),
    );
    expect(await screen.findByTestId("refund-method-modal")).toBeTruthy();

    fireEvent.click(screen.getByText("Confirm Refund (stub)"));

    await waitFor(() =>
      // LIRA-236: + the always-forwarded 4th (exchangeRate) arg, undefined here.
      expect(mockRefundSale).toHaveBeenCalledWith(
        4,
        undefined,
        undefined,
        undefined,
      ),
    );
  });

  it('"Refund Sale": loads every linked phone unit across ALL sale items and passes them to RefundMethodModal as `units` (not proven failing-first)', async () => {
    mockPreview({
      success: true,
      legs: [],
      sessionLinked: false,
    });
    mockGetProductUnitsForSaleItems.mockResolvedValue([
      { id: 77, imei: "111111111111111" },
    ]);

    render(<SaleDetailModal saleId={4} onClose={jest.fn()} />);
    await screen.findByText("Sale #4");

    fireEvent.click(await screen.findByText("Refund Sale"));

    await waitFor(() =>
      expect(mockGetProductUnitsForSaleItems).toHaveBeenCalledWith([9]),
    );
    expect(
      await screen.findByTestId("refund-modal-unit-ids"),
    ).toHaveTextContent("77");
  });

  it('"Refund Sale": forwards unitExtras (2nd onConfirm arg) to api.refundSale as the 3rd argument (not proven failing-first)', async () => {
    mockPreview({
      success: true,
      legs: [],
      sessionLinked: false,
    });
    mockGetProductUnitsForSaleItems.mockResolvedValue([
      { id: 77, imei: "111111111111111" },
    ]);
    mockRefundSale.mockResolvedValue({ success: true, refundId: 501 });

    render(<SaleDetailModal saleId={4} onClose={jest.fn()} />);
    await screen.findByText("Sale #4");

    fireEvent.click(await screen.findByText("Refund Sale"));
    await screen.findByTestId("refund-method-modal");

    fireEvent.click(screen.getByText("Confirm Refund With Extras (stub)"));

    await waitFor(() =>
      // LIRA-236: SaleDetailModal now always forwards a 4th (exchangeRate)
      // arg too — undefined here since the stub's onConfirm didn't pass one.
      expect(mockRefundSale).toHaveBeenCalledWith(
        4,
        undefined,
        [{ unit_id: 77, is_defective: true }],
        undefined,
      ),
    );
  });

  // LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md) — written failing-first: at
  // authoring time SaleDetailModal passed a hardcoded `exchangeRate` prop
  // (`sale.exchange_rate_snapshot || EXCHANGE_RATE`, no `bookedRateSource`)
  // and `handleConfirmRefund` took only (refundLegsInput, unitExtras) — a 3rd
  // onConfirm argument never reached `api.refundSale` at all.
  it('"Refund Sale": passes the preview\'s bookedRate/bookedRateSource to RefundMethodModal, and forwards the rate the popup reports to api.refundSale as the 4th argument', async () => {
    mockPreview({
      success: true,
      legs: [],
      sessionLinked: false,
      bookedRate: 91000,
      bookedRateSource: "fallback",
    });
    mockRefundSale.mockResolvedValue({ success: true, refundId: 509 });

    render(<SaleDetailModal saleId={4} onClose={jest.fn()} />);
    await screen.findByText("Sale #4");

    fireEvent.click(await screen.findByText("Refund Sale"));
    await screen.findByTestId("refund-method-modal");

    expect(screen.getByTestId("refund-modal-exchange-rate")).toHaveTextContent(
      "91000",
    );
    expect(
      screen.getByTestId("refund-modal-booked-rate-source"),
    ).toHaveTextContent("fallback");

    fireEvent.click(screen.getByText("Confirm Refund With Rate (stub)"));

    await waitFor(() =>
      expect(mockRefundSale).toHaveBeenCalledWith(4, undefined, undefined, 92000),
    );
  });

  // LIRA-236 round-2/final review, finding F15 (LOW) — REWRITTEN (rule 24):
  // this used to pin `sale.exchange_rate_snapshot` (90000 in the SALE
  // fixture) as a re-derived fallback when the preview omitted `bookedRate`.
  // That re-derivation was a second definition of the SAME rule the server's
  // own `getSaleRefundPreview` already applies (rule 14) — the fix is to
  // trust ONLY the server's `bookedRate`/`bookedRateSource`, so when the
  // preview genuinely omits them the popup now falls back to the plain UI
  // constant `EXCHANGE_RATE` (89000), never the sale's own snapshot. NOT
  // proven failing-first against the OLD assertions (rule 17 forbids
  // re-breaking `SaleDetailModal.tsx` just to re-prove a test whose premise
  // — the re-derivation itself — is exactly what's being removed); it WAS
  // confirmed that removing the `sale?.exchange_rate_snapshot` fallback from
  // `resolveBookedRate` is the only change needed to make this test's NEW
  // assertions true.
  it('"Refund Sale": falls back to the plain EXCHANGE_RATE constant (never sale.exchange_rate_snapshot) when the preview omits bookedRate', async () => {
    mockPreview({
      success: true,
      legs: [],
      sessionLinked: false,
    });

    render(<SaleDetailModal saleId={4} onClose={jest.fn()} />);
    await screen.findByText("Sale #4");

    fireEvent.click(await screen.findByText("Refund Sale"));
    await screen.findByTestId("refund-method-modal");

    // SALE.exchange_rate_snapshot === 90000 (fixture above) — must NOT
    // appear here; the popup falls back to the plain 89000 UI constant.
    expect(screen.getByTestId("refund-modal-exchange-rate")).toHaveTextContent(
      "89000",
    );
    expect(
      screen.getByTestId("refund-modal-booked-rate-source"),
    ).toHaveTextContent("fallback");
  });

  // LIRA-232 round-2 review (finding 1, rewritten again per rule 24): the
  // {sessionId, transactionId} pair now comes straight from the preview's
  // own `sessionId`/`sessionTransactionId` — never a two-hop lookup, which
  // is exactly why it's asserted absent below (the desktop-only channel/REST
  // route behind it was removed in the same change).
  it('a session-linked sale: "Refund Sale" reads {sessionId, sessionTransactionId} off the preview and refunds via refundSessionBasketItem — NOT refundSale, no two-hop session lookup', async () => {
    mockPreview({
      success: true,
      legs: [],
      sessionLinked: true,
      sessionId: 7,
      sessionTransactionId: 55,
    });
    mockGetSessionItemRefundPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 500,
      accountReductionLbp: 0,
      defaultLegs: [],
    });
    mockRefundSessionBasketItem.mockResolvedValue({
      success: true,
      refundTransactionId: 900,
    });

    render(<SaleDetailModal saleId={4} onClose={jest.fn()} />);
    await screen.findByText("Sale #4");

    fireEvent.click(await screen.findByText("Refund Sale"));

    await waitFor(() =>
      expect(mockGetSessionItemRefundPreview).toHaveBeenCalledWith({
        sessionId: 7,
        transactionId: 55,
        saleItemId: undefined,
        quantity: undefined,
      }),
    );
    expect(await screen.findByTestId("refund-method-modal")).toBeTruthy();

    fireEvent.click(screen.getByText("Confirm Refund (stub)"));

    await waitFor(() =>
      expect(mockRefundSessionBasketItem).toHaveBeenCalledTimes(1),
    );
    const payload = mockRefundSessionBasketItem.mock.calls[0][0];
    expect(payload.sessionId).toBe(7);
    expect(payload.transactionId).toBe(55);
    expect(payload.saleItemId).toBeUndefined();
    expect(mockRefundSale).not.toHaveBeenCalled();
  });

  // finding 1 — the removed two-hop lookup can no longer even be imported
  // (it's deleted from @/api/backendApi entirely), which this jest.mock's
  // absence of `getTransactionBySource`/`getSessionForTransaction` already
  // enforces at compile/module-resolution time: if SaleDetailModal still
  // imported either, the mock factory above would leave them `undefined`
  // and every test in this file would crash on render, not just this one.

  it('"Refund item": fetches the item preview, opens RefundMethodModal, and forwards refundLegs on confirm', async () => {
    mockPreview({
      success: true,
      legs: [
        {
          direction: "in",
          amount: 500,
          signed_amount: 500,
          currency_code: "USD",
          method: "CASH",
          drawer_name: "General",
        },
      ],
      sessionLinked: false,
    });
    mockRefundSaleItem.mockResolvedValue({ success: true, refundId: 601 });

    render(<SaleDetailModal saleId={4} onClose={jest.fn()} />);
    await screen.findByText("Sale #4");

    fireEvent.click(await screen.findByTitle("Refund item"));
    fireEvent.click(await screen.findByText(/Refund 1x/));

    await waitFor(() =>
      expect(mockGetSaleRefundPreview).toHaveBeenCalledWith(4, {
        saleItemId: 9,
        refundQuantity: 1,
      }),
    );
    expect(await screen.findByTestId("refund-method-modal")).toBeTruthy();

    fireEvent.click(screen.getByText("Confirm Refund (stub)"));

    await waitFor(() =>
      // LIRA-236: + the always-forwarded 6th (exchangeRate) arg, undefined here.
      expect(mockRefundSaleItem).toHaveBeenCalledWith(
        4,
        9,
        1,
        undefined,
        undefined,
        undefined,
      ),
    );
  });

  it('"Refund item": loads ONLY that item\'s linked units and passes them to RefundMethodModal as `units` (not proven failing-first)', async () => {
    mockPreview({
      success: true,
      legs: [],
      sessionLinked: false,
    });
    mockGetProductUnitsForSaleItems.mockResolvedValue([
      { id: 88, imei: "222222222222222" },
    ]);

    render(<SaleDetailModal saleId={4} onClose={jest.fn()} />);
    await screen.findByText("Sale #4");

    fireEvent.click(await screen.findByTitle("Refund item"));
    fireEvent.click(await screen.findByText(/Refund 1x/));

    await waitFor(() =>
      expect(mockGetProductUnitsForSaleItems).toHaveBeenCalledWith([9]),
    );
    expect(
      await screen.findByTestId("refund-modal-unit-ids"),
    ).toHaveTextContent("88");
  });

  it('"Refund item": forwards unitExtras (2nd onConfirm arg) to api.refundSaleItem as the 5th argument (not proven failing-first)', async () => {
    mockPreview({
      success: true,
      legs: [],
      sessionLinked: false,
    });
    mockGetProductUnitsForSaleItems.mockResolvedValue([
      { id: 88, imei: "222222222222222" },
    ]);
    mockRefundSaleItem.mockResolvedValue({ success: true, refundId: 601 });

    render(<SaleDetailModal saleId={4} onClose={jest.fn()} />);
    await screen.findByText("Sale #4");

    fireEvent.click(await screen.findByTitle("Refund item"));
    fireEvent.click(await screen.findByText(/Refund 1x/));
    await screen.findByTestId("refund-method-modal");

    fireEvent.click(screen.getByText("Confirm Refund With Extras (stub)"));

    await waitFor(() =>
      // LIRA-236: + the always-forwarded 6th (exchangeRate) arg, undefined here.
      expect(mockRefundSaleItem).toHaveBeenCalledWith(
        4,
        9,
        1,
        undefined,
        [{ unit_id: 88, is_defective: true }],
        undefined,
      ),
    );
  });

  // LIRA-236 — the "Refund item" sibling of the "Refund Sale" rate test
  // above: same bookedRate/bookedRateSource prop passthrough, same
  // 6th-argument forwarding on confirm.
  it('"Refund item": passes bookedRate/bookedRateSource to RefundMethodModal and forwards the rate to api.refundSaleItem as the 6th argument', async () => {
    mockPreview({
      success: true,
      legs: [],
      sessionLinked: false,
      bookedRate: 91000,
      bookedRateSource: "fallback",
    });
    mockRefundSaleItem.mockResolvedValue({ success: true, refundId: 602 });

    render(<SaleDetailModal saleId={4} onClose={jest.fn()} />);
    await screen.findByText("Sale #4");

    fireEvent.click(await screen.findByTitle("Refund item"));
    fireEvent.click(await screen.findByText(/Refund 1x/));
    await screen.findByTestId("refund-method-modal");

    expect(screen.getByTestId("refund-modal-exchange-rate")).toHaveTextContent(
      "91000",
    );
    expect(
      screen.getByTestId("refund-modal-booked-rate-source"),
    ).toHaveTextContent("fallback");

    fireEvent.click(screen.getByText("Confirm Refund With Rate (stub)"));

    await waitFor(() =>
      expect(mockRefundSaleItem).toHaveBeenCalledWith(
        4,
        9,
        1,
        undefined,
        undefined,
        92000,
      ),
    );
  });

  // LIRA-232 round-2 review (finding 1, rewritten again — see the "Refund
  // Sale" sibling above for why).
  it('a session-linked sale: "Refund item" reads {sessionId, sessionTransactionId} off the preview and refunds via refundSessionBasketItem with saleItemId — NOT refundSaleItem, no two-hop session lookup', async () => {
    mockPreview({
      success: true,
      legs: [],
      sessionLinked: true,
      sessionId: 7,
      sessionTransactionId: 55,
    });
    mockGetSessionItemRefundPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 500,
      accountReductionLbp: 0,
      defaultLegs: [],
    });
    mockRefundSessionBasketItem.mockResolvedValue({
      success: true,
      refundTransactionId: 901,
    });

    render(<SaleDetailModal saleId={4} onClose={jest.fn()} />);
    await screen.findByText("Sale #4");

    fireEvent.click(await screen.findByTitle("Refund item"));
    fireEvent.click(await screen.findByText(/Refund 1x/));

    await waitFor(() =>
      expect(mockGetSessionItemRefundPreview).toHaveBeenCalledWith({
        sessionId: 7,
        transactionId: 55,
        saleItemId: 9,
        quantity: 1,
      }),
    );
    expect(await screen.findByTestId("refund-method-modal")).toBeTruthy();

    fireEvent.click(screen.getByText("Confirm Refund (stub)"));

    await waitFor(() =>
      expect(mockRefundSessionBasketItem).toHaveBeenCalledTimes(1),
    );
    const payload = mockRefundSessionBasketItem.mock.calls[0][0];
    expect(payload.sessionId).toBe(7);
    expect(payload.transactionId).toBe(55);
    expect(payload.saleItemId).toBe(9);
    expect(payload.quantity).toBe(1);
    expect(mockRefundSaleItem).not.toHaveBeenCalled();
  });

  // finding 1 (defensive branch) — a session-linked preview that's missing
  // either id (a malformed/partial response) must surface the SAME "could
  // not resolve" error the old two-hop lookup used on failure, never crash
  // or silently open the modal with `undefined` ids. Round-3 review
  // (finding 1) — also asserts the notification's TEXT (a "clear error
  // toast", not just the modal's absence), and the sibling test right below
  // proves the "Refund item" path (openItemRefund) has the SAME guard —
  // previously only "Refund Sale" (openWholeSaleRefund) was covered here.
  it('a session-linked preview missing sessionId/sessionTransactionId shows an error toast and never opens the modal ("Refund Sale")', async () => {
    mockPreview({
      success: true,
      legs: [],
      sessionLinked: true,
      // sessionId/sessionTransactionId deliberately omitted.
    });
    const emitSpy = jest.spyOn(appEvents, "emit");

    render(<SaleDetailModal saleId={4} onClose={jest.fn()} />);
    await screen.findByText("Sale #4");

    fireEvent.click(await screen.findByText("Refund Sale"));

    await waitFor(() => expect(mockGetSaleRefundPreview).toHaveBeenCalled());
    expect(screen.queryByTestId("refund-method-modal")).not.toBeInTheDocument();
    expect(mockGetSessionItemRefundPreview).not.toHaveBeenCalled();
    expect(mockRefundSessionBasketItem).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(
      "notification:show",
      expect.stringContaining("Could not resolve this sale's session"),
      "error",
    );
  });

  // Round-3 review (finding 1) — the "Refund item" (openItemRefund) mirror
  // of the guard above: the item-level session-resolution branch has the
  // exact same missing-ids check, but nothing exercised it before this test.
  // NOT proven failing-first (rule 17/MEMORY): `openItemRefund`'s guard
  // already existed, byte-identical to `openWholeSaleRefund`'s (see
  // SaleDetailModal.tsx's file-header note) — this test only adds coverage
  // for a path that was already correct, it does not prove a fix.
  it('a session-linked ITEM preview missing sessionId/sessionTransactionId shows an error toast and never opens the modal ("Refund item")', async () => {
    mockPreview({
      success: true,
      legs: [],
      sessionLinked: true,
      // sessionId/sessionTransactionId deliberately omitted.
    });
    const emitSpy = jest.spyOn(appEvents, "emit");

    render(<SaleDetailModal saleId={4} onClose={jest.fn()} />);
    await screen.findByText("Sale #4");

    fireEvent.click(await screen.findByTitle("Refund item"));
    fireEvent.click(await screen.findByText(/Refund 1x/));

    await waitFor(() =>
      expect(mockGetSaleRefundPreview).toHaveBeenCalledWith(4, {
        saleItemId: 9,
        refundQuantity: 1,
      }),
    );
    expect(screen.queryByTestId("refund-method-modal")).not.toBeInTheDocument();
    expect(mockGetSessionItemRefundPreview).not.toHaveBeenCalled();
    expect(mockRefundSessionBasketItem).not.toHaveBeenCalled();
    expect(mockRefundSaleItem).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(
      "notification:show",
      expect.stringContaining("Could not resolve this sale's session"),
      "error",
    );
  });

  // LIRA-232 round-2 review (finding 3) — a whole-basket session refund
  // reverses a partly item-refunded sale's REMAINING lines through the
  // session-item reversal helper, a different path than this modal's own
  // "Refund Sale"/"Refund item" — so `sale.status` alone can lag behind the
  // per-item `refunded_quantity` state. "Refund Sale" must hide once every
  // LOADED line is already fully refunded, even if `sale.status` is still
  // "completed", so a stale-open modal can't offer a button that's
  // guaranteed to error. NOT proven failing-first (the SaleDetailModal
  // fallback landed in the same pass as this test — rule 17/MEMORY).
  it('"Refund Sale" is hidden once every item is fully refunded, even when sale.status has not caught up', async () => {
    mockGetSale.mockResolvedValue({ ...SALE, status: "completed" });
    mockGetSaleItems.mockResolvedValue([
      { ...ITEM, refunded_quantity: 1 }, // quantity 1 → fully refunded
    ]);

    render(<SaleDetailModal saleId={4} onClose={jest.fn()} />);
    await screen.findByText("Sale #4");

    expect(screen.queryByText("Refund Sale")).not.toBeInTheDocument();
  });
});
