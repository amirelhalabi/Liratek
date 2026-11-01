# Quickstart: LIRA-366 validation

1. **Core**: run the 366 jest files under `packages/core/src/**/__tests__/*lira366*` with explicit paths. Expect:
   - `details.note` is written for each create path.
   - The debt note ends with `" — rest on Monday"`.
   - An edit swaps the suffix and leaves refund rows untouched.
   - A debt note edited by hand is left alone.
2. **Frontend**: run the 366 jest files with explicit paths. Each form builds `typedNote` exactly as the real screen does, and the payload parses through the core schema (rule 24).
3. **Web e2e** (`frontend/tests/e2e-web/lira-web-*-payment-note.spec.ts`):
   - Sell a $20 recharge to a known client: $15 cash + $5 on account, note "rest on Monday".
   - The details window shows the note.
   - The row has the note mark.
   - The Debts page shows the $5 entry with "rest on Monday".
   - Edit the note. Both places change.
   - Save the What's new screenshot.
4. **Gates**:
   - typecheck for frontend and core (confirm the elapsed time, so you know it really ran)
   - eslint for each workspace
   - the transport-parity check
   - `node scripts/build-release-notes.cjs --check`
