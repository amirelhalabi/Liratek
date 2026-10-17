/**
 * LIRA-331: English templates for messages the server sends to a user
 * (contracts/error-envelope.md). A pure leaf (rule 29): reachable from
 * browser.ts, so it imports nothing with a Node built-in.
 *
 * P1 holds only the generic families; P2 (T070–T081) splits the catalog into
 * per-area leaves under `messages/server/<area>.ts` and merges them here with
 * `<area>.` key prefixes. The client's `server` namespace (en) is built from
 * this object, so English text exists once.
 *
 * Params are RAW values (numbers, currency codes), never pre-formatted text:
 * the client formats them, so Arabic shows the same digits as English and the
 * server's locale never leaks into the message (rule 27).
 */
export const SERVER_MESSAGES = {
  "generic.saveFailed": "Could not save. Please try again.",
  "generic.loadFailed": "Could not load. Please try again.",
  "generic.deleteFailed": "Could not delete. Please try again.",
  "generic.unexpected": "Something went wrong. Please try again.",
} as const;

export type ServerMessageKey = keyof typeof SERVER_MESSAGES;

export type ServerMessageParams = Record<string, string | number>;

/**
 * Fills `{{name}}` placeholders with raw values. A param that is missing
 * leaves its placeholder visible: a slightly odd message beats a crash on a
 * refusal path.
 */
export function interpolateTemplate(
  template: string,
  params?: ServerMessageParams,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = params?.[name];
    return value === undefined ? match : String(value);
  });
}

export function renderServerMessage(
  key: ServerMessageKey,
  params?: ServerMessageParams,
): string {
  return interpolateTemplate(SERVER_MESSAGES[key], params);
}
