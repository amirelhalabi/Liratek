/** @jest-environment jsdom */
/**
 * LIRA-331 (T023): the home grid's own texts follow the UI language, while
 * module names from the database are shown as stored (OD-3 is a later task).
 */
import { render, screen } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import HomeGrid from "../HomeGrid";
import type { ModuleInfo } from "@/contexts/ModuleContext";

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => jest.fn(),
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
    key: "recharge",
    label: "Recharge",
    icon: "Smartphone",
    route: "/recharge",
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
  useFeatureFlags: () => ({ flags: { sessionManagement: true } }),
}));

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("HomeGrid language", () => {
  it("shows the English texts unchanged", () => {
    render(<HomeGrid />);
    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Mobile Recharge")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint Timeline")).toBeInTheDocument();
  });

  it("shows Arabic texts and keeps stored module names as they are", async () => {
    await loadLanguage("ar");
    await i18n.changeLanguage("ar");
    render(<HomeGrid />);
    expect(
      screen.getByRole("heading", { name: "الرئيسية" }),
    ).toBeInTheDocument();
    expect(screen.getByText("لوحة التحكم")).toBeInTheDocument();
    expect(screen.getByText("تشريج الخليوي")).toBeInTheDocument();
    expect(screen.getByText("إجراءات المدير")).toBeInTheDocument();
    expect(screen.getByText("POS")).toBeInTheDocument();
    expect(screen.getByTestId("grid-favorite-pos")).toHaveAttribute(
      "aria-label",
      "إضافة إلى المفضلة",
    );
  });
});
