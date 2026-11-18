# CLI contract: `scripts/profits-audit.mjs`

```
node scripts/profits-audit.mjs --host <host> --user <username> --from YYYY-MM-DD --to YYYY-MM-DD
                               [--json] [--module <KEY>] [--strict-zero-rows]
yarn profits:audit --host … (same flags)
```

| Input | Source | Rule |
| --- | --- | --- |
| user password | env `LIRATEK_PASSWORD` | required; never argv, never printed |
| profits password | env `LIRATEK_PROFITS_PASSWORD` | required; never argv, never printed |
| `--host` | argv | bare host (`cornertech.liratek.shop`) or full `https://…` URL |
| `--module` | argv | restricts drill-downs AND checks 1/3–9 to that module; check 2 still uses all views |

**Output**: text report — header, one line per check `PASS|FAIL|INFO  #n title — summary`, up to 5 example rows
(id, date, counterpart, detail, figures), then a final verdict line. `--json` prints `{ host, from, to, checks, timings }`
and nothing else on stdout.

**Exit codes**: `0` no FAIL · `1` at least one FAIL · `2` usage / env / login / unlock error (message names which step, never the secret).

**Replay** (spec D4): `--save-input <file>` writes the fetched views (never a password or token) — also on a failed run; `--input <file>` re-runs the checks on it with no network and no env secrets.
