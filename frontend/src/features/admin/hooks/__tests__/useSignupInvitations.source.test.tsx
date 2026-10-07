/** @jest-environment jsdom */
/**
 * LIRA-278: the invitations query passes the Source filter to the API and
 * keys the cache per source (so switching the filter refetches). With no
 * filter the API gets `undefined` — never react-query's context object,
 * which is what a bare `queryFn: adminListSignupInvitations` would pass.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const adminListSignupInvitations = jest.fn();
jest.mock("@/api/backendApi", () => ({
  adminListSignupInvitations: (...args: unknown[]) =>
    adminListSignupInvitations(...args),
  adminCreateSignupInvitation: jest.fn(),
  adminRevokeSignupInvitation: jest.fn(),
}));

import {
  useSignupInvitationsQuery,
  ADMIN_SIGNUP_INVITATION_KEYS,
} from "../useSignupInvitations";

function wrapperWith(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  adminListSignupInvitations.mockReset();
  adminListSignupInvitations.mockResolvedValue({
    emailConfigured: true,
    invitations: [],
  });
});

it("passes the source to the API and keys the cache by it", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(() => useSignupInvitationsQuery("self"), {
    wrapper: wrapperWith(client),
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(adminListSignupInvitations).toHaveBeenCalledWith("self");
  expect(
    client.getQueryData([...ADMIN_SIGNUP_INVITATION_KEYS.all, "self"]),
  ).toBeDefined();
});

it("no filter: the API gets undefined, not the query context", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(() => useSignupInvitationsQuery(), {
    wrapper: wrapperWith(client),
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(adminListSignupInvitations).toHaveBeenCalledWith(undefined);
});
