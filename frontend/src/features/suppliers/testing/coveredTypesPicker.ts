/**
 * Test helpers for `OmtCoveredTypesPicker` (LIRA-322: a `MultiSelect`
 * dropdown). The options live in a portal and only exist while the list is
 * open, so every helper opens it first — and closes it again, because an
 * open list hides the rest of the page from accessibility queries. One
 * definition for every suite that drives the picker.
 */
import { act, fireEvent, screen } from "@testing-library/react";

/** Open the picker's list (no-op when it is already open). */
export async function openCoveredPicker(prefix: string): Promise<void> {
  const button = await screen.findByTestId(prefix);
  if (button.getAttribute("aria-expanded") !== "true") {
    await act(async () => {
      fireEvent.click(button);
    });
  }
  await screen.findByTestId(`${prefix}-option-INTRA`);
}

/** Close the picker's list (no-op when it is already closed). */
export async function closeCoveredPicker(prefix: string): Promise<void> {
  const button = screen.getByTestId(prefix);
  if (button.getAttribute("aria-expanded") === "true") {
    await act(async () => {
      fireEvent.click(button);
    });
  }
}

/** Tick / untick one type (opens the list, then closes it). */
export async function toggleCoveredType(
  prefix: string,
  type: string,
): Promise<void> {
  await openCoveredPicker(prefix);
  await act(async () => {
    fireEvent.click(screen.getByTestId(`${prefix}-option-${type}`));
  });
  await closeCoveredPicker(prefix);
}

/** Is this type ticked? (opens the list, then closes it). */
export async function isCoveredTypeTicked(
  prefix: string,
  type: string,
): Promise<boolean> {
  await openCoveredPicker(prefix);
  const ticked =
    screen
      .getByTestId(`${prefix}-option-${type}`)
      .getAttribute("aria-selected") === "true";
  await closeCoveredPicker(prefix);
  return ticked;
}

/** The closed button reads "All types" when nothing is ticked. */
export function coveredPickerShowsAllTypes(prefix: string): boolean {
  return (screen.getByTestId(prefix).textContent ?? "").includes("All types");
}
