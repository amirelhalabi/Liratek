/** @jest-environment jsdom */
/**
 * LIRA-306 — "Pair this PC" on a never-paired desktop (contracts/
 * ipc-offline.md offline:pair; O-new-8): an admin types the shop, their
 * username and password and a name for the PC; the payload is the core
 * `desktopPairSchema` input (rule 21/24); the server's refusal is shown.
 * The useApi mock returns ONE stable object (rule 25).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { desktopPairSchema } from "@liratek/core";

const pairThisPc = jest.fn();
const api = { pairThisPc };
jest.mock("@liratek/ui", () => ({ useApi: () => api }));

import { PairThisPcCard } from "../PairThisPcCard";

function fill() {
  fireEvent.change(screen.getByLabelText(/shop/i), {
    target: { value: "cornertech" },
  });
  fireEvent.change(screen.getByLabelText(/username/i), {
    target: { value: "owner" },
  });
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: "Owner-pass-2026" },
  });
  fireEvent.change(screen.getByLabelText(/name for this pc/i), {
    target: { value: "Front PC" },
  });
}

beforeEach(() => pairThisPc.mockReset());

it("sends ONE payload that the core pairing schema accepts", async () => {
  pairThisPc.mockResolvedValue({
    success: true,
    data: { deviceNo: 2, shopName: "Corner Tech" },
  });
  render(<PairThisPcCard />);
  fill();
  fireEvent.click(screen.getByRole("button", { name: /pair this pc/i }));
  await waitFor(() => expect(pairThisPc).toHaveBeenCalledTimes(1));
  const payload = pairThisPc.mock.calls[0][0];
  expect(desktopPairSchema.safeParse(payload).success).toBe(true);
  expect(payload).toEqual(
    desktopPairSchema.parse({
      shop: "cornertech",
      username: "owner",
      password: "Owner-pass-2026",
      deviceName: "Front PC",
    }),
  );
  expect(await screen.findByText(/PC 2 of Corner Tech/)).toBeTruthy();
});

it("shows the server's refusal", async () => {
  pairThisPc.mockResolvedValue({
    success: false,
    code: "ADMIN_ONLY",
    error: "Only an admin can pair a PC",
  });
  render(<PairThisPcCard />);
  fill();
  fireEvent.click(screen.getByRole("button", { name: /pair this pc/i }));
  expect(await screen.findByText(/Only an admin can pair a PC/)).toBeTruthy();
});

it("the button waits for every field", () => {
  render(<PairThisPcCard />);
  expect(
    (screen.getByRole("button", { name: /pair this pc/i }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
