/**
 * G40 (LIRA-258, found 2026-10-06 on cornertech): the Suppliers page OMT
 * "Transactions" history showed a VOIDED transfer as "Unpaid", and — worse —
 * the voided row still consumed manual supplier payments in the FIFO, so a
 * later real row could read "Unpaid" and the "Outstanding" total counted the
 * voided amount. A voided row owes nothing: it must be marked "voided" and
 * never take money from the payment pool.
 */
import { FinancialService } from "../FinancialService";

const mockGetByProvider = jest.fn();
const mockGetManualPaymentPools = jest.fn();

jest.mock("../../repositories/index.js", () => {
  const actual = jest.requireActual("../../repositories/index.js");
  return {
    ...actual,
    getSupplierRepository: () => ({
      getByProvider: mockGetByProvider,
      getManualPaymentPools: mockGetManualPaymentPools,
    }),
  };
});

type Row = {
  id: number;
  service_type: "SEND" | "RECEIVE";
  supplier_owed: number;
  settlement_id: number | null;
  is_refunded: number;
  created_at: string;
};

function serviceWith(rows: Row[]): FinancialService {
  const fakeRepo = {
    getAllByProvider: () => rows,
  } as unknown as ConstructorParameters<typeof FinancialService>[0];
  return new FinancialService(fakeRepo);
}

describe("FinancialService.getAllByProvider — voided rows (G40)", () => {
  beforeEach(() => {
    mockGetByProvider.mockReturnValue({ id: 3 });
    // $100 of manual SEND payments already made to OMT.
    mockGetManualPaymentPools.mockReturnValue({
      send_pool_usd: 100,
      receive_pool_usd: 0,
    });
  });

  it("marks a voided row 'voided' with nothing paid against it", () => {
    const svc = serviceWith([
      {
        id: 1,
        service_type: "SEND",
        supplier_owed: 2,
        settlement_id: null,
        is_refunded: 1,
        created_at: "2026-10-06 18:57:58",
      },
    ]);
    const [row] = svc.getAllByProvider("OMT") as unknown as Array<{
      fifo_status: string;
      fifo_paid_usd: number;
    }>;
    expect(row.fifo_status).toBe("voided");
    expect(row.fifo_paid_usd).toBe(0);
  });

  it("a voided row never consumes the payment pool, so the next real row is paid", () => {
    const svc = serviceWith([
      // Newest first, as the repository returns them.
      {
        id: 2,
        service_type: "SEND",
        supplier_owed: 100,
        settlement_id: null,
        is_refunded: 0,
        created_at: "2026-10-06 19:00:00",
      },
      {
        id: 1,
        service_type: "SEND",
        supplier_owed: 100,
        settlement_id: null,
        is_refunded: 1,
        created_at: "2026-10-06 18:00:00",
      },
    ]);
    const rows = svc.getAllByProvider("OMT") as unknown as Array<{
      id: number;
      fifo_status: string;
      fifo_paid_usd: number;
    }>;
    const real = rows.find((r) => r.id === 2)!;
    expect(real.fifo_status).toBe("paid");
    expect(real.fifo_paid_usd).toBe(100);
  });
});
