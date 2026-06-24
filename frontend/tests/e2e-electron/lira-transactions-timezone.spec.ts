/**
 * E2E: Transactions table shows local time, not UTC (Issue 3)
 *
 * SQLite stores created_at as a marker-less UTC string ("YYYY-MM-DD HH:MM:SS").
 * The table used `new Date(str)` which JS parses as LOCAL time, so fresh rows
 * displayed hours behind (≈3h in Beirut, UTC+3). The fix uses parseDbDate to
 * pin marker-less timestamps to UTC before formatting.
 *
 * This test creates a transaction, then asserts the rendered date cell equals
 * the UTC-pinned interpretation of its stored created_at. The expected string is
 * computed INSIDE the renderer so it shares the app's ICU/timezone — a
 * regression to raw `new Date(str)` produces a different string on any non-UTC
 * machine (the only machines where this bug can manifest) and fails the test.
 *
 * Shared Electron instance / accumulating DB; the row is matched by a unique
 * marker, never by position (CLAUDE.md rule 15).
 */

import { test, expect, navigateTo, seedCustomService } from "./fixtures";

test.describe.configure({ retries: 0 });

test.describe("Transactions table — timezone", () => {
  test("fresh transaction renders its UTC-stored time as local wall-clock time", async ({
    appPage,
  }) => {
    // System wall-clock at creation time. Everything below is checked against
    // THIS, independently of the app's own parseDbDate, so the test proves the
    // shown time equals the real clock — not just "the code parses its own
    // string consistently".
    const ts = Date.now();
    const marker = `TZ probe ${ts}`;

    await seedCustomService(appPage, { description: marker, amount_usd: 12.34 });

    // The raw value the DB stored for this row (a marker-less UTC string).
    const createdAt = await appPage.evaluate(async (mk: string) => {
      const recent = (await (window as any).api.transactions.getRecent(
        25,
      )) as Array<{ type: string; summary: string | null; created_at: string }>;
      const row = recent.find(
        (r) => r.type === "CUSTOM_SERVICE" && (r.summary ?? "").includes(mk),
      );
      return row?.created_at ?? null;
    }, marker);
    expect(createdAt).not.toBeNull();

    // Compute, in the renderer's own ICU + timezone (so it matches what the
    // table renders): (a) the stored time interpreted as UTC, in epoch ms, and
    // (b) the local-clock strings for ts and the adjacent minutes — the set the
    // cell is allowed to show (covers the 1–2s gap + minute rollover between
    // capturing ts and the row's actual created_at).
    const fmt = {
      day: "2-digit" as const,
      month: "short" as const,
      hour: "2-digit" as const,
      minute: "2-digit" as const,
    };
    const { storedMs, acceptable } = await appPage.evaluate(
      ({ iso, ts, fmt }: { iso: string; ts: number; fmt: Intl.DateTimeFormatOptions }) => {
        const parseUtc = (s: string) =>
          /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)
            ? new Date(s)
            : new Date(`${s.replace(" ", "T")}Z`);
        const local = (ms: number) => new Date(ms).toLocaleString("en-GB", fmt);
        return {
          storedMs: parseUtc(iso).getTime(),
          // local renderings of the system clock at ts ± a minute
          acceptable: [ts - 60_000, ts, ts + 60_000].map(local),
        };
      },
      { iso: createdAt as string, ts, fmt },
    );

    // (1) STORAGE: the UTC value persisted to the DB corresponds to the actual
    // system clock at creation — i.e. the transaction is saved at "now" (in UTC).
    expect(Math.abs(storedMs - ts)).toBeLessThan(2 * 60 * 1000);

    await navigateTo(appPage, "/audit");

    // Isolate our row via the server-side summary search, then match by identity.
    const search = appPage.getByPlaceholder(/Search summary/i);
    await expect(search).toBeVisible({ timeout: 8_000 });
    await search.fill(marker);
    await search.press("Enter");

    const row = appPage.locator("tbody tr").filter({ hasText: marker });
    await expect(row).toHaveCount(1, { timeout: 8_000 });

    // (2) DISPLAY: the first column shows that stored UTC time converted to the
    // LOCAL wall clock — equal to the system clock at ts, NOT 3h behind. On a
    // UTC+offset machine (e.g. Beirut) a regression to raw `new Date(str)` would
    // render ts-offset and fail this; on a UTC machine the bug cannot occur.
    const dateCell = row.first().locator("td").first();
    await expect(dateCell).toBeVisible({ timeout: 8_000 });
    const cellText = ((await dateCell.textContent()) ?? "").trim();
    expect(acceptable).toContain(cellText);
  });
});
