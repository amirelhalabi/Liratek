/** @jest-environment jsdom */
/**
 * SearchBar free-text commit — the A5 "Please enter a service description" bug.
 *
 * Pre-fix, Enter committed free text ONLY when `hasSearched && results.length
 * === 0` — i.e. only after the debounce (300ms) AND the async search had both
 * completed. Typing a description and pressing Enter quickly (any fast typist)
 * silently did NOTHING: the description never committed and the Services page
 * rejected the submit. Reproduced deterministically by lira-093.
 *
 * Post-fix, Enter commits the query whenever free-text is enabled and no live
 * results list is showing — regardless of search state.
 */

import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { SearchBar } from "@liratek/ui";

type Item = { id: number; name: string };

function setup(results: Item[] = []) {
  const onFreeText = jest.fn();
  const onSearch = jest.fn(async () => results);
  render(
    <SearchBar<Item>
      placeholder="Search item..."
      onSearch={onSearch}
      onSelect={jest.fn()}
      onFreeText={onFreeText}
      renderItem={(i) => <span>{i.name}</span>}
      getKey={(i) => i.id}
    />,
  );
  return {
    onFreeText,
    onSearch,
    input: screen.getByPlaceholderText("Search item..."),
  };
}

describe("SearchBar — Enter commits free text (A5)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("commits on Enter IMMEDIATELY after typing (before debounce/search resolve)", () => {
    const { onFreeText, input } = setup();

    fireEvent.change(input, { target: { value: "screen repair" } });
    // Enter fired straight away — debounce has NOT elapsed, no search ran.
    fireEvent.keyDown(input, { key: "Enter" });

    // Pre-fix: onFreeText was never called here (hasSearched was false).
    expect(onFreeText).toHaveBeenCalledWith("screen repair");
  });

  it("still commits after a completed empty search (legacy behavior)", async () => {
    const { onFreeText, input } = setup([]);

    fireEvent.change(input, { target: { value: "no such item" } });
    await act(async () => {
      jest.advanceTimersByTime(500); // debounce elapses, search resolves []
    });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onFreeText).toHaveBeenCalledWith("no such item");
  });

  it("does NOT commit while a live results list is showing", async () => {
    const { onFreeText, input } = setup([{ id: 1, name: "iPhone 13" }]);

    fireEvent.change(input, { target: { value: "iph" } });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    await waitFor(() =>
      expect(screen.getByText("iPhone 13")).toBeInTheDocument(),
    );

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onFreeText).not.toHaveBeenCalled();
  });

  it("ignores Enter on an empty query", () => {
    const { onFreeText, input } = setup();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onFreeText).not.toHaveBeenCalled();
  });
});
