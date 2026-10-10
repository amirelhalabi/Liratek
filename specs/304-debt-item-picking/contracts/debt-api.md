# Contracts: Debt API changes (LIRA-304)

Both transports call the same `@liratek/core` service; envelopes are IPC-identical, REST returns HTTP 200 on failure (rules 6, 19).

## 1. Add repayment — extended (write)

| Layer | Path |
|---|---|
| Schema | `packages/core/src/validators/debt.ts` → `addRepaymentSchema` |
| Service | `DebtService.addRepayment` (camel → snake mapping) |
| IPC | `debt:add-repayment` (`electron-app/handlers/debtHandlers.ts`, local `RepaymentData`), preload `api.debt.addRepayment`, `electron.d.ts` |
| REST | `POST /api/debts/repayments` (`backend/src/api/debts.ts`) |
| Adapter | `backendApi.addRepayment(payload: AddRepaymentPayload)` (type derived, rule 21) |

**New optional field** (added in ALL FOUR places in one change — rule 23: schema, preload type, handler `RepaymentData`, service mapping):
```ts
targets?: Array<{ kind: "sale" | "charge" | "member"; id: number }>   // max 200, unique by kind+id
```
- Absent or empty → today's order (FR-009).
- Server re-reads every target and refuses the whole repayment (`{ success: false, error }`, nothing written) if any target is not the client's, not open, or not pickable (FR-011).
- Amounts per item and per drawer are computed server-side only (FR-012); the client sends none.

**Response** unchanged (`{ success, data: { id } }`).

## 2. Open debt items — new (read)

| Layer | Path |
|---|---|
| Core | `DebtRepository.findOpenDebtItems(clientId)` → `DebtService.getOpenDebtItems` |
| IPC | `debt:get-open-items` (roles: same as `debt:getClientHistory`) |
| REST | `GET /api/debts/clients/:clientId/open-items` (`authenticateJWT` → same roles) |
| Adapter | `backendApi.getOpenDebtItems(clientId)` → raw array (reads return the raw shape) |

Returns `OpenDebtItem[]` (see data-model.md), ordered `created_at, id`. Includes refunded/closed basket members (flagged) so the Accounts page can show them under the basket line (FR-013).

## 3. Repayment preview — client-side, shared function

No endpoint. `allocateRepayment(...)` from `@liratek/core` (`utils/debtRepaymentAllocation.ts`, exported from BOTH `index.ts` and `browser.ts`; Node-free, rule 29). The modal feeds it `getOpenDebtItems` + current lines + rate + base system + routed-so-far (returned on each primary-system transfer item, see below) and renders `drawerPreview`. The server calls the same function with its own reads.

Each primary-system transfer item in `getOpenDebtItems` also carries `routed_value` (in the transfer's own currency) so the preview can apply the per-transfer cap (research D3).

## 4. Payment detail display — UI contract

Transactions page, every transaction:
```
<In|Out> — <Method label>: <amount per currency joined with " + ">[  {<amount> <Drawer label> · <amount> <Drawer label>}]
```
- One line per (method, direction).
- Breakdown only when the line's money touched more than one drawer; internal routing pairs are folded into the paying line.
- Drawer labels: `OMT_System` → "OMT Cash Drawer", `Whish_System` → "Whish Cash Drawer", others as today.
- Σ breakdown = line amount, per currency (FR-021).

## 5. Checkpoint — UI contract

`DrawerCard` optional prop `usdTotal?: { expected: number; counted: number }`, rendered as "Total ≈ $X" (info only) when the drawer holds more than one non-zero currency. Never affects "Balanced".
