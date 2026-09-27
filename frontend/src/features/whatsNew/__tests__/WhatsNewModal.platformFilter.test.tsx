/**
 * WhatsNewModal platform filtering — written FIRST (rule 17): the modal
 * does not yet filter by platform, so this fails red before WhatsNewModal.tsx
 * is wired up to isElectron() + filterReleaseNotesForPlatform.
 *
 * Detects the platform via the canonical isElectron() helper
 * (frontend/src/api/backendApi.ts) — never raw `window.api` (CLAUDE.md rule 19).
 */
/** @jest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReleaseNoteEntry } from "../types";

let mockIsElectron = false;

jest.mock("@/api/backendApi", () => ({
  isElectron: () => mockIsElectron,
}));

import { WhatsNewModal } from "../WhatsNewModal";

const entries: ReleaseNoteEntry[] = [
  {
    version: "3.0.0",
    body: [
      "## 👥 Staff, users & login",
      "- Staff can now open the Transactions page.",
      "",
      "## 🖥 Desktop app",
      "- The updater checks for new versions on launch.",
      "",
      "## 🌐 Web app",
      "- Settings → Users now really works.",
    ].join("\n"),
  },
  {
    // Its ONLY section is the one hidden on web — should vanish entirely
    // from "Earlier updates" on web, and appear normally on desktop.
    version: "2.0.0",
    body: ["## 🖥 Desktop app", "- An old desktop-only note."].join("\n"),
  },
  {
    // Platform-neutral — must survive filtering on both platforms, and is
    // what keeps the "Earlier updates" toggle present on web (v2.0.0 alone
    // would otherwise make `earlier` empty and hide the toggle entirely).
    version: "1.0.0",
    body: ["## 🧰 Maintenance", "- Always-visible earlier note."].join("\n"),
  },
];

describe("WhatsNewModal platform filtering", () => {
  beforeEach(() => {
    mockIsElectron = false;
  });

  it("on web: hides the Desktop section, keeps the Web section", () => {
    mockIsElectron = false;
    render(<WhatsNewModal isOpen entries={entries} onClose={jest.fn()} />);

    expect(
      screen.getByText("Settings → Users now really works."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("The updater checks for new versions on launch."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Desktop app/i }),
    ).not.toBeInTheDocument();
  });

  it("on desktop: hides the Web section, keeps the Desktop section", () => {
    mockIsElectron = true;
    render(<WhatsNewModal isOpen entries={entries} onClose={jest.fn()} />);

    expect(
      screen.getByText("The updater checks for new versions on launch."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Settings → Users now really works."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Web app/i }),
    ).not.toBeInTheDocument();
  });

  it("on web: drops the v2.0.0 'Earlier updates' entry entirely (its only section is Desktop-only), keeping v1.0.0", () => {
    mockIsElectron = false;
    render(<WhatsNewModal isOpen entries={entries} onClose={jest.fn()} />);

    fireEvent.click(screen.getByTestId("whats-new-earlier-toggle"));

    expect(screen.queryByText("v2.0.0")).not.toBeInTheDocument();
    expect(
      screen.queryByText("An old desktop-only note."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(
      screen.getByText("Always-visible earlier note."),
    ).toBeInTheDocument();
  });

  it("on desktop: keeps the v2.0.0 'Earlier updates' entry (its Desktop-only section applies)", () => {
    mockIsElectron = true;
    render(<WhatsNewModal isOpen entries={entries} onClose={jest.fn()} />);

    fireEvent.click(screen.getByTestId("whats-new-earlier-toggle"));

    expect(screen.getByText("v2.0.0")).toBeInTheDocument();
    expect(
      screen.getByText("An old desktop-only note."),
    ).toBeInTheDocument();
  });
});
