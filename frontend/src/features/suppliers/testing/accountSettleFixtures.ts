/**
 * LIRA-322 — shared fixtures for the Settle Account sheet tests: the test
 * shop's real OMT account (six USD transfers of $152, $101, $101, $101, $21
 * and $21, oldest first, $497 owed) plus a 900,000 LBP transfer.
 *
 * Pure data (no jest APIs, no JSX) so it type-checks under the app tsconfig
 * too. It lives outside `__tests__/` because jest treats every file there as
 * a test suite.
 */
import type {
  AccountBalance,
  AccountUnsettledRow,
} from "../hooks/useSuppliers";

export const OMT_ACCOUNT_ID = 1;

export const OMT_ACCOUNT: AccountBalance = {
  account_supplier_id: OMT_ACCOUNT_ID,
  account_name: "OMT",
  total_usd: 497,
  total_lbp: 900000,
  children: [
    {
      supplier_id: 1,
      name: "OMT",
      provider: "OMT",
      drawer_name: "OMT_System",
      total_usd: 497,
      total_lbp: 900000,
      is_parent: true,
    },
    {
      supplier_id: 2,
      name: "OMT App",
      provider: "OMT_APP",
      drawer_name: "OMT_App",
      total_usd: 0,
      total_lbp: 0,
      is_parent: false,
    },
  ],
};

/** One queue row. `remaining_*` default to `amount_*` (nothing paid yet). */
export function queueRow(
  over: Partial<AccountUnsettledRow> &
    Pick<AccountUnsettledRow, "id" | "created_at">,
): AccountUnsettledRow {
  const amountUsd = over.amount_usd ?? 0;
  const amountLbp = over.amount_lbp ?? 0;
  return {
    kind: "FINANCIAL_SERVICE",
    supplier_id: 1,
    source_provider: "OMT",
    source_name: "OMT",
    entry_type: null,
    service_type: "SEND",
    commission_usd: 0,
    commission_lbp: 0,
    omt_service_type: "INTRA",
    commission_model: 0,
    covered_usd: 0,
    covered_lbp: 0,
    remaining_usd: amountUsd,
    remaining_lbp: amountLbp,
    ...over,
    amount_usd: amountUsd,
    amount_lbp: amountLbp,
  };
}

/** The six USD transfers, oldest first ($497 in total). */
export const SIX_USD_ROWS: AccountUnsettledRow[] = [
  152, 101, 101, 101, 21, 21,
].map((amount, i) =>
  queueRow({
    id: 101 + i,
    created_at: `2026-10-0${i + 1} 10:00:00`,
    amount_usd: amount,
  }),
);

/** One 900,000 LBP transfer. */
export const LBP_ROW: AccountUnsettledRow = queueRow({
  id: 201,
  created_at: "2026-10-07 10:00:00",
  amount_lbp: 900000,
});
