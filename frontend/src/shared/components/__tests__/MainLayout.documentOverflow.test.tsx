/** @jest-environment jsdom */
/**
 * Layout bug: opening the OMT/Whish "OMT Service" dropdown could scroll the
 * whole document sideways, dragging the sidebar and the top-left of the
 * header out of view. Root cause: LeftPanelLayout/HomeViewLayout are both
 * `h-screen overflow-hidden` wrapping a `<main overflow-auto>` — the
 * document itself was never meant to scroll — but nothing enforced that.
 * `Select`'s option panel (packages/ui/src/components/ui/Select.tsx) is
 * portaled to <body>, outside that shell, and @floating-ui/dom positions it
 * with `strategy: "absolute"`; an absolutely positioned element in <body>
 * contributes to the DOCUMENT's scrollable area, so focusing it could pull
 * the whole app shell sideways.
 *
 * The fix (MainLayout.tsx) locks `html`/`body` overflow to "hidden" while
 * the shop app is mounted and restores the prior inline value on unmount —
 * scoped to MainLayout specifically because Signup and SuperAdminLayout are
 * both `min-h-screen` with no overflow guard of their own and are mounted
 * OUTSIDE MainLayout (App.tsx: `/login`/`/signup` are standalone routes,
 * SuperAdminRoute uses SuperAdminLayout). A blanket rule would make their
 * content unreachable on a short window; restoring on unmount matters
 * because logging out unmounts MainLayout and returns to `/login`, which
 * must still be able to scroll.
 *
 * Rule 17 (failing-first): this test was run against a version of the
 * effect's cleanup that reset `overflow` to `""` unconditionally instead of
 * restoring the saved previous value — it failed exactly where expected
 * (the unmount assertion, expecting "scroll" and receiving ""), confirming
 * the test actually exercises the restore path. See the task report for the
 * observed RED output.
 */
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";

jest.mock("../layouts/LeftPanelLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="left-panel-layout">{children}</div>
  ),
}));

jest.mock("../layouts/HomeViewLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="home-view-layout">{children}</div>
  ),
}));

jest.mock("@liratek/ui", () => ({
  __esModule: true,
  NotificationCenter: () => null,
  appEvents: { on: jest.fn(() => jest.fn()) },
}));

jest.mock("@/features/closing/pages/Checkpoint", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  __esModule: true,
  useAuth: () => ({ user: { id: 1, role: "cashier" } }),
}));

jest.mock("@/contexts/FeatureFlagContext", () => ({
  __esModule: true,
  useFeatureFlags: () => ({ flags: {} }),
}));

jest.mock("@/features/admin/components/ImpersonationBanner", () => ({
  __esModule: true,
  ImpersonationBanner: () => null,
}));

jest.mock("@/shared/components/SubscriptionBanner", () => ({
  __esModule: true,
  SubscriptionBanner: () => null,
}));

describe("MainLayout — locks the document from scrolling while the shop app is mounted", () => {
  beforeEach(() => {
    // A distinct sentinel (not "" and not "hidden") so the unmount
    // assertion actually proves restoration, rather than merely landing
    // back on the default empty string.
    document.documentElement.style.overflow = "scroll";
    document.body.style.overflow = "scroll";
  });

  afterEach(() => {
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
  });

  it("sets html/body to overflow:hidden on mount and restores the prior value on unmount", () => {
    const { unmount } = render(
      <MemoryRouter>
        <MainLayout>
          <div>content</div>
        </MainLayout>
      </MemoryRouter>,
    );

    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("hidden");

    unmount();

    expect(document.documentElement.style.overflow).toBe("scroll");
    expect(document.body.style.overflow).toBe("scroll");
  });
});
