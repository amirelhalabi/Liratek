/** @jest-environment jsdom */
/**
 * StepBaseSystem — the "Choose Your Base System" cards show the real OMT /
 * Whish round icons (not a letter in a circle), take their brand colour from
 * `PROVIDER_BRANDS`, and picking a card still records `base_system` and moves
 * to step 3.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import StepBaseSystem from "../StepBaseSystem";
import { PROVIDER_BRANDS } from "@/shared/brand/providerBrands";

const mockUpdatePayload = jest.fn();
const mockSetStep = jest.fn();

jest.mock("../../context/SetupContext", () => ({
  useSetup: () => ({
    updatePayload: mockUpdatePayload,
    setStep: mockSetStep,
  }),
}));

function card(name: string): HTMLElement {
  const label = screen.getByText(name, { selector: "span.text-lg" });
  const button = label.closest("button");
  if (!button) throw new Error(`no card for ${name}`);
  return button;
}

describe("StepBaseSystem", () => {
  beforeEach(() => {
    mockUpdatePayload.mockClear();
    mockSetStep.mockClear();
  });

  it("shows the real OMT and Whish icons instead of letters", () => {
    render(<StepBaseSystem />);
    const omt = card("OMT");
    const whish = card("Whish");
    expect(
      omt.querySelector('[data-testid="provider-logo-omt"]'),
    ).not.toBeNull();
    expect(
      whish.querySelector('[data-testid="provider-logo-whish"]'),
    ).not.toBeNull();
    expect(screen.queryByText("O")).toBeNull();
    expect(screen.queryByText("W")).toBeNull();
  });

  it("takes the hover border colour from PROVIDER_BRANDS, not a typed hex", () => {
    const { container } = render(<StepBaseSystem />);
    expect(card("OMT").className).toContain(PROVIDER_BRANDS.OMT.hoverBorder);
    expect(card("Whish").className).toContain(
      PROVIDER_BRANDS.WHISH.hoverBorder,
    );
    expect(container.innerHTML).not.toContain("#ffde00");
  });

  it.each([
    ["OMT", "OMT"],
    ["Whish", "WHISH"],
  ] as const)(
    "picking %s records base_system and goes to step 3",
    (name, code) => {
      render(<StepBaseSystem />);
      fireEvent.click(card(name));
      expect(mockUpdatePayload).toHaveBeenCalledWith({ base_system: code });
      expect(mockSetStep).toHaveBeenCalledWith(3);
    },
  );
});
