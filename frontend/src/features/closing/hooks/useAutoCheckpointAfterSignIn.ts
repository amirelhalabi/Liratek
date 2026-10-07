/**
 * Open the Checkpoint window once, right after a FRESH sign-in.
 *
 * Brings back the pre-v1.18.49 "count the drawer when you sign in" prompt,
 * now per drawer: an admin of a shop that uses checkpoints gets the window
 * for the first drawer (General first, then the dashboard's order) that has
 * not been counted today.
 *
 * Once per sign-in, by construction: the trigger is AuthContext's
 * `freshSignIn`, which a page refresh never sets, and which is consumed here
 * BEFORE the fetch — so closing the window, a re-render, or MainLayout
 * re-mounting can never bring it back.
 *
 * Shared by desktop and web (rule 19): every read goes through useApi().
 */

import { useEffect, useRef } from "react";
import { useApi } from "@liratek/ui";
import { isDrawerVisible } from "@liratek/core";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useFeatureFlags } from "@/contexts/FeatureFlagContext";
import { localDay } from "@/shared/utils/localDay";
import logger from "@/utils/logger";
import { pickDrawerToCheckpoint } from "../utils/autoCheckpoint";

interface ModuleRow {
  key: string;
  is_enabled: number | boolean;
}

export function useAutoCheckpointAfterSignIn(
  openCheckpoint: (drawerName: string) => void,
): void {
  const { user, freshSignIn, clearFreshSignIn } = useAuth();
  const { flags, loaded: flagsLoaded } = useFeatureFlags();
  const isAdmin = user?.role === "admin";

  // Rule 25: `api` and the callbacks are read through refs, so the effect
  // depends only on the values that decide whether to act.
  // Refreshed in an effect declared BEFORE the one that reads them, so they
  // are current when it runs (effects run in declaration order).
  const api = useApi();
  const apiRef = useRef(api);
  const openRef = useRef(openCheckpoint);
  const clearRef = useRef(clearFreshSignIn);
  useEffect(() => {
    apiRef.current = api;
    openRef.current = openCheckpoint;
    clearRef.current = clearFreshSignIn;
  });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!freshSignIn || !user) return;
    // Only an admin can count a drawer (the window renders for admins only).
    if (!isAdmin) {
      clearRef.current();
      return;
    }
    // The defaults say "checkpoints on" — wait for the shop's own settings.
    if (!flagsLoaded) return;
    clearRef.current();
    if (!flags.sessionManagement) return;

    // The shop's own today (rule 27), taken at the moment of sign-in.
    const today = localDay();
    void (async () => {
      try {
        const [balances, lastCheckpoints, modules] = await Promise.all([
          apiRef.current.getSystemExpectedBalancesDynamic(),
          apiRef.current.getLastCheckpointPerDrawer(),
          apiRef.current.getEnabledModules(),
        ]);
        const enabled = new Set(
          (Array.isArray(modules) ? (modules as ModuleRow[]) : [])
            .filter((m) => m.is_enabled)
            .map((m) => m.key),
        );
        const drawer = pickDrawerToCheckpoint(
          Object.keys(balances ?? {}),
          lastCheckpoints,
          today,
          (name) => isDrawerVisible(name, (key) => enabled.has(key)),
        );
        if (drawer && mounted.current) openRef.current(drawer);
      } catch (error) {
        // Never block the app over a convenience prompt.
        logger.warn("Could not decide the after-sign-in checkpoint", { error });
      }
    })();
  }, [freshSignIn, user, isAdmin, flagsLoaded, flags.sessionManagement]);
}
