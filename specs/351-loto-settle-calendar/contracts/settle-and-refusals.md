# Contracts: Loto on Settle Account (LIRA-351)

No new channels or routes. Existing contracts change behaviour for Loto only.

## Reused unchanged (now accepted for Loto)

| Desktop (IPC) | Web (REST) | Change |
|---|---|---|
| `suppliers:account-unsettled` | `GET /api/suppliers/:id/account-unsettled` | returns Loto's DAY rows (tickets, prizes) and ACCOUNT rows (credits) |
| `suppliers:account-month` / day detail | existing month / day routes | Loto days appear |
| `suppliers:settle-account` | `POST /api/suppliers/:id/settle-account` | no longer refused for Loto; `commission` must be 0 / absent for Loto (refused otherwise) |

## Now refused for Loto (both transports, HTTP 200 envelope)

| Desktop (IPC) | Web (REST) | Response |
|---|---|---|
| `loto:settle-checkpoint` | its REST twin in `backend/src/api/loto.ts` | `{ success: false, error: "Loto is now settled from Suppliers → Loto → Settle Account." }` |
| `loto:settle-checkpoints` (batch) | REST twin | same |
| `loto:mark-checkpoint-settled` | `backend/src/api/loto.ts` (~596) | same |
| `suppliers:record-cashflow` with the Loto supplier | `POST /api/suppliers/:id/cashflow` | `{ success: false, error: "Pay Loto from Settle Account so the payment is tied to its days." }` |

Paper Add Credit / Debt (`suppliers:add-ledger-entry`, `POST /api/suppliers/:id/ledger`) stays allowed for Loto.

## Shared rules (core, one definition each)

- `settlesByDay({ provider: "LOTO" })` → `true`.
- `billsStayOnTickList({ provider: "LOTO" })` → `false`.
- `calendarTakesCommission({ provider: "LOTO" })` → `false`.
