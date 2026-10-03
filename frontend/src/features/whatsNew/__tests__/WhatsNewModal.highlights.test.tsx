/**
 * WhatsNewModal — Highlights redesign (owner decisions 2026-10-03). A
 * release with a "## ✨ Highlights" entry shows its cards up top and hides
 * the grouped bullet list behind a "See all changes" toggle, collapsed by
 * default. A release with none (e.g. v1.30/1.31/1.32, or any entry in
 * "Earlier updates") renders exactly as before — the backward-compat case.
 */
/** @jest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReleaseNoteEntry } from "../types";

jest.mock("@/api/backendApi", () => ({
  isElectron: () => false,
}));

import { WhatsNewModal } from "../WhatsNewModal";

const withHighlights: ReleaseNoteEntry = {
  version: "1.33.0",
  body: "## 💸 OMT / Whish & suppliers\n- A normal grouped bullet.",
  highlights: [
    {
      title: "Faster checkout",
      summary: "Checkout now takes one tap instead of three.",
      image: { src: "whats-new/1.33.0/checkout.png", alt: "Checkout screen" },
    },
  ],
};

const withoutHighlights: ReleaseNoteEntry = {
  version: "1.32.0",
  body: "## 🧰 Maintenance\n- An older, pre-Highlights release note.",
};

describe("WhatsNewModal — Highlights", () => {
  it("shows highlight cards and collapses the grouped list behind 'See all changes'", () => {
    render(<WhatsNewModal isOpen entries={[withHighlights]} onClose={jest.fn()} />);

    expect(screen.getByText("Faster checkout")).toBeInTheDocument();
    expect(
      screen.getByText("Checkout now takes one tap instead of three."),
    ).toBeInTheDocument();

    // Collapsed by default: the grouped bullet is not yet in the document.
    expect(screen.queryByText("A normal grouped bullet.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("whats-new-see-all-toggle"));

    expect(screen.getByText("A normal grouped bullet.")).toBeInTheDocument();
  });

  it("a version with no Highlights section renders exactly as before — no toggle, list shows directly", () => {
    render(<WhatsNewModal isOpen entries={[withoutHighlights]} onClose={jest.fn()} />);

    expect(
      screen.getByText("An older, pre-Highlights release note."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("whats-new-see-all-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("whats-new-highlights")).not.toBeInTheDocument();
  });
});
