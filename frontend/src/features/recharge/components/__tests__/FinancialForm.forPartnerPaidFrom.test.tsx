/** @jest-environment jsdom */
/**
 * FinancialForm — For-Partner "Paid from" picker must not offer
 * CUSTOMER_ACCOUNT (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §4 defect #5).
 *
 * The picker's selected value becomes an OUT payment leg
 * (handleForPartnerSubmit: `{ method: partnerPaidFromMethod, direction: "OUT" }`)
 * on an addOMTTransaction call with `partnerMode: "FOR"`.
 * `FinancialServiceRepository.partitionLegs` routes any `direction: "OUT"`
 * leg into `returnLegs`, and `assertNoCustomerAccountLeg` (~:2116)
 * hard-rejects the whole transaction if CUSTOMER_ACCOUNT appears there —
 * `affects_drawer = 0` for CUSTOMER_ACCOUNT (create_db.sql:1674), so it is
 * present in the unfiltered `methods` prop but must never reach this picker.
 *
 * The sibling control (OmtWhishAppTransferForm.tsx:849) already renders from
 * `drawerAffectingMethods` — this test pins the same list here, the same
 * class of bug commit fd5444cc fixed on the Services/OMT-Whish page.
 *
 * Proven failing-first (rule 17) against the pre-fix `methods`-fed picker —
 * see the task report for the captured failure output.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { FinancialForm } from "../FinancialForm";
import type { ServiceItem } from "../../hooks/useMobileServiceItems";
import type { ProviderConfig } from "../../types";

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    addOMTTransaction: jest.fn().mockResolvedValue({ success: true, id: 1 }),
    // useAutoPrintReceipt (LIRA-069 W1.d) pulls shop info via useShopInfo(),
    // which calls this on mount.
    getAllSettings: jest.fn().mockResolvedValue([]),
  }),
  // Stub Select so the test can read its `options` prop directly instead of
  // driving the real @headlessui/react Listbox (portal + open/close), the
  // same technique Services.forPartnerPaymentGate.test.tsx uses.
  Select: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select
      data-testid="paid-from-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
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

// Client resolution is not under test.
jest.mock("../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: 411 }),
}));

// Heavy children with their own data needs — not under test. PartnerSelector
// is stubbed to null: this test only needs the checkbox to flip `forPartner`
// on, never a real partner selection (the picker under test is gated on
// `forPartner && hasTransferUnit`, not on `partnerId`).
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
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: () => null,
}));

// A cost=0 unit is a straight system transfer (see FinancialForm.tsx
// `hasTransferUnit`) — the exact case that surfaces the "Paid from" picker.
const TRANSFER_ITEM: ServiceItem = {
  key: "WHISH_APP/transfer/System/System Transfer",
  provider: "WHISH_APP",
  category: "transfer",
  subcategory: "System",
  label: "System Transfer",
  catalogCost: 0,
  catalogSellPrice: 0,
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
      getCategoriesForProvider={() => ["transfer"]}
      getServiceItems={(_p, category) =>
        category === "transfer" ? [TRANSFER_ITEM] : []
      }
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

describe("FinancialForm — For-Partner 'Paid from' picker (defect #5)", () => {
  it("does NOT offer CUSTOMER_ACCOUNT, but still offers CASH", async () => {
    renderForm();

    // Add the cost=0 transfer unit to the cart — triggers `hasTransferUnit`.
    fireEvent.click(screen.getByText("System Transfer"));

    // Flip "For Partner" on.
    fireEvent.click(screen.getByTestId("financial-for-partner-toggle"));

    const select = await screen.findByTestId("paid-from-select");
    const optionLabels = Array.from(select.querySelectorAll("option")).map(
      (o) => o.getAttribute("value"),
    );

    expect(optionLabels).toContain("CASH");
    expect(optionLabels).not.toContain("CUSTOMER_ACCOUNT");
  });
});
