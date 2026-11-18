# Data model — LIRA-393

No schema change, no migration, no data rewrite (FR-004).

- **Anonymous session name**: string exactly `Client` + one or more ASCII digits (`^Client\d+$`). Not matched: `Client 7`, `client7`, `Client7b`, `Client`. Carries no identity; only meaningful when the row has `client_id IS NULL`.
