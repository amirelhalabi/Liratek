/**
 * HighlightCards — written FIRST (rule 17): the component does not exist
 * yet when this is run against unfixed code, so it fails red before
 * HighlightCards.tsx is written.
 *
 * The load-bearing assertion is the last one: an image src that isn't a
 * relative `whats-new/...` path (e.g. an external URL) must never reach a
 * real <img> element — the whitelist in isAllowedHighlightImageSrc is the
 * guard, and rendering falls back to a card with no image rather than
 * trusting the data.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { HighlightCards } from "../HighlightCards";
import { isAllowedHighlightImageSrc } from "../isAllowedHighlightImageSrc";
import type { ReleaseNoteHighlight } from "../types";

describe("isAllowedHighlightImageSrc", () => {
  it("allows a relative whats-new/ path", () => {
    expect(isAllowedHighlightImageSrc("whats-new/1.33.0/checkout.png")).toBe(true);
  });

  it("rejects an external URL", () => {
    expect(isAllowedHighlightImageSrc("https://evil.example.com/x.png")).toBe(false);
  });

  it("rejects a protocol-relative URL", () => {
    expect(isAllowedHighlightImageSrc("//evil.example.com/x.png")).toBe(false);
  });

  it("rejects a path containing ..", () => {
    expect(isAllowedHighlightImageSrc("whats-new/../secrets.png")).toBe(false);
  });

  it("rejects a path not under whats-new/", () => {
    expect(isAllowedHighlightImageSrc("other/1.33.0/checkout.png")).toBe(false);
  });
});

describe("HighlightCards", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<HighlightCards highlights={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a card with title, summary, and an <img> with the right src/alt", () => {
    const highlights: ReleaseNoteHighlight[] = [
      {
        title: "Faster checkout",
        summary: "Checkout now takes one tap instead of three.",
        image: { src: "whats-new/1.33.0/checkout.png", alt: "The new checkout screen" },
      },
    ];
    render(<HighlightCards highlights={highlights} />);

    expect(screen.getByText("Faster checkout")).toBeInTheDocument();
    expect(
      screen.getByText("Checkout now takes one tap instead of three."),
    ).toBeInTheDocument();

    const img = screen.getByAltText("The new checkout screen") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toBe("/whats-new/1.33.0/checkout.png");
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("clicking the image opens a full-size lightbox", () => {
    const highlights: ReleaseNoteHighlight[] = [
      {
        title: "Dark mode",
        summary: "The whole app now supports dark mode.",
        image: { src: "whats-new/1.33.0/dark.png", alt: "Dark mode screenshot" },
      },
    ];
    render(<HighlightCards highlights={highlights} />);

    expect(screen.queryByTestId("whats-new-highlight-lightbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /view larger image/i }));

    expect(screen.getByTestId("whats-new-highlight-lightbox")).toBeInTheDocument();
  });

  it("renders a card with no image when the highlight has none", () => {
    const highlights: ReleaseNoteHighlight[] = [
      { title: "Text-only highlight", summary: "No screenshot for this one." },
    ];
    render(<HighlightCards highlights={highlights} />);

    expect(screen.getByText("Text-only highlight")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("refuses an external image URL — no <img> is rendered for it", () => {
    const highlights: ReleaseNoteHighlight[] = [
      {
        title: "Malicious entry",
        summary: "This should not load an external image.",
        image: { src: "https://evil.example.com/x.png", alt: "evil" },
      },
    ];
    render(<HighlightCards highlights={highlights} />);

    expect(screen.getByText("Malicious entry")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByAltText("evil")).not.toBeInTheDocument();
  });
});
