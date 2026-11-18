# Data model: Profits tenant audit script

All shapes are read from the web API (see research.md R3); nothing is persisted.

## AuditInput (what the checks receive)
- `byModule`: array of `{ module, label, profit_usd, profit_lbp, count, … }`
- `details`: object keyed by module → `{ ok: true, data: { counted: Row[], not_counted: Row[], counted_total_profit_usd, counted_total_profit_lbp } }` or `{ ok: false, error }`
- `summary`: `{ totals: { gross_profit_usd, gross_profit_lbp, net_profit_usd, net_profit_lbp }, … }`
- `byDate`: `[{ date, profit_usd, profit_lbp }]`
- `byUser`: `[{ user_id, username, profit_usd, profit_lbp }]`
- `byClient`: `[{ client_id, client_name, profit_usd, profit_lbp }]` (top-N)
- `byPaymentMethod`: `[{ method, total_usd, total_lbp }]`
- `timings`: `[{ endpoint, ms }]`
- `options`: `{ strictZeroRows: boolean }`

## Row (drill-down)
`{ id, date, counterpart, detail, amount_usd, amount_lbp, cost_usd, cost_lbp, profit_usd, profit_lbp, counted_pct, counted_profit_usd, counted_profit_lbp, reason, fee_note, fee_note_kind }`

## CheckResult (what each check returns)
- `id` (1–10), `key` (e.g. `module-sums`), `title`
- `status`: `PASS` | `FAIL` | `INFO`
- `findings`: array of `{ module?, message, row? }` — every violation (the report shows the first 5 per check)
- `info`: optional free-text lines (counts, timings)
