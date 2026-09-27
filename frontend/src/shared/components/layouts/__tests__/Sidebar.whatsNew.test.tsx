/**
 * Sidebar — app-version label reopens "What's new" (LiraTek release-notes
 * pipeline). Written FIRST (rule 17): Sidebar.tsx does not yet accept an
 * `onOpenWhatsNew` prop, so this fails red before that change lands.
 *
 * Mocking pattern copied from HomeGrid.test.tsx (same directory tree) —
 * useAuth/useModules/useFeatureFlags/useShopName are mocked so Sidebar can
 * render standalone; useSidebarFavorites is left real (jsdom localStorage).
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Sidebar from "../Sidebar";
import type { ModuleInfo } from "@/contexts/ModuleContext";

const mockEnabledModules: ModuleInfo[] = [
  {
    key: "pos",
    label: "POS",
    icon: "ShoppingCart",
    route: "/pos",
    sort_order: 1,
    is_enabled: 1,
    admin_only: 0,
    is_system: 1,
  },
];

jest.mock("@/contexts/ModuleContext", () => ({
  useModules: () => ({ enabledModules: mockEnabledModules }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin" } }),
}));

jest.mock("@/contexts/FeatureFlagContext", () => ({
  useFeatureFlags: () => ({
    flags: { sessionManagement: false, customerSessions: true },
  }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopName: () => "Corner Tech",
}));

function renderSidebar(props: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  return render(
    <MemoryRouter>
      <Sidebar
        isCollapsed={false}
        toggleSidebar={jest.fn()}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("Sidebar — What's new reopen", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("clicking the version label calls onOpenWhatsNew", () => {
    const onOpenWhatsNew = jest.fn();
    renderSidebar({ onOpenWhatsNew });

    const versionButton = screen.getByRole("button", { name: /what's new/i });
    fireEvent.click(versionButton);

    expect(onOpenWhatsNew).toHaveBeenCalledTimes(1);
  });

  it("still shows the version text inside the button", () => {
    renderSidebar({ onOpenWhatsNew: jest.fn() });
    const versionButton = screen.getByRole("button", { name: /what's new/i });
    expect(versionButton.textContent).toMatch(/^v/);
  });

  it("without onOpenWhatsNew, the version label is not an interactive button", () => {
    renderSidebar();
    expect(
      screen.queryByRole("button", { name: /what's new/i }),
    ).not.toBeInTheDocument();
  });
});
