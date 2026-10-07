import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminListSignupInvitations,
  adminCreateSignupInvitation,
  adminRevokeSignupInvitation,
} from "@/api/backendApi";
import type { CreateSignupInvitationInput } from "@liratek/core";

// ── Query key constants ─────────────────────────────────────────────────────
export const ADMIN_SIGNUP_INVITATION_KEYS = {
  all: ["admin", "signup-invitations"] as const,
};

// ── Read ──────────────────────────────────────────────────────────────────────
/** The newest invites plus whether this deployment can email them at all. */
export function useSignupInvitationsQuery() {
  return useQuery({
    queryKey: ADMIN_SIGNUP_INVITATION_KEYS.all,
    queryFn: adminListSignupInvitations,
  });
}

// ── Write ─────────────────────────────────────────────────────────────────────
/**
 * Email a sign-up link. A 409 (email not configured / address already has a
 * shop) rejects with requestJson's plain `{ status, message }` object, not an
 * Error — read it with `messageFrom`.
 */
export function useCreateSignupInvitationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSignupInvitationInput) =>
      adminCreateSignupInvitation(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ADMIN_SIGNUP_INVITATION_KEYS.all,
      });
    },
  });
}

export function useRevokeSignupInvitationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminRevokeSignupInvitation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ADMIN_SIGNUP_INVITATION_KEYS.all,
      });
    },
  });
}
