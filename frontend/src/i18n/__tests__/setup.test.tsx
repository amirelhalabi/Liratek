/**
 * LIRA-331 T016: every jest test renders in English, synchronously, without
 * importing the i18n setup itself (research R8) — so the thousands of
 * existing English-text assertions keep passing as modules convert.
 *
 * This file deliberately does NOT import "@/i18n/setup": jest.setup.ts must.
 */
import { render, screen } from "@testing-library/react";
import { useTranslation } from "react-i18next";

function SaveButton() {
  const { t } = useTranslation("common");
  return <button>{t("actions.save")}</button>;
}

describe("i18n in jest", () => {
  it("a converted component renders its English text on the first render", () => {
    render(<SaveButton />);
    expect(screen.getByRole("button")).toHaveTextContent("Save");
  });

  it("t() from another namespace resolves through the ns prefix", () => {
    function Lang() {
      const { t } = useTranslation(["layout", "common"]);
      return <span>{t("common:language.ar")}</span>;
    }
    render(<Lang />);
    expect(screen.getByText("العربية")).toBeInTheDocument();
  });
});
