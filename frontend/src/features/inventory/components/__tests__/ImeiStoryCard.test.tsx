/** @jest-environment jsdom */
/**
 * LIRA-143 Phase 6b (decision #7) — the warranty state -> badge label/style
 * mapping (`warrantyBadgeInfo`), plus a light render check that the card
 * actually uses it. `computeWarrantyStatus` itself (the state machine that
 * PRODUCES a `WarrantyStatus`) lives in packages/core and is covered there;
 * this file only covers the frontend's state -> display mapping.
 */
import { render, screen } from "@testing-library/react";
import { ImeiStoryCard } from "../ImeiStoryCard";
import { warrantyBadgeInfo } from "../../productUnitsLogic";
import type { WarrantyStatus } from "../../productUnitsLogic";
import type { UnitStoryEntry } from "../../hooks/useProductUnits";

describe("warrantyBadgeInfo", () => {
  it("COVERED: green family, shows the until date", () => {
    const warranty: WarrantyStatus = {
      source: "SALE",
      until: "2027-01-15",
      state: "COVERED",
    };
    const badge = warrantyBadgeInfo(warranty);
    expect(badge.label).toBe("Covered (until 2027-01-15)");
    expect(badge.className).toMatch(/emerald/);
  });

  it("COVERED with no until date still labels Covered (defensive — state machine always sets one)", () => {
    const warranty: WarrantyStatus = {
      source: "SALE",
      until: null,
      state: "COVERED",
    };
    expect(warrantyBadgeInfo(warranty).label).toBe("Covered");
  });

  it("EXPIRED: amber family, shows the expiry date", () => {
    const warranty: WarrantyStatus = {
      source: "SALE",
      until: "2025-06-01",
      state: "EXPIRED",
    };
    const badge = warrantyBadgeInfo(warranty);
    expect(badge.label).toBe("Expired (2025-06-01)");
    expect(badge.className).toMatch(/amber/);
  });

  it("VOID: amber family, labeled as refunded (never shows a date)", () => {
    const warranty: WarrantyStatus = {
      source: "REFUND",
      until: null,
      state: "VOID",
    };
    const badge = warrantyBadgeInfo(warranty);
    expect(badge.label).toBe("Void (refunded)");
    expect(badge.className).toMatch(/amber/);
  });

  it("NONE: neutral slate family, no warranty ever existed", () => {
    const warranty: WarrantyStatus = {
      source: null,
      until: null,
      state: "NONE",
    };
    const badge = warrantyBadgeInfo(warranty);
    expect(badge.label).toBe("No warranty");
    expect(badge.className).toMatch(/slate/);
  });

  it("EXPIRED and VOID are visually distinct labels sharing the same amber family", () => {
    const expired = warrantyBadgeInfo({
      source: "SALE",
      until: "2025-01-01",
      state: "EXPIRED",
    });
    const void_ = warrantyBadgeInfo({
      source: "REFUND",
      until: null,
      state: "VOID",
    });
    expect(expired.label).not.toBe(void_.label);
    expect(expired.className).toBe(void_.className);
  });
});

function makeStory(overrides: Partial<UnitStoryEntry> = {}): UnitStoryEntry {
  return {
    id: 1,
    product_id: 10,
    imei: "356938035643809",
    status: "SOLD",
    sale_item_id: 5,
    is_defective: 0,
    warranty_override_until: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    product_name: "iPhone 13",
    product_deleted: null,
    // Default: the MODEL grants no warranty term, so a NONE verdict below
    // really is "No warranty" rather than "not yet".
    product_warranty_months: null,
    warranty_until: "2027-01-01",
    is_refunded: 0,
    refunded_quantity: 0,
    quantity: 1,
    sold_price_usd: 500,
    sale_id: 7,
    sold_at: "2026-01-01T00:00:00.000Z",
    client_id: 3,
    client_name: "Jane Doe",
    warranty: { source: "SALE", until: "2027-01-01", state: "COVERED" },
    ...overrides,
  };
}

describe("ImeiStoryCard render", () => {
  it("renders the imei, product name, client name, and the warranty badge", () => {
    render(<ImeiStoryCard story={makeStory()} />);
    expect(screen.getByText("356938035643809")).toBeInTheDocument();
    expect(screen.getByText("iPhone 13")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByTestId("imei-story-warranty-badge")).toHaveTextContent(
      "Covered (until 2027-01-01)",
    );
  });

  it("shows a dash for client name when the unit was never sold", () => {
    render(
      <ImeiStoryCard
        story={makeStory({
          status: "IN_STOCK",
          sale_item_id: null,
          client_name: null,
          sold_at: null,
          sold_price_usd: null,
          warranty: { source: null, until: null, state: "NONE" },
        })}
      />,
    );
    expect(screen.getByTestId("imei-story-warranty-badge")).toHaveTextContent(
      "Not sold",
    );
  });

  /**
   * LIRA-296 follow-up (owner decision 2026-10-10) — supersedes 2026-08-27's
   * "keep Void (refunded) on the card": a unit back on the shelf reads
   * "Not sold" here exactly as in the Phone Units table, whatever its stored
   * verdict — a refunded sale's VOID or an old refund-time override date.
   */
  it("reads Not sold for a refunded unit back in stock (VOID verdict)", () => {
    render(
      <ImeiStoryCard
        story={makeStory({
          status: "IN_STOCK",
          is_refunded: 1,
          warranty: { source: "REFUND", until: null, state: "VOID" },
        })}
      />,
    );
    const badge = screen.getByTestId("imei-story-warranty-badge");
    expect(badge).toHaveTextContent("Not sold");
    expect(badge).not.toHaveTextContent("Void");
  });

  it("reads Not sold for an in-stock unit carrying an old override date", () => {
    render(
      <ImeiStoryCard
        story={makeStory({
          status: "IN_STOCK",
          warranty_override_until: "2027-03-01",
          warranty: { source: "OVERRIDE", until: "2027-03-01", state: "COVERED" },
        })}
      />,
    );
    const badge = screen.getByTestId("imei-story-warranty-badge");
    expect(badge).toHaveTextContent("Not sold");
    expect(badge).not.toHaveTextContent("Covered");
  });

  /** Owner-reported 2026-08-26 — the next sale's term is still stated. */
  it("adds the model's term for an unsold unit of a model that grants one", () => {
    render(
      <ImeiStoryCard
        story={makeStory({
          status: "IN_STOCK",
          sale_item_id: null,
          client_name: null,
          sold_at: null,
          sold_price_usd: null,
          warranty_until: null,
          product_warranty_months: 6,
          warranty: { source: null, until: null, state: "NONE" },
        })}
      />,
    );
    expect(screen.getByTestId("imei-story-warranty-badge")).toHaveTextContent(
      "Not sold (6 mo from sale)",
    );
  });

  it("keeps No warranty for a unit SOLD before its model had a term", () => {
    render(
      <ImeiStoryCard
        story={makeStory({
          status: "SOLD",
          warranty_until: null,
          product_warranty_months: 6,
          warranty: { source: null, until: null, state: "NONE" },
        })}
      />,
    );
    expect(screen.getByTestId("imei-story-warranty-badge")).toHaveTextContent(
      "No warranty",
    );
  });

  it("shows a Defective badge only when is_defective is truthy", () => {
    render(<ImeiStoryCard story={makeStory({ is_defective: 1 })} />);
    expect(screen.getByText("Defective")).toBeInTheDocument();
  });

  it("does not show a Defective badge when is_defective is 0", () => {
    render(<ImeiStoryCard story={makeStory({ is_defective: 0 })} />);
    expect(screen.queryByText("Defective")).not.toBeInTheDocument();
  });

  /**
   * LIRA-172 — `product_deleted` has carried through `UnitStoryEntry` since
   * LIRA-152 (same `UNIT_PROVENANCE_JOIN` fragment that feeds the Phone
   * Units register's own chip), but this card never read it. Mirrors
   * `PhoneUnits/index.tsx`'s `phone-unit-product-deleted-<id>` chip.
   *
   * NOT proven failing-first (LIRA-172): verified by temporarily disabling
   * the fix in place, which rule 17 does not accept.
   */
  it("shows a muted 'Product deleted' chip when product_deleted === 1", () => {
    render(<ImeiStoryCard story={makeStory({ product_deleted: 1 })} />);
    const chip = screen.getByTestId("imei-story-product-deleted");
    expect(chip).toHaveTextContent("Product deleted");
  });

  it("does not show the chip when product_deleted is null (the common case)", () => {
    render(<ImeiStoryCard story={makeStory({ product_deleted: null })} />);
    expect(
      screen.queryByTestId("imei-story-product-deleted"),
    ).not.toBeInTheDocument();
  });

  it("does not show the chip when product_deleted is 0", () => {
    render(<ImeiStoryCard story={makeStory({ product_deleted: 0 })} />);
    expect(
      screen.queryByTestId("imei-story-product-deleted"),
    ).not.toBeInTheDocument();
  });
});
