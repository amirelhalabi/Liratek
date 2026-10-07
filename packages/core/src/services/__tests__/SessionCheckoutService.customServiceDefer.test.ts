/**
 * Non-regression guard: client payloads can no longer carry `deferPayment`
 * (validators/customService.ts), so the session-basket checkout must keep
 * injecting it SERVER-side when it replays a custom-service cart line —
 * otherwise each basket line would post its own customer payment on top of
 * the basket's single payment (double-collect), and a cost-only line would
 * be refused for having no selling price.
 */

const mockAddService = jest.fn();
jest.mock("../CustomServiceService", () => ({
  getCustomServiceService: () => ({ addService: mockAddService }),
  resetCustomServiceService: jest.fn(),
}));

import { processCartItem } from "../SessionCheckoutService";

describe("SessionCheckoutService processCartItem — custom service lines defer payment", () => {
  beforeEach(() => {
    mockAddService.mockReset();
    mockAddService.mockReturnValue({ success: true, id: 5 });
  });

  it.each(["custom-services:add", "customService:create"])(
    "%s: replays with deferPayment true even though the stored form data has none",
    (ipcChannel) => {
      const result = processCartItem(
        {
          id: "cart-1",
          module: "custom_service",
          label: "Service: cover",
          amount: 0,
          currency: "USD",
          ipcChannel,
          formData: { description: "cover", cost_usd: 4 },
        },
        undefined,
        1,
      );

      expect(mockAddService).toHaveBeenCalledTimes(1);
      expect(mockAddService.mock.calls[0][0]).toMatchObject({
        description: "cover",
        cost_usd: 4,
        deferPayment: true,
      });
      expect(result).toEqual({
        sourceId: 5,
        sourceTable: "custom_services",
        transactionType: "custom_service",
      });
    },
  );
});
