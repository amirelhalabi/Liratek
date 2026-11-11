/**
 * Select — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { Select } from "@liratek/ui";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Select.modalStacking (LIRA-120)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-120 — the shared `@liratek/ui` <Select> renders its option list
   * BEHIND a modal backdrop whose own z-index exceeds Select's hardcoded
   * `z-50` (e.g. Partners' local "Add Credit / Debt" Modal, which uses
   * `z-[60]`).
   *
   * Root cause (confirmed by reading @headlessui/react's source, not
   * guessed): `<ListboxOptions anchor="bottom start">` (Select.tsx — the
   * anchor's exact direction changed later for an unrelated overhang bug, but
   * any `anchor` value forces the same portaling) forces `portal=true`
   * internally the moment `anchor` is set
   * (@headlessui/react/dist/components/listbox/listbox.js:
   * `let{...anchor:s,portal:a=!1,...}=b, o=Ze(s); o&&(a=!0)`). Every open
   * Select in the app is portaled into ONE shared
   * `<div id="headlessui-portal-root">` lazily appended to `<body>`, but
   * headlessui/floating-ui give the PANEL ITSELF `position: absolute`
   * directly (@floating-ui/dom, `strategy: "absolute"`) — the panel's own
   * z-index is what ranks it against the rest of the page. `z-50` loses
   * against any modal declared with a higher explicit z-index elsewhere in
   * the app (Partners' local "Add Credit / Debt" Modal: z-[60];
   * SaleDetailModal's confirm step and Maintenance's panel: z-[60];
   * ConfirmModal/AddTenantModal/DrawerCard: z-[100]; SessionCheckoutModal:
   * z-[200]). Any Select opened inside one of those renders its list BEHIND
   * the backdrop — the trigger's chevron correctly flips (the click DID
   * toggle React's `open` state) but the panel is invisible and unreachable
   * on screen. This is why LIRA-097 was closed wrongly: it read the
   * `options` prop/array and never actually opened the real control.
   *
   * The fix (packages/ui/src/components/ui/Select.tsx) bumps the panel's OWN
   * z-index from `z-50` to `z-[500]` — clearing every modal in the app today
   * (max z-[200]) with headroom below NotificationCenter's toasts (z-[1000],
   * which should stay visible over an open dropdown). Deliberately NOT a fix
   * that touches the shared portal-root ancestor's `position`/stacking
   * (an earlier draft tried `position: relative` + a huge z-index on that
   * shared div): @floating-ui/dom's "absolute" strategy computes the panel's
   * coordinates relative to its actual offsetParent at compute time, and an
   * ancestor's `position` change happening after that computation (this
   * fix would have needed a MutationObserver, since headlessui creates that
   * div outside React's render cycle) risks a stale position until the next
   * unrelated reflow/scroll — a silent, app-wide dropdown-placement
   * regression far worse than the bug being fixed. Bumping THIS element's
   * own z-index carries none of that risk: headlessui already set
   * `position: absolute` on it directly, so nothing about its containing
   * block changes.
   *
   * Rule 17 (failing-first): observed RED against the pre-fix Select.tsx
   * (`z-50` on the options panel) — the rendered listbox's className
   * contained "z-50", not "z-[500]". See task report for the actual red
   * output.
   */

  describe("Select — option panel clears every modal backdrop in the app (LIRA-120)", () => {
    it("opens the real option list with a z-index above every current modal backdrop, and the option is selectable", async () => {
      const onChange = jest.fn();
      render(
        <Select
          value="A"
          onChange={onChange}
          options={[
            { value: "A", label: "Alpha" },
            { value: "B", label: "Beta" },
          ]}
        />,
      );

      // Interaction-level, not a props/options-array read: click the REAL
      // headlessui trigger button.
      fireEvent.click(screen.getByRole("button"));

      // The option list must actually appear as a real, queryable listbox —
      // not just an `options` array on a mocked component.
      const listbox = await screen.findByRole("listbox");
      expect(listbox).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Beta" })).toBeInTheDocument();

      // The mechanism behind LIRA-120: the REAL rendered panel's own z-index
      // must clear the highest modal backdrop in the app today (z-[200],
      // SessionCheckoutModal) — not just tie with Select's old z-50.
      expect(listbox.className).toMatch(/(?:^|\s)z-\[500\](?:\s|$)/);
      expect(listbox.className).not.toMatch(/(?:^|\s)z-50(?:\s|$)/);

      // And the option is genuinely selectable end-to-end.
      fireEvent.click(screen.getByRole("option", { name: "Beta" }));
      expect(onChange).toHaveBeenCalledWith("B");
    });
  });
});

describe("Select.viewportBoundedWidth", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Layout bug: opening the shared `Select`'s option panel on a very wide
   * trigger (e.g. the OMT/Whish "OMT Service" dropdown, ~1500px inside a
   * ~1900px window) could render the panel past the right edge of the
   * window. Because this panel is portaled to <body> (outside the app's
   * `h-screen overflow-hidden` shell — see MainLayout.documentOverflow.test.tsx
   * for the other half of the fix), an overhanging box drags the WHOLE
   * document sideways when the browser scrolls the focused panel into view —
   * hiding the sidebar and the top-left of the header.
   *
   * THE ACTUAL FIX is `anchor="bottom start"` (Select.tsx), not the clamp
   * below. It was shipped as `anchor="bottom end"`, which pins the panel's
   * RIGHT edge to the trigger's right edge; any measurement mismatch between
   * the panel's own width and the trigger's then pushes the panel's LEFT
   * edge further left, with no headroom to absorb it. `anchor="bottom
   * start"` pins the LEFT edge instead, so the same mismatch only ever grows
   * the panel RIGHTWARD — the one direction `shift` (@floating-ui/react-dom,
   * unconditionally enabled here) can always pull back into the viewport.
   * MultiSelect.tsx and InventoryFiltersPopover.tsx already use `anchor=
   * "bottom start"` with no reported overhang, which is corroborating,
   * pre-existing evidence for this direction independent of the theory
   * above. This test file does not re-prove the alignment mechanism itself
   * (that needs real browser layout timing this jsdom suite cannot execute —
   * see the task report for what was and wasn't verified about it); it pins
   * the anchor value as a regression guard, and separately covers the width
   * clamp below.
   *
   * The width clamp (`min-w-[min(var(--button-width),calc(100vw-1rem))]`) is
   * a BACKSTOP for the narrower, pathological case the alignment change does
   * NOT cover: a trigger wider than the viewport itself. It was first
   * attempted as a plain `max-w-[calc(100vw-1rem)]` added alongside the
   * untouched `min-w-[var(--button-width)]` — that was dead code: per the
   * CSS box-sizing algorithm, when `min-width` and `max-width` conflict,
   * **`min-width` wins** — max-width is only applied first and then
   * overridden if the result is still smaller than min-width (CSS2.1 §10.4,
   * restated by every browser's box model). `--button-width` is set by
   * @headlessui/react itself, straight from
   * `buttonElement.getBoundingClientRect().width`
   * (dist/hooks/use-element-size.js, polled via requestAnimationFrame and
   * written as a literal inline `--button-width: <N>px` on the SAME
   * `ListboxOptions` DOM node — dist/components/listbox/listbox.js), and no
   * `max-w-*` class — Tailwind or otherwise — can claw it back once
   * min-width exceeds it. (It's doubly moot: @floating-ui/dom's own `size`
   * middleware ALSO sets an inline `max-width: <availableWidth>px` on this
   * element on every reposition, and an inline style always beats a class
   * regardless of which one wins the min/max conflict — see Select.tsx for
   * where this is documented in full.)
   *
   * The fix clamps the FLOOR instead: `min-w-[min(var(--button-width),
   * calc(100vw-1rem))]`. `min()` resolves BEFORE the box model's min/max-width
   * resolution ever runs, so the value that reaches "min-width" can itself
   * never exceed `calc(100vw-1rem)` — there is no longer a min-width value
   * large enough for the width algorithm's own min-over-max rule to bite.
   *
   * Test-harness limitation (stated up front, not glossed over): this suite
   * runs under jsdom with no compiled Tailwind stylesheet loaded, so
   * `getComputedStyle` cannot resolve `min()`/`calc()`/`var()` to a pixel
   * number here — nor could it in the pre-fix test file, which (like
   * Select.modalStacking.test.tsx) only ever asserted on the raw className
   * string. What this test CAN do for real, without mocking headlessui
   * itself: force @headlessui/react's own real measurement
   * (`getBoundingClientRect`) to report a trigger far wider than any
   * viewport, and confirm (a) the resulting `--button-width` inline custom
   * property on the real rendered panel is genuinely that large, and (b) the
   * authored min-width rule is the clamped `min(...)` form, not the raw
   * `var(--button-width)` form the bug shipped with. Given (a) and (b), the
   * CSS spec cited above is what closes the loop to "the used min-width is
   * viewport-bounded" — true pixel-level confirmation needs a real browser
   * (e2e), which is out of scope for this change.
   *
   * Rule 17 (failing-first): observed RED against the pre-fix
   * `min-w-[var(--button-width)]` (no clamp) — the assertion on the clamped
   * pattern failed exactly as expected. See task report for the actual red
   * output.
   */

  describe("Select — option panel is bounded to the viewport width", () => {
    it("anchors from the trigger's LEFT edge (bottom start), not the right — the actual fix for the reported overhang", async () => {
      const onChange = jest.fn();
      render(
        <Select
          value="A"
          onChange={onChange}
          options={[
            { value: "A", label: "Alpha" },
            { value: "B", label: "Beta" },
          ]}
        />,
      );

      fireEvent.click(screen.getByRole("button"));

      const listbox = await screen.findByRole("listbox");
      // @headlessui/react stamps the resolved anchor directly on the
      // rendered panel as `data-anchor` (internal/floating.js's
      // `useFloatingPanelProps`) — a real, queryable DOM fact, not a
      // read of the source prop.
      expect(listbox.getAttribute("data-anchor")).toBe("bottom start");
    });

    it("carries a max-width capped to the viewport on the real rendered panel (documented as currently superseded by floating-ui's own inline max-width — see Select.tsx)", async () => {
      const onChange = jest.fn();
      render(
        <Select
          value="A"
          onChange={onChange}
          options={[
            { value: "A", label: "Alpha" },
            { value: "B", label: "Beta" },
          ]}
        />,
      );

      fireEvent.click(screen.getByRole("button"));

      const listbox = await screen.findByRole("listbox");
      expect(listbox.className).toMatch(
        /(?:^|\s)max-w-\[calc\(100vw-1rem\)\](?:\s|$)/,
      );
    });

    it("clamps the min-width floor itself against the viewport, even when the real trigger measures far wider than any window", async () => {
      // Force @headlessui/react's OWN measurement of the trigger
      // (getBoundingClientRect, dist/hooks/use-element-size.js) to report a
      // ~3000px-wide button — deliberately far past jsdom's default
      // window.innerWidth (1024px), simulating the OMT trigger that is
      // "near the full form width" in the real bug report. This is real
      // headlessui code running against a mocked DOM primitive, not a
      // fabricated className.
      const originalGetBoundingClientRect =
        HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function (
        this: HTMLElement,
      ) {
        const rect = originalGetBoundingClientRect.call(this);
        return { ...rect, width: 3000 };
      } as typeof HTMLElement.prototype.getBoundingClientRect;

      try {
        const onChange = jest.fn();
        render(
          <Select
            value="A"
            onChange={onChange}
            options={[
              { value: "A", label: "Alpha" },
              { value: "B", label: "Beta" },
            ]}
          />,
        );

        fireEvent.click(screen.getByRole("button"));
        const listbox = await screen.findByRole("listbox");

        // headlessui measures the trigger in a requestAnimationFrame poll
        // (dist/hooks/use-element-size.js) and only commits --button-width
        // once the measured size settles into React state; one flushed frame
        // isn't reliably enough for that state update to land, so flush
        // several (confirmed empirically — see task report).
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }

        // Sanity check the simulation actually exercised headlessui's real
        // measurement path — not a precondition we merely assert by fiat.
        expect(listbox.style.getPropertyValue("--button-width")).toBe("3000px");

        // The defect: the un-clamped rule (`min-w-[var(--button-width)]`)
        // would let the box model's used min-width become 3000px — far past
        // any real window. The fix wraps it in `min()` against the viewport.
        expect(listbox.className).toMatch(
          /(?:^|\s)min-w-\[min\(var\(--button-width\),calc\(100vw-1rem\)\)\](?:\s|$)/,
        );
        expect(listbox.className).not.toMatch(
          /(?:^|\s)min-w-\[var\(--button-width\)\](?:\s|$)/,
        );
      } finally {
        HTMLElement.prototype.getBoundingClientRect =
          originalGetBoundingClientRect;
      }
    });
  });
});
