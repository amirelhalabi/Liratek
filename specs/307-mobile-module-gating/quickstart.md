# Quickstart: validate the phone's module gates (LIRA-307)

## Prerequisites

- API running and reachable from the simulator; Metro running for `mobile/`.
- A shop whose owner can sign in on both the web app and the phone (iPhone 17 simulator).
- Web: Settings → Modules, to flip `iPick/Katsh` (`ipec_katch`), `Accounts` (`debts`) and `Binance`.

## Automated checks

```bash
cd mobile
npx jest src/utils/__tests__/moduleGates.test.ts   # record test count; must be > 0
npx tsc --noEmit -p .
```

Rule 17: the gate tests are run once against missing rules and seen failing before `moduleGates.ts` is written.

## Manual scenarios (simulator, then Android)

| #   | Setup                                       | Action                                                          | Expected                                                                                                    |
| --- | ------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | `ipec_katch` on, `debts` on                 | open app online                                                 | tabs: Home, Sell, Debts, Activity, Settings                                                                 |
| 2   | `ipec_katch` off, `debts` on                | reopen app                                                      | no Sell tab                                                                                                 |
| 3   | `ipec_katch` on, `debts` off                | reopen app                                                      | no Debts tab                                                                                                |
| 4   | both off                                    | reopen app                                                      | tabs: Home, Activity, Settings                                                                              |
| 5   | Binance off                                 | open Home                                                       | no Binance line in Drawer balances or Since last count; web Dashboard shows no Binance card either (SC-003) |
| 6   | any switches                                | kill app, airplane mode on, cold start                          | tabs: Home, Activity, Settings; no gated drawer lines (SC-002)                                              |
| 7   | after 6                                     | airplane mode off, bring app to foreground                      | switched-on tabs appear, no restart                                                                         |
| 8   | app on Sell → Katsh with 1 item in the cart | flip `ipec_katch` off on web, background + foreground the phone | Sell tab gone, phone on Home; after switching it back on, the Katsh cart is empty                           |
| 9   | verified online                             | airplane mode on, switch tabs                                   | gated tabs stay as verified in this run                                                                     |
| 10  | signed in                                   | sign out, sign in to another shop                               | gates follow the new shop's switches                                                                        |

SC-001 is met when scenarios 1–4 all match the web home grid for the same switches.
