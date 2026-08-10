/** @jest-environment jsdom */
/**
 * LIRA-120 — the shared `@liratek/ui` <Select> renders its option list
 * BEHIND a modal backdrop whose own z-index exceeds Select's hardcoded
 * `z-50` (e.g. Partners' local "Add Credit / Debt" Modal, which uses
 * `z-[60]`).
 *
 * Root cause (confirmed by reading @headlessui/react's source, not
 * guessed): `<ListboxOptions anchor="bottom end">` (Select.tsx) forces
 * `portal=true` internally the moment `anchor` is set
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
import { render, screen, fireEvent } from "@testing-library/react";
import { Select } from "@liratek/ui";

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
