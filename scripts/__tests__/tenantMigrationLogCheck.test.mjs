#!/usr/bin/env node
/**
 * Node-native tests (no framework, no new dependency — same convention as
 * `scripts/__tests__/build-release-notes.test.cjs`) for
 * `scripts/lib/tenantMigrationLogCheck.mjs`
 * (`PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.4, ticket items 1/2).
 *
 * Rule 17 — proven failing-first, on the REAL unfixed code, not a
 * hypothetical: before this module existed, `scripts/deploy-api.mjs`'s
 * tenant-migration log check consisted ONLY of the `failed` regex below (no
 * `missing` handling and no REFUSED-marker check at all). Running that exact
 * unedited logic against the "silent outage" log —
 * `{"msg":"Tenant databases migrated","ok":0,"failed":0}` with no `missing`
 * field, produced when `/data/tenants` is empty because the Phase D split
 * was never run — printed `failures.length = 0`, i.e. the OLD verifier would
 * have PASSED this deploy. (Recorded 2026-09-27, run directly against the
 * then-current `scripts/deploy-api.mjs` source before any file in this
 * change was edited.) The first test below is that exact scenario, now
 * asserted to FAIL.
 *
 * Run directly: node scripts/__tests__/tenantMigrationLogCheck.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { checkTenantMigrationLogs } from "../lib/tenantMigrationLogCheck.mjs";

test("pre-fix log shape (failed:0, no missing field) now FAILS — this is the silent-outage bug the ticket opened with", () => {
  const logs = [
    '{"level":30,"time":1234,"msg":"Tenant databases migrated","total":2,"ok":0,"failed":0,"failedIds":[]}',
  ].join("\n");

  const result = checkTenantMigrationLogs(logs);

  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /missing/i);
});

test("a fully healthy per-tenant boot (failed:0, missing:0) passes clean", () => {
  const logs = [
    '{"level":30,"msg":"Tenant databases migrated","total":2,"ok":2,"failed":0,"failedIds":[],"missing":0,"missingIds":[]}',
  ].join("\n");

  const result = checkTenantMigrationLogs(logs);

  assert.deepEqual(result.failures, []);
  assert.ok(result.oks.some((m) => /failed:0/.test(m)));
  assert.ok(result.oks.some((m) => /missing:0/.test(m)));
});

test("a non-zero missing count is a hard failure", () => {
  const logs = [
    '{"level":30,"msg":"Tenant databases migrated","total":2,"ok":1,"failed":0,"failedIds":[],"missing":1,"missingIds":[5]}',
  ].join("\n");

  const result = checkTenantMigrationLogs(logs);

  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /missing:1/);
});

test("a non-zero failed count is still a hard failure (pre-existing behaviour, unchanged)", () => {
  const logs = [
    '{"level":30,"msg":"Tenant databases migrated","total":2,"ok":1,"failed":1,"failedIds":[5],"missing":0,"missingIds":[]}',
  ].join("\n");

  const result = checkTenantMigrationLogs(logs);

  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /failed:1/);
});

test("the safety-lock REFUSED marker is a hard failure on its own, even with no migration line at all", () => {
  const logs = [
    "some unrelated line",
    '{"level":50,"msg":"Per-tenant mode REFUSED: platform database still holds shop data — run the Phase D split first","totalRows":42}',
  ].join("\n");

  const result = checkTenantMigrationLogs(logs);

  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /REFUSED/);
});

test("shared mode (no marker at all in the log window) is informational only, never a failure", () => {
  const logs = "some unrelated line\nanother unrelated line";

  const result = checkTenantMigrationLogs(logs);

  assert.deepEqual(result.failures, []);
  assert.ok(result.infos.some((m) => /marker not found/.test(m)));
});
