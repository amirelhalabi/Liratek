/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule, 2026-09-24
 * batch: build first, verify once at the end).
 *
 * LIRA-201b (owner note #11-B) — sessionGroupHeaders picks the ONE row per
 * session that carries the pooled in/out + payment detail, from whatever
 * rows are currently visible. Pure row-in/Map-out, so no rendering needed.
 *
 * Fix round (M2/m2): a row is only a header CANDIDATE when it actually
 * carries pooled legs (`session_payments`/`session_account_payments`), and a
 * VOIDED candidate is skipped when a non-voided one exists. The tie-break
 * tests below default every row to carrying a pooled leg (`pooled: true`) so
 * they keep testing pure id-based tie-breaking, unaffected by the new
 * eligibility filter; the eligibility/voided-skip behavior gets its own
 * tests at the bottom.
 */
import {
  computeSessionGroupHeaders,
  isSessionGroupHeader,
} from "../sessionGroupHeaders";
import type { TransactionRow } from "../hooks/useTransactionRows";

const SOME_LEG: NonNullable<TransactionRow["session_payments"]> = [
  {
    direction: "in",
    amount: 50,
    signed_amount: 50,
    currency_code: "USD",
    method: "CASH",
  },
];

function row(
  id: number,
  session_id: number | null,
  opts: { pooled?: boolean; status?: string } = {},
): TransactionRow {
  const { pooled = true, status = "ACTIVE" } = opts;
  const base = {
    id,
    type: "SALE",
    status,
    source_table: "sales",
    source_id: id,
    user_id: 1,
    amount_usd: 0,
    amount_lbp: 0,
    exchange_rate: null,
    client_id: null,
    reverses_id: null,
    summary: null,
    metadata_json: null,
    device_id: null,
    created_at: "2026-09-24 10:00:00",
    username: "cashier",
    client_name: null,
    session_id,
  };
  // Two full branches, not a spread-into-ternary: under
  // exactOptionalPropertyTypes, spreading `{ session_payments: X } | {}`
  // into one literal infers the key as `X | undefined`, which fails against
  // `TransactionRow`'s `session_payments?: X` (no explicit `| undefined`).
  // Omitting the key entirely in the `pooled: false` branch is what the
  // target type actually wants.
  return pooled ? { ...base, session_payments: SOME_LEG } : base;
}

describe("computeSessionGroupHeaders", () => {
  it("picks the LOWEST id among a session's members as the header", () => {
    const rows = [row(5, 7), row(2, 7), row(9, 7)];
    const headers = computeSessionGroupHeaders(rows);
    expect(headers.get(7)).toBe(2);
  });

  it("keeps different sessions independent", () => {
    const rows = [row(1, 7), row(2, 7), row(10, 3), row(11, 3)];
    const headers = computeSessionGroupHeaders(rows);
    expect(headers.get(7)).toBe(1);
    expect(headers.get(3)).toBe(10);
  });

  it("ignores non-session rows entirely", () => {
    const rows = [row(1, null), row(2, null)];
    expect(computeSessionGroupHeaders(rows).size).toBe(0);
  });

  it("a single surviving member of a session is its own header (the LIMIT-window / type-filter case)", () => {
    // Reproduces: 3 real members exist, but only one made it into the
    // currently-visible set (fetch window cut it off, or a type filter
    // hid the other two).
    const rows = [row(9, 7)];
    expect(computeSessionGroupHeaders(rows).get(7)).toBe(9);
  });

  it("re-picks a new header when the previous one is filtered out — survives sorting/filtering by construction (id-based, not position-based)", () => {
    const full = [row(2, 7), row(5, 7), row(9, 7)];
    expect(computeSessionGroupHeaders(full).get(7)).toBe(2);

    // Row 2 (yesterday's header) is no longer in the visible set (e.g. a
    // type filter narrowed to a type only rows 5/9 have).
    const narrowed = [row(5, 7), row(9, 7)];
    expect(computeSessionGroupHeaders(narrowed).get(7)).toBe(5);
  });

  // --- M2 (fix round): eligibility requires pooled legs ---------------

  it("a session with NO member carrying pooled legs gets no header at all", () => {
    const rows = [row(1, 7, { pooled: false }), row(2, 7, { pooled: false })];
    expect(computeSessionGroupHeaders(rows).size).toBe(0);
  });

  it("skips a non-pooled member when picking the header, even if its id is lower", () => {
    // Row 1 has no pooled legs of its own to report (e.g. a linked exchange
    // with nothing pooled) — row 5 is the only real candidate.
    const rows = [row(1, 7, { pooled: false }), row(5, 7, { pooled: true })];
    expect(computeSessionGroupHeaders(rows).get(7)).toBe(5);
  });

  it("a mix of pooled and non-pooled sessions: only the pooled one gets a header", () => {
    const rows = [
      row(1, 7, { pooled: false }),
      row(2, 7, { pooled: false }),
      row(10, 3, { pooled: true }),
      row(11, 3, { pooled: true }),
    ];
    const headers = computeSessionGroupHeaders(rows);
    expect(headers.has(7)).toBe(false);
    expect(headers.get(3)).toBe(10);
  });

  // --- m2 (fix round): a VOIDED candidate is skipped when possible -----

  it("skips a VOIDED candidate in favor of a non-voided one, even with a lower id", () => {
    const rows = [
      row(2, 7, { pooled: true, status: "VOIDED" }),
      row(5, 7, { pooled: true, status: "ACTIVE" }),
    ];
    expect(computeSessionGroupHeaders(rows).get(7)).toBe(5);
  });

  it("falls back to the lowest-id VOIDED candidate when every candidate is voided", () => {
    const rows = [
      row(5, 7, { pooled: true, status: "VOIDED" }),
      row(2, 7, { pooled: true, status: "VOIDED" }),
    ];
    expect(computeSessionGroupHeaders(rows).get(7)).toBe(2);
  });
});

describe("isSessionGroupHeader", () => {
  it("true only for the row whose id matches its session's designated header", () => {
    const headers = computeSessionGroupHeaders([row(2, 7), row(5, 7)]);
    expect(isSessionGroupHeader(row(2, 7), headers)).toBe(true);
    expect(isSessionGroupHeader(row(5, 7), headers)).toBe(false);
  });

  it("false for a non-session row even if its id happens to match a session's header id", () => {
    const headers = computeSessionGroupHeaders([row(2, 7)]);
    expect(isSessionGroupHeader(row(2, null), headers)).toBe(false);
  });
});
