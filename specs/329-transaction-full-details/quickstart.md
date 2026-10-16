# Quickstart: verify full transaction details

1. Core: `cd packages/core && npx jest src/**/__tests__/*.details.test.ts`. Each completeness guard fills every UI field for its kind and asserts each audit field is in `metadata_json.details`, the payment snapshot matches the inserted `payments` rows, and the client name/phone columns are filled.
2. Amounts unchanged: each module's existing money tests stay green with no edits to their expectations.
3. Web parity: `cd frontend && npx playwright test --config playwright.web.config.ts lira-web-070` saves an OMT send with every field over the web app and reads the transaction back over REST: the details match the inputs.
4. Manual (test tenant): do an OMT send with service type, reference, both names/phones and a fee; open Audit & Transactions → the row's raw metadata (or `GET /api/transactions/:id`) shows `details` and `payment_snapshot`.
