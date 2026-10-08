/**
 * LIRA-288 — the "Join with Google" ticket and state (security/googleOAuth.ts).
 *
 * The join ticket carries the invite token, the chosen username and the
 * shop from POST /api/user-invitations/google/start to the www start (a
 * form POST, never a URL). It lives 10 minutes, cannot pass as any other
 * purpose's ticket, and the state cookie carries the same three fields to
 * the callback.
 */

jest.mock("@liratek/core", () => ({
  ...jest.requireActual<typeof import("@liratek/core")>("@liratek/core"),
  JWT_SECRET: "google-oauth-join-test-secret-0123456789-0123456789",
}));

import jwt from "jsonwebtoken";
import {
  TICKET_TTL_SECONDS,
  readJoinTicket,
  readStateTicket,
  signTicket,
  verifyTicket,
} from "../googleOAuth.js";

const JOIN = { token: "invite-token-abc", username: "rami", tenantId: 2 };

describe("join ticket", () => {
  it("lives 10 minutes", () => {
    expect(TICKET_TTL_SECONDS.join).toBe(10 * 60);
    const ticket = signTicket("join", JOIN);
    const claims = jwt.decode(ticket) as { exp: number; iat: number };
    expect(claims.exp - claims.iat).toBe(600);
  });

  it("round-trips the invite token, username and shop", () => {
    expect(readJoinTicket(verifyTicket("join", signTicket("join", JOIN)))).toEqual(JOIN);
  });

  it("is refused as any other purpose, and other purposes are refused as it", () => {
    const ticket = signTicket("join", JOIN);
    expect(verifyTicket("link", ticket)).toBeNull();
    expect(verifyTicket("join", signTicket("link", { userId: 1, tenantId: 2 }))).toBeNull();
  });

  it("refuses a malformed payload", () => {
    expect(readJoinTicket({ token: "t", username: "", tenantId: 2 })).toBeNull();
    expect(readJoinTicket({ token: "t", username: "rami", tenantId: "2" })).toBeNull();
    expect(readJoinTicket(null)).toBeNull();
  });
});

describe("state ticket, join intent", () => {
  const base = { state: "s", verifier: "v", nonce: "n" };

  it("carries the join fields to the callback", () => {
    expect(
      readStateTicket({
        ...base,
        intent: "join",
        joinToken: JOIN.token,
        joinUsername: JOIN.username,
        joinTenantId: JOIN.tenantId,
      }),
    ).toEqual({
      ...base,
      intent: "join",
      join: JOIN,
    });
  });

  it("refuses a join state without its fields", () => {
    expect(readStateTicket({ ...base, intent: "join" })).toBeNull();
  });
});
