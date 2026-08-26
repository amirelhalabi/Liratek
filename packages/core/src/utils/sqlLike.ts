/**
 * SQL `LIKE` pattern helpers (LIRA-143 item 5).
 *
 * A user-typed search term interpolated straight into `%…%` is not just a
 * substring match: SQLite's `LIKE` reads `%` as "any run of characters" and
 * `_` as "any single character". So a search for `%` matched EVERY row (the
 * operator typed one character and got the unfiltered table back), and a
 * search for `81_9` matched `8139…` as readily as the literal `81_9…` the
 * operator was looking at on a phone's label.
 *
 * The fix is the standard pair, and the two halves MUST be used together —
 * that is why they live in one module rather than being open-coded per query:
 *
 *   1. {@link escapeLike} on the term, before it is wrapped in `%…%`.
 *   2. {@link LIKE_ESCAPE_CLAUSE} appended to the `LIKE ?` in the SQL.
 *
 * Escaping the term without the clause is WORSE than doing nothing (the
 * backslashes then match literally and nothing is found); the clause without
 * the escaping silently keeps the wildcard bug. Rule 14: one definition of
 * the pair, reused.
 *
 * ## Scope note (deliberate)
 *
 * Only `ProductUnitRepository.buildUnitListWhere` (the Phone Units management
 * view) uses this today. `ProductRepository`'s product name/barcode search
 * (`searchProducts`, `LISTABLE_PRODUCTS_WHERE`'s search branch) keeps its
 * long-standing raw-`LIKE` behaviour on purpose: it has shipped that way
 * since the beginning, a barcode/product name realistically never contains
 * `%` or `_`, and quietly changing what an existing search matches is a
 * behaviour change the owner did not ask for. IMEI search is the case that
 * actually motivated this (an operator scanning/typing arbitrary label text
 * into a 15-character field). Extend the pair to other searches
 * deliberately, one at a time — never as a drive-by.
 */

/**
 * The single character used as SQLite's `LIKE … ESCAPE` character: a
 * backslash. SQLite string literals do NOT process backslash escapes, so
 * `'\'` is a perfectly ordinary one-character SQL literal (see
 * {@link LIKE_ESCAPE_CLAUSE}).
 */
export const LIKE_ESCAPE_CHAR = "\\";

/**
 * The SQL fragment to append to any `LIKE ?` whose parameter was built with
 * {@link escapeLike}. Renders as `ESCAPE '\'`.
 */
export const LIKE_ESCAPE_CLAUSE = `ESCAPE '${LIKE_ESCAPE_CHAR}'`;

/**
 * Neutralise every `LIKE` metacharacter in a user-supplied search term so it
 * matches literally.
 *
 * Escapes `%` (any-run wildcard), `_` (single-character wildcard), and the
 * escape character itself — that last one is not optional: leaving a raw
 * backslash in the term makes the NEXT character an escape sequence, so a
 * term of `\` against `ESCAPE '\'` would produce the pattern `%\%`, whose
 * `\%` means "a literal percent sign" — i.e. searching for a backslash would
 * return the rows containing `%`. All three are handled in ONE regex pass, so
 * a backslash inserted by this function is never re-escaped by it.
 *
 * The caller still supplies its own `%…%` (or `…%`, or none) around the
 * result — this function deliberately does not decide the match shape, only
 * that the term's own characters are inert.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `${LIKE_ESCAPE_CHAR}${ch}`);
}
