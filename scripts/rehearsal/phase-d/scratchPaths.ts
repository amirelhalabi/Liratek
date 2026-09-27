/**
 * Shared scratch-path convention for the Phase D rehearsal (both halves) —
 * defined ONCE so Part A (which WRITES the manifest, `split.phaseD.rehearsal.test.ts`)
 * and Part B (which READS it, `runbook.phaseD.rehearsal.test.ts`) can never
 * quietly point at two different directories (rule 14 — no copy-pasted path
 * literal that the two files could drift apart on).
 *
 * Override the base directory with `PHASE_D_REHEARSAL_SCRATCH_DIR`; the
 * default is a fixed folder under the OS temp dir, NOT tied to any one
 * chat/agent session's scratchpad, so the rehearsal is reproducible by
 * anyone, any time — see `README.md` in this folder.
 */
import os from "node:os";
import path from "node:path";

export const REHEARSAL_SCRATCH_DIR =
  process.env.PHASE_D_REHEARSAL_SCRATCH_DIR ??
  path.join(os.tmpdir(), "liratek-phase-d-rehearsal");

/** Where Part A expects to find a pre-made COPY of the real desktop DB
 * (`~/Documents/LiraTek/liratek.db`) — see README.md for how to place it
 * there. This module never creates it and never reads/writes the live file;
 * placing the copy is the operator's job, same as the real runbook's own
 * "a copy, never the live file" contract. */
export const DESKTOP_DB_COPY = path.join(REHEARSAL_SCRATCH_DIR, "liratek-copy.db");

/** Where Part A writes, and Part B reads, the manifest describing where the
 * split output landed (tenant ids, file paths, pre-split counts, …). */
export const MANIFEST_PATH = path.join(
  REHEARSAL_SCRATCH_DIR,
  "manifest",
  "phaseD-manifest.json",
);
