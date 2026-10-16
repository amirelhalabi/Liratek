/**
 * LIRA-326 T007 — the Mobile Recharge basket lives ABOVE the provider forms,
 * so a group's picks survive the form that owns them unmounting (switching
 * Katsh → Whish App → back, or leaving the page).
 */
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  RechargeBasketProvider,
  useBasketBills,
  useBasketPartner,
  useCatalogBasket,
  useWhishBasket,
  useRechargeBasketCounts,
} from "../RechargeBasketContext";
import type { ServiceItem } from "../../hooks/useMobileServiceItems";
import type { PricedLine } from "../../types/basket";

const KATSH: ServiceItem = {
  key: "Katsh/Gaming/Pubg/60 UC",
  provider: "Katsh",
  category: "Gaming",
  subcategory: "Pubg",
  label: "60 UC",
  catalogCost: 82_340,
  catalogSellPrice: 90_000,
  sortOrder: 0,
};
const WHISH: ServiceItem = {
  key: "WHISH_APP/Gaming/PSN/10",
  provider: "WHISH_APP",
  category: "Gaming",
  subcategory: "PSN",
  label: "PSN $10",
  catalogCost: 897_000,
  catalogSellPrice: 900_000,
  sortOrder: 0,
};

const WHISH_LINE: PricedLine = {
  key: WHISH.key,
  provider: "WHISH_APP",
  label: "PSN x1",
  currency: "LBP",
  amount: 900_000,
  cost: 897_000,
  commission: 3_000,
  subItems: [],
  sheetItem: {
    key: WHISH.key,
    name: "PSN $10",
    quantity: 1,
    unitPrice: 900_000,
    currency: "LBP",
  },
};

function CatalogTab() {
  const { cart, setCart, others } = useCatalogBasket();
  return (
    <div>
      <span data-testid="catalog-count">{cart.size}</span>
      <span data-testid="catalog-others">{others.length}</span>
      <button
        onClick={() =>
          setCart((prev) => {
            const next = new Map(prev);
            next.set(KATSH.key, {
              item: KATSH,
              quantity: 1,
              onlyDays: false,
              returnedCreditsUsd: 0,
              returnedCreditsEdited: false,
            });
            return next;
          })
        }
      >
        pick-katsh
      </button>
    </div>
  );
}

function WhishTab() {
  const { cart, setCart, setPriced } = useWhishBasket(true);
  return (
    <div>
      <span data-testid="whish-count">{cart.size}</span>
      <button
        onClick={() => {
          setCart(new Map([[WHISH.key, { item: WHISH, quantity: 1 }]]));
          setPriced([WHISH_LINE]);
        }}
      >
        pick-whish
      </button>
    </div>
  );
}

function Counts() {
  const counts = useRechargeBasketCounts();
  return <span data-testid="counts">{JSON.stringify(counts)}</span>;
}

function Harness() {
  const [tab, setTab] = useState<"catalog" | "whish" | "other">("catalog");
  return (
    <RechargeBasketProvider>
      <button onClick={() => setTab("catalog")}>tab-catalog</button>
      <button onClick={() => setTab("whish")}>tab-whish</button>
      <button onClick={() => setTab("other")}>tab-other</button>
      {tab === "catalog" && <CatalogTab />}
      {tab === "whish" && <WhishTab />}
      <Counts />
    </RechargeBasketProvider>
  );
}

describe("RechargeBasketContext (LIRA-326)", () => {
  it("keeps each group's cart when the form that owns it unmounts and remounts", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("pick-katsh"));
    expect(screen.getByTestId("catalog-count")).toHaveTextContent("1");

    // Katsh → Whish App: the catalog form unmounts.
    fireEvent.click(screen.getByText("tab-whish"));
    fireEvent.click(screen.getByText("pick-whish"));
    expect(screen.getByTestId("whish-count")).toHaveTextContent("1");

    // A tab with no grid, then back.
    fireEvent.click(screen.getByText("tab-other"));
    fireEvent.click(screen.getByText("tab-catalog"));
    expect(screen.getByTestId("catalog-count")).toHaveTextContent("1");
    // The catalog tab sees the Whish App group's priced lines.
    expect(screen.getByTestId("catalog-others")).toHaveTextContent("1");

    fireEvent.click(screen.getByText("tab-whish"));
    expect(screen.getByTestId("whish-count")).toHaveTextContent("1");
  });

  it("counts every provider's picks, whichever tab is showing", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("pick-katsh"));
    fireEvent.click(screen.getByText("tab-whish"));
    fireEvent.click(screen.getByText("pick-whish"));
    fireEvent.click(screen.getByText("tab-other"));
    expect(
      JSON.parse(screen.getByTestId("counts").textContent ?? "{}"),
    ).toEqual({ Katsh: 1, WHISH_APP: 1 });
  });

  it("works without a provider (local cart, nothing shared)", () => {
    render(<CatalogTab />);
    fireEvent.click(screen.getByText("pick-katsh"));
    expect(screen.getByTestId("catalog-count")).toHaveTextContent("1");
    expect(screen.getByTestId("catalog-others")).toHaveTextContent("0");
  });
});

// ─── LIRA-327: bills and For Partner live in the basket ──────────────────────
// (written after the code — not proven failing-first; the failing-first
// guards are in RechargeBasket.crossProvider.test.tsx.)

function BillsTab() {
  const { bills, setBills, billLines } = useBasketBills();
  const { forPartner, partnerId, setForPartner, setPartnerId, shared } =
    useBasketPartner(true);
  const { clearAll } = useCatalogBasket();
  return (
    <div>
      <span data-testid="bills">{bills.length}</span>
      <span data-testid="bill-providers">
        {billLines
          .map((l) => `${l.provider}:${l.sheetItem.provider}`)
          .join(",")}
      </span>
      <span data-testid="partner">{`${forPartner}|${partnerId}|${shared}`}</span>
      <button
        onClick={() =>
          setBills((p) => [
            ...p,
            { id: "b1", provider: "Katsh", amount: 50_000, currency: "LBP" },
          ])
        }
      >
        add-bill
      </button>
      <button
        onClick={() => {
          setForPartner(true);
          setPartnerId(7);
        }}
      >
        partner-on
      </button>
      <button onClick={() => setForPartner(false)}>partner-off</button>
      <button onClick={clearAll}>clear</button>
    </div>
  );
}

function WhishPartner() {
  const { forPartner, partnerId } = useBasketPartner(true);
  const { others } = useWhishBasket(true);
  return (
    <div>
      <span data-testid="whish-partner">{`${forPartner}|${partnerId}`}</span>
      <span data-testid="whish-others">
        {others.map((l) => l.kind ?? "card").join(",")}
      </span>
    </div>
  );
}

function OtherProviderPartner() {
  const { forPartner, shared } = useBasketPartner(false);
  return <span data-testid="other-partner">{`${forPartner}|${shared}`}</span>;
}

function BillsHarness() {
  const [tab, setTab] = useState<"bills" | "whish">("bills");
  return (
    <RechargeBasketProvider>
      <button onClick={() => setTab("bills")}>tab-bills</button>
      <button onClick={() => setTab("whish")}>tab-whish</button>
      {tab === "bills" ? <BillsTab /> : <WhishPartner />}
      <OtherProviderPartner />
      <Counts />
    </RechargeBasketProvider>
  );
}

describe("RechargeBasketContext — bills and For Partner (LIRA-327)", () => {
  it("bills survive the Bill card unmounting, count on their own tab and reach the Whish App tab, priced under their provider", () => {
    render(<BillsHarness />);
    fireEvent.click(screen.getByText("add-bill"));
    expect(screen.getByTestId("bill-providers")).toHaveTextContent(
      "Katsh:KATSH",
    );
    fireEvent.click(screen.getByText("tab-whish"));
    expect(screen.getByTestId("whish-others")).toHaveTextContent("bill");
    expect(JSON.parse(screen.getByTestId("counts").textContent!)).toEqual({
      Katsh: 1,
    });
    fireEvent.click(screen.getByText("tab-bills"));
    expect(screen.getByTestId("bills")).toHaveTextContent("1");
  });

  it("For Partner is shared by every basket tab, never by another provider; clearing the basket drops the bills and turns it off", () => {
    render(<BillsHarness />);
    fireEvent.click(screen.getByText("add-bill"));
    fireEvent.click(screen.getByText("partner-on"));
    expect(screen.getByTestId("partner")).toHaveTextContent("true|7|true");
    expect(screen.getByTestId("other-partner")).toHaveTextContent(
      "false|false",
    );
    fireEvent.click(screen.getByText("tab-whish"));
    expect(screen.getByTestId("whish-partner")).toHaveTextContent("true|7");

    fireEvent.click(screen.getByText("tab-bills"));
    fireEvent.click(screen.getByText("partner-off"));
    // Off clears the partner too.
    expect(screen.getByTestId("partner")).toHaveTextContent("false|null|true");

    fireEvent.click(screen.getByText("partner-on"));
    fireEvent.click(screen.getByText("clear"));
    expect(screen.getByTestId("bills")).toHaveTextContent("0");
    expect(screen.getByTestId("partner")).toHaveTextContent("false|null|true");
  });
});
