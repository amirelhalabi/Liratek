/** @jest-environment jsdom */
/**
 * Settings -> Connect Google (LIRA-280). Linking is ONLY done here, while
 * signed in (owner decision 2026-10-07: never automatically by email). The
 * panel is hidden on desktop and while Google sign-in is dormant.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const googleLinkStatus = jest.fn();
const googleLinkStart = jest.fn();
const googleUnlink = jest.fn();
const submitPostForm = jest.fn();
let electron = false;

jest.mock("@/api/backendApi", () => ({
  googleLinkStatus: (...a: unknown[]) => googleLinkStatus(...a),
  googleLinkStart: (...a: unknown[]) => googleLinkStart(...a),
  googleUnlink: (...a: unknown[]) => googleUnlink(...a),
  isElectron: () => electron,
}));
jest.mock("@/features/auth/utils/browserNavigation", () => {
  const actual = jest.requireActual("@/features/auth/utils/browserNavigation");
  return {
    ...actual,
    submitPostForm: (url: string, fields: Record<string, string>) =>
      submitPostForm(url, fields),
  };
});

import GoogleAccountPanel from "../GoogleAccountPanel";

beforeEach(() => {
  jest.clearAllMocks();
  electron = false;
  window.history.replaceState(null, "", "/#/settings");
});

it("is hidden on desktop and while Google is dormant", async () => {
  electron = true;
  const first = render(<GoogleAccountPanel />);
  expect(first.container).toBeEmptyDOMElement();
  expect(googleLinkStatus).not.toHaveBeenCalled();
  first.unmount();

  electron = false;
  googleLinkStatus.mockResolvedValue({
    success: true,
    data: { enabled: false, linked: false, email: null },
  });
  const second = render(<GoogleAccountPanel />);
  await waitFor(() => expect(googleLinkStatus).toHaveBeenCalled());
  expect(second.container).toBeEmptyDOMElement();
});

it("Connect POSTs the link ticket to the www start (never in a URL)", async () => {
  googleLinkStatus.mockResolvedValue({
    success: true,
    data: { enabled: true, linked: false, email: null },
  });
  googleLinkStart.mockResolvedValue({
    success: true,
    data: { url: "https://www.liratek.shop/api/auth/google/start", ticket: "t" },
  });
  render(<GoogleAccountPanel />);
  fireEvent.click(await screen.findByRole("button", { name: /connect google/i }));
  await waitFor(() =>
    expect(submitPostForm).toHaveBeenCalledWith(
      "https://www.liratek.shop/api/auth/google/start",
      { intent: "link", ticket: "t" },
    ),
  );
});

it("Disconnect unlinks and shows the account as not connected", async () => {
  googleLinkStatus
    .mockResolvedValueOnce({
      success: true,
      data: { enabled: true, linked: true, email: "owner@gmail.com" },
    })
    .mockResolvedValue({
      success: true,
      data: { enabled: true, linked: false, email: null },
    });
  googleUnlink.mockResolvedValue({ success: true, data: { unlinked: true } });
  jest.spyOn(window, "confirm").mockReturnValue(true);
  render(<GoogleAccountPanel />);
  expect(await screen.findByText(/owner@gmail.com/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
  await waitFor(() => expect(googleUnlink).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole("button", { name: /connect google/i })).toBeInTheDocument();
});

it("reports the result of a link that just came back from Google", async () => {
  window.history.replaceState(null, "", "/#/settings?tab=devices&google=already_linked");
  googleLinkStatus.mockResolvedValue({
    success: true,
    data: { enabled: true, linked: false, email: null },
  });
  render(<GoogleAccountPanel />);
  expect(
    await screen.findByText(/already connected to another user/i),
  ).toBeInTheDocument();
  expect(window.location.hash).toBe("#/settings?tab=devices");
});

it("explains that the Google account is connected to another shop (one Google account = one shop)", async () => {
  window.history.replaceState(null, "", "/#/settings?tab=devices&google=in_other_shop");
  googleLinkStatus.mockResolvedValue({
    success: true,
    data: { enabled: true, linked: false, email: null },
  });
  render(<GoogleAccountPanel />);
  expect(
    await screen.findByText(
      /already connected to another LiraTek shop\. Disconnect it there first, or use a different Google account/i,
    ),
  ).toBeInTheDocument();
  expect(window.location.hash).toBe("#/settings?tab=devices");
});
