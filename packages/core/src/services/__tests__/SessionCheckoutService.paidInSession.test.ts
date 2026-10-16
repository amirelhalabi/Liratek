/**
 * LIRA-329 T037 — every session-basket item learns which session paid for
 * it (`paid_in_session`), not only Mobile Recharge items: the checkout
 * injects it server-side (like `deferPayment`) for EVERY cart channel, and
 * LotoService — which rebuilds its input field by field — carries it on to
 * the repository.
 *
 * The services are mocked: this pins the dispatch and the hand-over only.
 * What each repository does with the field is pinned by its own
 * `*.details.test.ts`. Rule 17: run before the change and seen failing.
 */

const mockProcessSale = jest.fn();
const mockAddService = jest.fn();
const mockSaveJob = jest.fn();
const mockSellTicket = jest.fn();
const mockRecordCashPrize = jest.fn();

jest.mock("../SalesService", () => ({
  getSalesService: () => ({ processSale: mockProcessSale }),
  resetSalesService: jest.fn(),
}));
jest.mock("../CustomServiceService", () => ({
  getCustomServiceService: () => ({ addService: mockAddService }),
  resetCustomServiceService: jest.fn(),
}));
jest.mock("../MaintenanceService", () => ({
  getMaintenanceService: () => ({ saveJob: mockSaveJob }),
  resetMaintenanceService: jest.fn(),
}));
jest.mock("../LotoService", () => {
  const actual = jest.requireActual("../LotoService");
  return {
    ...actual,
    getLotoService: () => ({
      sellTicket: mockSellTicket,
      recordCashPrize: mockRecordCashPrize,
    }),
    resetLotoService: jest.fn(),
  };
});

import {
  processCartItem,
  type CheckoutCartItem,
} from "../SessionCheckoutService";
import { LotoService } from "../LotoService";
import type { LotoTicketRepository } from "../../repositories/LotoTicketRepository";
import type { LotoSettingsRepository } from "../../repositories/LotoSettingsRepository";
import type { LotoMonthlyFeeRepository } from "../../repositories/LotoMonthlyFeeRepository";
import type { LotoCheckpointRepository } from "../../repositories/LotoCheckpointRepository";
import type { LotoCashPrizeRepository } from "../../repositories/LotoCashPrizeRepository";

const SESSION_ID = 42;

function cartItem(ipcChannel: string, module: string): CheckoutCartItem {
  return {
    id: "c1",
    module,
    label: module,
    amount: 10,
    currency: "USD",
    ipcChannel,
    formData: { note: "from the basket" },
  };
}

describe("LIRA-329 — every session-basket item gets paid_in_session", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProcessSale.mockReturnValue({ success: true, id: 1 });
    mockAddService.mockReturnValue({ success: true, id: 2 });
    mockSaveJob.mockReturnValue({ success: true, id: 3 });
    mockSellTicket.mockReturnValue({ id: 4 });
    mockRecordCashPrize.mockReturnValue({ id: 5 });
  });

  it.each([
    ["sales:process", "pos", mockProcessSale],
    ["custom-services:add", "custom_service", mockAddService],
    ["maintenance:save", "maintenance", mockSaveJob],
    ["loto:sell", "loto_ticket", mockSellTicket],
    ["loto:cash-prize:create", "loto_prize", mockRecordCashPrize],
  ])("%s: the service receives the session id", (channel, module, mock) => {
    processCartItem(cartItem(channel, module), undefined, 1, SESSION_ID);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toMatchObject({
      deferPayment: true,
      paid_in_session: SESSION_ID,
    });
  });

  it("outside a session (no session id) nothing is injected", () => {
    processCartItem(
      cartItem("custom-services:add", "custom_service"),
      undefined,
      1,
    );
    expect(mockAddService.mock.calls[0][0]).not.toHaveProperty(
      "paid_in_session",
    );
  });
});

describe("LIRA-329 — LotoService hands paid_in_session to its repositories", () => {
  const createTicket = jest.fn();
  const createCashPrize = jest.fn();
  const service = new LotoService(
    { createTicket } as unknown as LotoTicketRepository,
    {
      getSetting: jest.fn().mockReturnValue(undefined),
    } as unknown as LotoSettingsRepository,
    {} as LotoMonthlyFeeRepository,
    {} as LotoCheckpointRepository,
    { createCashPrize } as unknown as LotoCashPrizeRepository,
  );

  beforeEach(() => {
    createTicket.mockReset().mockReturnValue({ id: 4, ticket_number: "T1" });
    createCashPrize
      .mockReset()
      .mockReturnValue({ id: 5, prize_amount: 50_000, ticket_number: "T1" });
  });

  it("a basket ticket", () => {
    service.sellTicket({
      sale_amount: 500_000,
      commission_rate: 0.05,
      currency: "LBP",
      userId: 1,
      deferPayment: true,
      paid_in_session: SESSION_ID,
    });
    expect(createTicket.mock.calls[0][0]).toMatchObject({
      deferPayment: true,
      paid_in_session: SESSION_ID,
    });
  });

  it("a basket cash prize", () => {
    service.recordCashPrize({
      prize_amount: 50_000,
      prize_date: "2026-10-16",
      userId: 1,
      deferPayment: true,
      paid_in_session: SESSION_ID,
    });
    expect(createCashPrize.mock.calls[0][0]).toMatchObject({
      deferPayment: true,
      paid_in_session: SESSION_ID,
    });
  });
});
