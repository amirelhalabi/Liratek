/** @jest-environment jsdom */
/**
 * LIRA-331 (T030): My account → Display follows the UI language; the stored
 * preference values (localStorage codes) are the same in both languages.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import DisplayPreferences from "../DisplayPreferences";

jest.mock("@/api/backendApi", () => ({ isElectron: () => false }));
jest.mock("@/shared/utils/uiScale", () => ({ saveAndApplyUiScale: jest.fn() }));

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("en");
});

describe("DisplayPreferences language", () => {
  it("keeps the English labels", () => {
    render(<DisplayPreferences />);
    expect(screen.getByText("Display (this device)")).toBeInTheDocument();
    expect(screen.getByText("Page View")).toBeInTheDocument();
  });

  it("shows Arabic and stores the same codes", async () => {
    await loadLanguage("ar");
    await i18n.changeLanguage("ar");
    render(<DisplayPreferences />);
    expect(screen.getByText("العرض (هذا الجهاز)")).toBeInTheDocument();
    fireEvent.click(screen.getByText("عرض الصفحة"));
    expect(localStorage.getItem("layout_mode")).toBe("page-view");
    fireEvent.click(screen.getByText("عرض الجدول"));
    expect(localStorage.getItem("pos_show_images")).toBe("false");
  });
});
