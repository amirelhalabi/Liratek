/** @jest-environment jsdom */

import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmModal } from "../ConfirmModal";
// @testing-library/jest-dom matchers are global (jest.setup.ts) — no import needed.

// useModalFocusFix is a non-pure dependency (touches window.api / navigator).
// It is a no-op outside Windows, but mock it so these tests stay isolated.
jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: jest.fn(),
}));

interface RenderOptions {
  isOpen?: boolean;
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "info";
  onConfirm?: () => void;
  onCancel?: () => void;
}

function renderModal(options: RenderOptions = {}) {
  const onConfirm = options.onConfirm ?? jest.fn();
  const onCancel = options.onCancel ?? jest.fn();
  // Only forward optional props when defined — the project uses
  // exactOptionalPropertyTypes, so passing an explicit `undefined` to a
  // required string prop is a type error.
  const optionalProps: {
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: "danger" | "warning" | "info";
  } = {};
  if (options.confirmLabel !== undefined)
    optionalProps.confirmLabel = options.confirmLabel;
  if (options.cancelLabel !== undefined)
    optionalProps.cancelLabel = options.cancelLabel;
  if (options.variant !== undefined) optionalProps.variant = options.variant;

  render(
    <ConfirmModal
      isOpen={options.isOpen ?? true}
      title={options.title ?? "Delete product"}
      message={options.message ?? "Are you sure you want to delete this?"}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...optionalProps}
    />,
  );
  return { onConfirm, onCancel };
}

describe("ConfirmModal", () => {
  it("renders the title and message when open", () => {
    renderModal({ title: "Clear cart", message: "Remove all items?" });

    expect(screen.getByTestId("confirm-modal")).toBeInTheDocument();
    expect(screen.getByText("Clear cart")).toBeInTheDocument();
    expect(screen.getByText("Remove all items?")).toBeInTheDocument();
  });

  it("uses default Confirm/Cancel labels when none are provided", () => {
    renderModal();

    expect(screen.getByTestId("confirm-modal-confirm-btn")).toHaveTextContent(
      "Confirm",
    );
    expect(screen.getByTestId("confirm-modal-cancel-btn")).toHaveTextContent(
      "Cancel",
    );
  });

  it("renders custom confirm/cancel labels", () => {
    renderModal({ confirmLabel: "Delete", cancelLabel: "Keep it" });

    expect(screen.getByTestId("confirm-modal-confirm-btn")).toHaveTextContent(
      "Delete",
    );
    expect(screen.getByTestId("confirm-modal-cancel-btn")).toHaveTextContent(
      "Keep it",
    );
  });

  it("does not render anything when closed (isOpen=false)", () => {
    renderModal({ isOpen: false });

    expect(screen.queryByTestId("confirm-modal")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("confirm-modal-confirm-btn"),
    ).not.toBeInTheDocument();
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    const { onConfirm, onCancel } = renderModal();

    fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel when the cancel button is clicked", () => {
    const { onConfirm, onCancel } = renderModal();

    fireEvent.click(screen.getByTestId("confirm-modal-cancel-btn"));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onCancel when the backdrop (overlay) is clicked", () => {
    const { onCancel } = renderModal();

    // The overlay is the parent of the modal panel; mousedown on it triggers cancel.
    const overlay = screen.getByTestId("confirm-modal").parentElement;
    expect(overlay).not.toBeNull();
    fireEvent.mouseDown(overlay as HTMLElement);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onCancel when the modal panel itself is clicked", () => {
    const { onCancel } = renderModal();

    fireEvent.mouseDown(screen.getByTestId("confirm-modal"));

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("applies red (danger) styling to the confirm button by default", () => {
    renderModal();

    // Old e2e asserted the confirm button has the red danger token.
    expect(screen.getByTestId("confirm-modal-confirm-btn").className).toContain(
      "bg-red-600",
    );
  });

  it("applies the danger variant red styling explicitly", () => {
    renderModal({ variant: "danger" });

    expect(screen.getByTestId("confirm-modal-confirm-btn").className).toContain(
      "bg-red-600",
    );
  });

  it("applies amber styling for the warning variant (not red)", () => {
    renderModal({ variant: "warning" });

    const confirmBtn = screen.getByTestId("confirm-modal-confirm-btn");
    expect(confirmBtn.className).toContain("bg-amber-600");
    expect(confirmBtn.className).not.toContain("bg-red-600");
  });

  it("applies violet styling for the info variant (not red)", () => {
    renderModal({ variant: "info" });

    const confirmBtn = screen.getByTestId("confirm-modal-confirm-btn");
    expect(confirmBtn.className).toContain("bg-violet-600");
    expect(confirmBtn.className).not.toContain("bg-red-600");
  });
});
