/**
 * LIRA-278: the admin Invitations list's Source filter reaches the server as
 * `?source=` — named from the core query schema (rule 24), and absent for
 * "all" so the server returns every source.
 */
import {
  listSignupInvitationsQuerySchema,
  type ListSignupInvitationsQuery,
} from "@liratek/core";
import { adminListSignupInvitations } from "../backendApi";

describe("adminListSignupInvitations(source)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    delete (window as unknown as { api?: unknown }).api;
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          data: { emailConfigured: true, invitations: [] },
        }),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function requestedQuery(): Record<string, string> {
    const [url] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string];
    return Object.fromEntries(new URL(url, "http://x").searchParams);
  }

  it("a source filter is sent as the schema's query, and the schema accepts it", async () => {
    const query: ListSignupInvitationsQuery = { source: "self" };
    await adminListSignupInvitations(query.source);
    expect(requestedQuery()).toEqual(query);
    expect(listSignupInvitationsQuerySchema.parse(requestedQuery())).toEqual(
      query,
    );
  });

  it("no filter: no query string at all", async () => {
    await adminListSignupInvitations();
    expect(requestedQuery()).toEqual({});
  });
});
