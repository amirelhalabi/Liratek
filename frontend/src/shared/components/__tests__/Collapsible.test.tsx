/** @jest-environment jsdom */
/**
 * Collapsible animates its content's height open and closed. Content that is
 * open when the page loads does not animate; the clipping the animation needs
 * applies only while it runs (so rings/shadows aren't cut afterwards).
 * Written before the component (rule 17).
 */
import { render, screen, act } from "@testing-library/react";
import { Collapsible, EXPAND_MS } from "../Collapsible";
import { PRESENCE_EXIT_MS } from "@/shared/hooks/usePresence";

function shell() {
  return screen.getByText("items").parentElement?.parentElement as HTMLElement;
}
function clip() {
  return screen.getByText("items").parentElement as HTMLElement;
}

describe("Collapsible", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("open on first render: shown, no animation, no clipping", () => {
    render(
      <Collapsible open>
        <p>items</p>
      </Collapsible>,
    );
    expect(shell().className).not.toMatch(/animate-/);
    expect(clip().className).not.toMatch(/overflow-hidden/);
  });

  it("closing animates, then removes the content", () => {
    const { rerender } = render(
      <Collapsible open>
        <p>items</p>
      </Collapsible>,
    );
    rerender(
      <Collapsible open={false}>
        <p>items</p>
      </Collapsible>,
    );
    expect(shell()).toHaveClass("animate-collapse-rows");
    expect(clip()).toHaveClass("overflow-hidden");
    act(() => {
      jest.advanceTimersByTime(PRESENCE_EXIT_MS);
    });
    expect(screen.queryByText("items")).toBeNull();
  });

  it("opening animates, then settles with no animation or clipping", () => {
    const { rerender } = render(
      <Collapsible open={false}>
        <p>items</p>
      </Collapsible>,
    );
    expect(screen.queryByText("items")).toBeNull();
    rerender(
      <Collapsible open>
        <p>items</p>
      </Collapsible>,
    );
    expect(shell()).toHaveClass("animate-expand-rows");
    expect(clip()).toHaveClass("overflow-hidden");
    act(() => {
      jest.advanceTimersByTime(EXPAND_MS);
    });
    expect(shell().className).not.toMatch(/animate-/);
    expect(clip().className).not.toMatch(/overflow-hidden/);
  });
});
