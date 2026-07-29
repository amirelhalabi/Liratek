/**
 * The only two spendable-float drawers `DrawerTopUpRepository.fundSystemDrawer`
 * may credit (owner-confirmed 2026-07-29 float model) — never General, never
 * an arbitrary drawer name.
 *
 * Single definition (CLAUDE.md rule 14) consumed by:
 *  - `DrawerTopUpRepository` (the repository-layer allow-list check — enforced
 *    again there even though the IPC/Zod layer also validates, so a caller
 *    bypassing validation still cannot invent money in an arbitrary drawer),
 *  - `DrawerTopUpService` (mirrors the repository's error for a fast-fail
 *    before the transaction even opens),
 *  - `validators/systemFloatTopup.ts` (`systemFloatDrawerNameSchema` derives
 *    its `z.enum([...])` from this list instead of re-declaring it, so the
 *    Zod schema and the repository/service allow-list cannot drift apart).
 */
export const SYSTEM_FLOAT_DRAWER_NAMES = ["OMT_System", "Whish_System"] as const;

export type SystemFloatDrawerName = (typeof SYSTEM_FLOAT_DRAWER_NAMES)[number];
