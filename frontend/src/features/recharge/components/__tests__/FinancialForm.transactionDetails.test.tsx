/** @jest-environment jsdom */
/**
 * LIRA-329 T019 — a Whish App / OMT App catalog checkout keeps the discount
 * the cashier typed: each unit's transaction carries the share of the typed
 * discount it was charged less (the form already spreads it per unit), in
 * the catalog's currency. Harness copied from FinancialForm.legsCarrier
 * (stub PaymentSheet, plus a discount button).
 *
 * Field names come from the core schema (rule 24).
 * Rule 17: run against the unchanged form first and seen failing (absent).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createFinancialServiceSchema } from "@liratek/core";
import { FinancialForm } from "../FinancialForm";
import type { ServiceItem } from "../../hooks/useMobileServiceItems";
import type { ProviderConfig } from "../../types";

// ── Capture addOMTTransaction payloads ──────────────────────────────────────
const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    addOMTTransaction: mockAddOMTTransaction,
    // useAutoPrintReceipt (LIRA-069 W1.d) pulls shop info via useShopInfo(),
    // which calls this on mount.
    getAllSettings: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ buyRate: 89000, sellRate: 90000 }),
}));

// Client resolution is not under test — always resolves.
jest.mock("../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: 411 }),
}));

// Heavy children with their own data needs — not under test.
jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: () => <input data-testid="stub-client-input" />,
}));
jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));
jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));
jest.mock("../HistoryModal", () => ({
  HistoryModal: () => null,
}));
jest.mock("@/shared/utils/clientVouchers", () => ({
  fetchClientVouchers: jest.fn().mockResolvedValue([]),
}));

// PaymentSheet stub: exposes the callbacks the test drives — inject a split
// (CASH + CUSTOMER_ACCOUNT), a SINGLE line, or a return/change (OUT) leg, and
// confirm. The real sheet's internals (MultiPaymentInput) are covered by
// MultiPaymentInput.test.tsx.
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    onPaymentChange: (lines: unknown[]) => void;
    onReturnChange?: (legs: unknown[]) => void;
    onExchangeRateChange?: (rate: number) => void;
    onDiscountChange?: (d: number) => void;
    onConfirm: () => void;
  }) =>
    props.open ? (
      <div data-testid="stub-payment-sheet">
        <button
          data-testid="stub-inject-split"
          onClick={() =>
            props.onPaymentChange([
              { id: "L1", method: "CASH", currencyCode: "LBP", amount: 500000 },
              {
                id: "L2",
                method: "CUSTOMER_ACCOUNT",
                currencyCode: "LBP",
                amount: 100000,
              },
            ])
          }
        />
        <button
          data-testid="stub-inject-single"
          onClick={() =>
            props.onPaymentChange([
              { id: "L1", method: "CASH", currencyCode: "LBP", amount: 300000 },
            ])
          }
        />
        <button
          data-testid="stub-inject-return"
          onClick={() =>
            props.onReturnChange?.([
              {
                id: "R1",
                method: "CASH",
                currencyCode: "LBP",
                amount: 50000,
                direction: "OUT",
              },
            ])
          }
        />
        <button
          data-testid="stub-edit-rate"
          onClick={() => props.onExchangeRateChange?.(87500)}
        />
        <button
          data-testid="stub-discount"
          onClick={() => props.onDiscountChange?.(20000)}
        />
        <button data-testid="stub-confirm" onClick={props.onConfirm} />
      </div>
    ) : null,
}));

// ── Fixtures ────────────────────────────────────────────────────────────────
const ITEM: ServiceItem = {
  key: "WHISH_APP/bills/Internet/DSL 300k",
  provider: "WHISH_APP",
  category: "bills",
  subcategory: "Internet",
  label: "DSL 300k",
  catalogCost: 250000,
  catalogSellPrice: 300000,
  sortOrder: 0,
};

const CONFIG: ProviderConfig = {
  key: "WHISH_APP",
  label: "Whish App",
  module: "ipec_katch",
  drawer: "Whish_App",
  formMode: "financial",
  color: "text-red-400",
  bgTint: "bg-red-400/10",
  activeBg: "bg-red-500",
  activeText: "text-white",
  badgeCls: "bg-red-400/10 text-red-400",
  iconKey: "Zap",
  hasSupplier: true,
};

function renderForm() {
  return render(
    <FinancialForm
      activeConfig={CONFIG}
      finTransactions={[]}
      activeProvider="WHISH_APP"
      getCategoriesForProvider={() => ["bills"]}
      getServiceItems={(_p, category) => (category === "bills" ? [ITEM] : [])}
      methods={[
        { code: "CASH", label: "Cash" },
        { code: "CUSTOMER_ACCOUNT", label: "Customer Account (Debt)" },
      ]}
      drawerAffectingMethods={[{ code: "CASH", label: "Cash" }]}
      clientName="amir halabi"
      setClientName={jest.fn()}
      loadFinancialData={jest.fn()}
      formatAmount={(v) => v.toLocaleString()}
      showHistory={false}
      setShowHistory={jest.fn()}
    />,
  );
}

/** Add the fixture item with quantity 2, then open the payment sheet. */
async function cartTwoUnitsAndOpenSheet() {
  // First click on the card adds qty 1 and reveals the +/− stepper.
  fireEvent.click(screen.getByText("DSL 300k"));
  fireEvent.click(await screen.findByRole("button", { name: "+" }));
  fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
  await screen.findByTestId("stub-payment-sheet");
}

describe("FinancialForm — LIRA-329 typed discount", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
  });

  it("two units, 20,000 LBP off: each unit keeps its 10,000 LBP share", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();
    fireEvent.click(screen.getByTestId("stub-discount"));
    fireEvent.click(screen.getByTestId("stub-inject-single"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(2));
    for (const call of mockAddOMTTransaction.mock.calls) {
      const parsed = createFinancialServiceSchema.parse(call[0]);
      expect(parsed.amount).toBe(290000);
      expect(parsed.typedDiscount).toEqual({ amount: 10000, currency: "LBP" });
    }
  });

  it("no discount: no typed discount is sent", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(2));
    for (const call of mockAddOMTTransaction.mock.calls) {
      expect(createFinancialServiceSchema.parse(call[0]).typedDiscount).toBe(
        undefined,
      );
    }
  });
});
