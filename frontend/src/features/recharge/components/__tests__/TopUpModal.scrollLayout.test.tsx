/** @jest-environment jsdom */

// NOT RUN — proven at the end-of-batch gate.
//
// LIRA-141 (scroll bug) — TopUpModal's panel used to have no max height and
// the scrollable "Content" div had no overflow, so Cancel/Confirm — which
// lived INSIDE that same unscrolled div (packages/ui/src/components/ui/
// TopUpModal.tsx, pre-fix :839-879) — became unreachable whenever the modal
// content (e.g. Whish App "From Client": mode toggle, fee breakdown, client
// picker, MultiPaymentInput payout block, info box, footer) grew taller than
// the viewport. Mouse-wheel scrolling did nothing (the overlay/panel had no
// overflow of its own) and Playwright's scroll-into-view retried 58 times
// and timed out (see OWNER_NOTES_REMAINING_BUILD.md #lira-141 evidence).
//
// The fix (CashReportModal's existing scrollable-modal pattern): the panel
// gets `max-h-[90vh]` + `flex flex-col`; the header and the new dedicated
// footer are `shrink-0`; only the body between them is
// `flex-1 min-h-0 overflow-y-auto`. jsdom has no real layout engine, so this
// test can only pin the STRUCTURE (the confirm/cancel buttons are outside
// the scrolling container, and that container is marked overflow-y-auto) —
// it cannot prove pixels actually scroll. The real proof is the lira-141 e2e
// re-run (Case B), which the owner runs (CLAUDE.md: owner runs e2e/dev).
//
// Rule 17: this test is written to FAIL against the pre-fix markup (footer
// buttons as the last children inside the same `p-6 space-y-5` div as the
// rest of the content, no `overflow-y-auto` anywhere in the panel) — that
// pre-fix shape has no element matching `[class*="overflow-y-auto"]` at
// all, so the very first assertion (the scroll container must exist) fails
// outright. Per the owner process rule for this batch, this has not been
// executed yet; it is proven failing-then-passing at the end-of-batch gate,
// not asserted here.

import { render, screen } from "@testing-library/react";
import { TopUpModal } from "@liratek/ui";

const ALL_DRAWERS = [{ name: "General", usdBalance: 500, lbpBalance: 0 }];

describe("TopUpModal — scrollable-modal layout (LIRA-141)", () => {
  it("keeps Cancel/Confirm outside the scrolling body, in a fixed footer", () => {
    render(
      <TopUpModal
        isOpen
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        provider="MTC"
        allDrawers={ALL_DRAWERS}
        destinationDrawer="MTC"
        defaultSourceDrawer="General"
      />,
    );

    const scrollBody = document.querySelector('[class*="overflow-y-auto"]');
    expect(scrollBody).not.toBeNull();

    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    const confirmButton = screen.getByRole("button", {
      name: /confirm top-up/i,
    });

    expect(scrollBody?.contains(cancelButton)).toBe(false);
    expect(scrollBody?.contains(confirmButton)).toBe(false);

    // The panel itself must cap its height so the flex layout has something
    // to overflow against — without a max-h, flex-1/overflow-y-auto on the
    // body never engages because the panel just grows to fit its content.
    const panel = confirmButton.closest('[class*="max-h-"]');
    expect(panel).not.toBeNull();
  });
});
