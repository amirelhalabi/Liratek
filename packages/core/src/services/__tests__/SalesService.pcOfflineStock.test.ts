/**
 * LIRA-306 T137 (FR-013, O-new-2) — on a PC in OFFLINE mode a sale of an item
 * the copy shows as out of stock is allowed (the count may be minutes old)
 * and the repository is asked for the stock advisory warning. Standalone
 * desktops and the web keep the shop's own `allow_out_of_stock_sales` rule.
 */
import { SalesService } from "../SalesService.js";
import type { SalesRepository } from "../../repositories/SalesRepository.js";
import { setPcOfflineMode } from "../../db/replayGuard.js";

jest.mock("../SettingsService.js", () => ({
  getSettingsService: () => ({ getSettingValue: () => ({ value: "0" }) }),
}));

function serviceWith(processSale: jest.Mock): SalesService {
  const repo = { processSale } as unknown as SalesRepository;
  return new SalesService(repo);
}

afterEach(() => setPcOfflineMode(false));

describe("SalesService — PC offline stock advisory", () => {
  const sale = { items: [{ product_id: 1, quantity: 1, price: 10 }], final_amount: 10 } as never;

  it("offline PC: allowOutOfStock + stockAdvisory, whatever the shop setting", () => {
    const processSale = jest.fn(() => ({ success: true, id: 5 }));
    setPcOfflineMode(true);
    serviceWith(processSale).processSale(sale, 1);
    expect(processSale).toHaveBeenCalledWith(sale, 1, { allowOutOfStock: true, stockAdvisory: true });
  });

  it("not offline: the shop setting decides, no advisory", () => {
    const processSale = jest.fn(() => ({ success: true, id: 5 }));
    serviceWith(processSale).processSale(sale, 1);
    expect(processSale).toHaveBeenCalledWith(sale, 1, { allowOutOfStock: false, stockAdvisory: false });
  });
});
