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
const setInitialPassword = jest.fn();
const submitPostForm = jest.fn();
let electron = false;

jest.mock("@/api/backendApi", () => ({
  googleLinkStatus: (...a: unknown[]) => googleLinkStatus(...a),
  googleLinkStart: (...a: unknown[]) => googleLinkStart(...a),
  googleUnlink: (...a: unknown[]) => googleUnlink(...a),
  setInitialPassword: (...a: unknown[]) => setInitialPassword(...a),
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
import {
  PASSWORD_SYMBOL_MESSAGE,
  SET_PASSWORD_FIRST,
  SET_PASSWORD_FIRST_MESSAGE,
  setInitialPasswordSchema,
} from "@liratek/core";

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
  window.history.replaceState(null, "", "/#/account?google=already_linked");
  googleLinkStatus.mockResolvedValue({
    success: true,
    data: { enabled: true, linked: false, email: null },
  });
  render(<GoogleAccountPanel />);
  expect(
    await screen.findByText(/already connected to another user/i),
  ).toBeInTheDocument();
  expect(window.location.hash).toBe("#/account");
});

it("explains that the Google account is connected to another shop (one Google account = one shop)", async () => {
  window.history.replaceState(null, "", "/#/account?google=in_other_shop");
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
  expect(window.location.hash).toBe("#/account");
});

// ── LIRA-291: Sign-in methods ─────────────────────────────────────────────

const CHROME = "xY7-pq_Rt.9mZ";

function googleOnly(enabled = true) {
  return {
    success: true,
    data: { enabled, linked: true, email: "rami@gmail.com", hasPassword: false },
  };
}

it("LIRA-291: is headed 'Sign-in methods'", async () => {
  googleLinkStatus.mockResolvedValue({
    success: true,
    data: { enabled: true, linked: false, email: null, hasPassword: true },
  });
  render(<GoogleAccountPanel />);
  expect(
    await screen.findByRole("heading", { name: "Sign-in methods" }),
  ).toBeInTheDocument();
});

it("LIRA-291: a Google-only user sees 'You sign in with Google only' and a Set a password form (new-password fields with eye toggles)", async () => {
  googleLinkStatus.mockResolvedValue(googleOnly());
  const { container } = render(<GoogleAccountPanel />);
  expect(await screen.findByText(/you sign in with google only/i)).toBeInTheDocument();
  const fields = container.querySelectorAll('input[autocomplete="new-password"]');
  expect(fields).toHaveLength(2);
  expect(
    screen.getAllByRole("button", { name: /show password/i }),
  ).toHaveLength(2);
  expect(screen.getByRole("button", { name: /^set a password$/i })).toBeInTheDocument();
});

it("LIRA-291: Disconnect with no password shows the refusal and does not call the server", async () => {
  googleLinkStatus.mockResolvedValue(googleOnly());
  const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
  render(<GoogleAccountPanel />);
  fireEvent.click(await screen.findByRole("button", { name: /disconnect/i }));
  expect(await screen.findByText(SET_PASSWORD_FIRST_MESSAGE)).toBeInTheDocument();
  expect(googleUnlink).not.toHaveBeenCalled();
  expect(confirmSpy).not.toHaveBeenCalled();
});

it("LIRA-291: the server's SET_PASSWORD_FIRST refusal is shown as is", async () => {
  googleLinkStatus.mockResolvedValue({
    success: true,
    data: { enabled: true, linked: true, email: "rami@gmail.com", hasPassword: true },
  });
  googleUnlink.mockResolvedValue({
    success: false,
    code: SET_PASSWORD_FIRST,
    error: SET_PASSWORD_FIRST_MESSAGE,
  });
  jest.spyOn(window, "confirm").mockReturnValue(true);
  render(<GoogleAccountPanel />);
  fireEvent.click(await screen.findByRole("button", { name: /disconnect/i }));
  expect(await screen.findByText(SET_PASSWORD_FIRST_MESSAGE)).toBeInTheDocument();
});

it("LIRA-291: Set a password sends the schema's payload, then Disconnect works", async () => {
  googleLinkStatus
    .mockResolvedValueOnce(googleOnly())
    .mockResolvedValueOnce({
      success: true,
      data: { enabled: true, linked: true, email: "rami@gmail.com", hasPassword: true },
    })
    .mockResolvedValue({
      success: true,
      data: { enabled: true, linked: false, email: null, hasPassword: true },
    });
  setInitialPassword.mockResolvedValue({
    success: true,
    data: { hasPassword: true, noticeSent: true },
  });
  googleUnlink.mockResolvedValue({ success: true, data: { unlinked: true } });
  jest.spyOn(window, "confirm").mockReturnValue(true);
  const { container } = render(<GoogleAccountPanel />);
  await screen.findByText(/you sign in with google only/i);
  const [pw, confirmPw] = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[autocomplete="new-password"]'),
  );
  fireEvent.change(pw!, { target: { value: CHROME } });
  fireEvent.change(confirmPw!, { target: { value: CHROME } });
  fireEvent.click(screen.getByRole("button", { name: /^set a password$/i }));
  await waitFor(() => expect(setInitialPassword).toHaveBeenCalledTimes(1));
  const payload = setInitialPassword.mock.calls[0]![0];
  expect(setInitialPasswordSchema.parse(payload)).toEqual(payload);
  expect(await screen.findByText(/password set/i)).toBeInTheDocument();

  fireEvent.click(await screen.findByRole("button", { name: /disconnect/i }));
  await waitFor(() => expect(googleUnlink).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole("button", { name: /connect google/i })).toBeInTheDocument();
});

it("LIRA-291: the form applies the one password rule and the confirm match before calling the server", async () => {
  googleLinkStatus.mockResolvedValue(googleOnly());
  const { container } = render(<GoogleAccountPanel />);
  await screen.findByText(/you sign in with google only/i);
  const [pw, confirmPw] = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[autocomplete="new-password"]'),
  );
  fireEvent.change(pw!, { target: { value: "Abcdefg1" } });
  fireEvent.change(confirmPw!, { target: { value: "Abcdefg1" } });
  fireEvent.click(screen.getByRole("button", { name: /^set a password$/i }));
  expect(await screen.findByText(PASSWORD_SYMBOL_MESSAGE)).toBeInTheDocument();
  fireEvent.change(pw!, { target: { value: CHROME } });
  fireEvent.change(confirmPw!, { target: { value: CHROME + "x" } });
  fireEvent.click(screen.getByRole("button", { name: /^set a password$/i }));
  expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
  expect(setInitialPassword).not.toHaveBeenCalled();
});

it("LIRA-291: with Google sign-in off, a user with no password still gets Set a password (and no Google buttons)", async () => {
  googleLinkStatus.mockResolvedValue(googleOnly(false));
  render(<GoogleAccountPanel />);
  expect(
    await screen.findByRole("button", { name: /^set a password$/i }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /connect google/i })).toBeNull();
});


it("LIRA-291: with Google off, the 'Password set' notice stays visible after the password is set", async () => {
  googleLinkStatus.mockResolvedValueOnce(googleOnly(false)).mockResolvedValue({
    success: true,
    data: { enabled: false, linked: true, email: "rami@gmail.com", hasPassword: true },
  });
  setInitialPassword.mockResolvedValue({
    success: true,
    data: { hasPassword: true, noticeSent: false },
  });
  const { container } = render(<GoogleAccountPanel />);
  await screen.findByRole("button", { name: /^set a password$/i });
  const [pw, confirmPw] = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[autocomplete="new-password"]'),
  );
  fireEvent.change(pw!, { target: { value: CHROME } });
  fireEvent.change(confirmPw!, { target: { value: CHROME } });
  fireEvent.click(screen.getByRole("button", { name: /^set a password$/i }));
  await waitFor(() => expect(googleLinkStatus).toHaveBeenCalledTimes(2));
  expect(await screen.findByText(/password set/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^set a password$/i })).toBeNull();
});
