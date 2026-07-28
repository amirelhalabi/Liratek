/** @jest-environment jsdom */
/**
 * HomeGrid — favorite/pin star toggle (LIRA-075).
 *
 * The sidebar already has press-and-hold favorites persisted to
 * localStorage["sidebar_favorites"] (see useSidebarFavorites.ts). This adds
 * an explicit star toggle to the home-grid tiles that reads/writes the SAME
 * list, keyed by route — starring a tile here and press-holding it in the
 * sidebar must affect one shared favorites list, not two.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import HomeGrid from "../HomeGrid";
import type { ModuleInfo } from "@/contexts/ModuleContext";

const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

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
  {
    key: "debts",
    label: "Debts",
    icon: "Banknote",
    route: "/debts",
    sort_order: 2,
    is_enabled: 1,
    admin_only: 0,
    is_system: 0,
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

const STORAGE_KEY = "sidebar_favorites";

describe("HomeGrid — favorite star", () => {
  beforeEach(() => {
    localStorage.clear();
    mockNavigate.mockClear();
  });

  it("renders a favorite star on every tile", () => {
    render(<HomeGrid />);

    // Dashboard (hardcoded) + POS + Debts = 3 tiles.
    expect(screen.getByTestId("grid-favorite-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("grid-favorite-pos")).toBeInTheDocument();
    expect(screen.getByTestId("grid-favorite-debts")).toBeInTheDocument();
  });

  it("is unfavorited by default with an 'Add to favorites' label", () => {
    render(<HomeGrid />);

    const star = screen.getByTestId("grid-favorite-pos");
    expect(star).toHaveAttribute("aria-label", "Add to favorites");
    expect(star).toHaveAttribute("title", "Add to favorites");
  });

  it("clicking the star toggles favorited state and persists to the SHARED sidebar_favorites key", () => {
    render(<HomeGrid />);

    const star = screen.getByTestId("grid-favorite-pos");
    fireEvent.click(star);

    expect(star).toHaveAttribute("aria-label", "Remove from favorites");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")).toEqual([
      "/pos",
    ]);

    // Toggle back off.
    fireEvent.click(star);
    expect(star).toHaveAttribute("aria-label", "Add to favorites");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")).toEqual([]);
  });

  it("reflects a favorite already set by the sidebar (same route key) on mount", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["/debts"]));

    render(<HomeGrid />);

    expect(screen.getByTestId("grid-favorite-debts")).toHaveAttribute(
      "aria-label",
      "Remove from favorites",
    );
  });

  it("clicking the star does NOT navigate (stopPropagation on the tile's onClick)", () => {
    render(<HomeGrid />);

    fireEvent.click(screen.getByTestId("grid-favorite-pos"));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("clicking the tile itself (not the star) still navigates", () => {
    render(<HomeGrid />);

    fireEvent.click(screen.getByText("POS"));

    expect(mockNavigate).toHaveBeenCalledWith("/pos");
  });

  // Keyboard accessibility: the star is a real nested <button>,
  // reachable by Tab. Enter/Space on it must toggle the favorite — not bubble
  // to the tile's own keydown handler and navigate away instead. A `role`
  // div's onClick fires from keyboard-only Enter/Space if userEvent
  // synthesizes it, but jsdom's fireEvent does NOT synthesize a native
  // click from a keydown the way a real browser does — so these assert on
  // the explicit keyboard handler the component now implements directly,
  // not on native click synthesis.
  it("pressing Enter on the star toggles the favorite and does NOT navigate", () => {
    render(<HomeGrid />);

    const star = screen.getByTestId("grid-favorite-pos");
    fireEvent.keyDown(star, { key: "Enter" });

    expect(star).toHaveAttribute("aria-label", "Remove from favorites");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")).toEqual([
      "/pos",
    ]);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("pressing Space on the star toggles the favorite and does NOT navigate", () => {
    render(<HomeGrid />);

    const star = screen.getByTestId("grid-favorite-pos");
    fireEvent.keyDown(star, { key: " " });

    expect(star).toHaveAttribute("aria-label", "Remove from favorites");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")).toEqual([
      "/pos",
    ]);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("pressing Enter on the tile itself (not the star) still navigates", () => {
    render(<HomeGrid />);

    // The tile root is the role="button" div wrapping the label text.
    const tile = screen.getByText("POS").closest('[role="button"]');
    expect(tile).not.toBeNull();
    fireEvent.keyDown(tile as HTMLElement, { key: "Enter" });

    expect(mockNavigate).toHaveBeenCalledWith("/pos");
  });
});
