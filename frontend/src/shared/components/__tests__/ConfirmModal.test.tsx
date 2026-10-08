/** @jest-environment jsdom */

import { readFileSync } from "fs";
import { resolve } from "path";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmModal } from "@liratek/ui";
// @testing-library/jest-dom matchers are global (jest.setup.ts) — no import needed.

// ConfirmModal uses the shared `useModalFocusFix` hook (owned by @liratek/ui).
// It is a no-op under jsdom's default non-Windows user agent, so the
// rendering tests below need no mocking; the focus-fix behaviour itself is
// pinned in the "Windows focus fix" block at the bottom of this file.

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

describe("ConfirmModal — Windows focus fix (useModalFocusFix)", () => {
  const WINDOWS_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Electron/31.0.0";

  function modal(isOpen: boolean) {
    return (
      <ConfirmModal
        isOpen={isOpen}
        title="Delete product"
        message="Sure?"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    Reflect.deleteProperty(window, "api");
  });

  it("desktop on Windows: calls fixFocus only AFTER the modal is gone, not during close", () => {
    jest.spyOn(navigator, "userAgent", "get").mockReturnValue(WINDOWS_UA);
    const fixFocus = jest.fn();
    Object.defineProperty(window, "api", {
      value: { display: { fixFocus } },
      configurable: true,
      writable: true,
    });

    const { rerender } = render(modal(true));
    rerender(modal(false));

    // Firing synchronously in the close cleanup runs while the fixed overlay
    // is still in the DOM, which leaves the Chromium compositor confused.
    expect(screen.queryByTestId("confirm-modal")).not.toBeInTheDocument();
    expect(fixFocus).not.toHaveBeenCalled();

    jest.advanceTimersByTime(300);
    expect(fixFocus).toHaveBeenCalledTimes(1);
  });

  it("web on Windows (no preload bridge): open/close never throws", () => {
    jest.spyOn(navigator, "userAgent", "get").mockReturnValue(WINDOWS_UA);
    Reflect.deleteProperty(window, "api");

    const { rerender } = render(modal(true));
    expect(() => {
      rerender(modal(false));
      jest.advanceTimersByTime(1000);
    }).not.toThrow();
    expect(screen.queryByTestId("confirm-modal")).not.toBeInTheDocument();
  });

  it("non-Windows (browser/web, mac desktop): never touches window.api", () => {
    const apiGetter = jest.fn(() => undefined);
    Object.defineProperty(window, "api", {
      get: apiGetter,
      configurable: true,
    });

    const { rerender } = render(modal(true));
    rerender(modal(false));
    jest.advanceTimersByTime(1000);

    expect(apiGetter).not.toHaveBeenCalled();
  });

  it("source guard: no `any` and no raw window.api access in ConfirmModal", () => {
    // packages/ui's "lint" is tsc only (no-explicit-any is not enforced
    // there), so this is the only check that keeps the cast out.
    const src = readFileSync(
      resolve(
        __dirname,
        "../../../../../packages/ui/src/components/ui/ConfirmModal.tsx",
      ),
      "utf8",
    );
    expect(src).not.toMatch(/\bas any\b|:\s*any\b/);
    expect(src).not.toMatch(/window\s*(as\s+[^)]*\))?\s*\)?\s*\.api/);
    expect(src).toMatch(/useModalFocusFix\(isOpen\)/);
  });
});
