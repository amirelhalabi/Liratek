# Quickstart: validate insurance expiry reminders (LIRA-360)

Ask the owner before running any test. Run only the affected paths (never full suites).

## Core (both transports share it)

```bash
cd packages/core
npx jest src/utils/__tests__/insuranceRenewal.test.ts \
         src/repositories/__tests__/CustomServiceRepository.lira360InsuranceRenewals.test.ts
```

Expected — table-driven, today fixed at `2026-10-29`:

| Sale day | Expiry | days_left | Listed |
| --- | --- | --- | --- |
| 2025-11-06 | 2026-11-06 | 8 | no |
| 2025-11-05 | 2026-11-05 | 7 | yes |
| 2025-10-29 | 2026-10-29 | 0 | yes ("today") |
| 2025-10-28 | 2026-10-28 | −1 | yes |
| 2025-06-01 | 2026-06-01 | −150 | yes |
| 2024-02-29 | 2025-02-28 | −608 | yes |

Plus: refunded / voided / pending / OUT / dismissed → not listed; renewal by client_id, by phone (`+961 70 123 456` vs `70123456`), different type → still listed, untyped old row → renewed by any type, refunded renewal → old row listed again; UTC `2025-11-04 22:30:00` with +180 min offset → sale day 2025-11-05.

Schema: insurance without `insurance_type` accepted (stored NULL); non-insurance with `insurance_type` refused.

## Frontend

```bash
cd frontend
npx jest src/features/dashboard/components/__tests__/InsuranceRenewalsCard.test.tsx \
         src/shared/components/layouts/__tests__/TopBar.insuranceRenewals.test.tsx
```

Card: rows, empty message, dismiss confirm/cancel, hidden when module off. Bell: one line per day, counts wording, nothing when empty. `useApi` mock returns a stable reference (rule 25).

## Web e2e (no Electron on this Mac)

```bash
node scripts/run-e2e.mjs web -g "insurance renewals"
```

Flow: seed a Compulsory insurance sold 360 days ago through the API (`custom-services:add` with a backdated time; check the form's backdate range before relying on the UI) to a client → Dashboard card lists them "in 5 days" → bell line present once, still once after a reload → sell a new Compulsory to the same phone → row gone → "Won't renew" on a second customer → gone. Confirm the reported test count is non-zero.

## Gates

`yarn typecheck`, `yarn lint`, core rebuild + `cp -r packages/core/dist/. node_modules/@liratek/core/dist/`, `node scripts/build-release-notes.cjs --check`.
