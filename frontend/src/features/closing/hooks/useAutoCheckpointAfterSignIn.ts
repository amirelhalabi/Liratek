/**
 * Open the Checkpoint window once, right after a FRESH sign-in.
 *
 * Brings back the pre-v1.18.49 "count the drawer when you sign in" prompt:
 * an admin of a shop that uses checkpoints gets ONE window listing every
 * visible drawer (General first, then the dashboard's order), each saved on
 * its own (owner decision 2026-10-07). It opens only while at least one
 * visible drawer has not been counted today.
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
import {
  listDrawersForCheckpoint,
  type DrawerForCheckpoint,
} from "../utils/autoCheckpoint";

interface ModuleRow {
  key: string;
  is_enabled: number | boolean;
}

interface SettingRow {
  key_name: string;
  value: string;
}

export function useAutoCheckpointAfterSignIn(
  openCheckpoint: (drawers: DrawerForCheckpoint[]) => void,
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
        const [balances, lastCheckpoints, modules, settings] =
          await Promise.all([
            apiRef.current.getSystemExpectedBalancesDynamic(),
            apiRef.current.getLastCheckpointPerDrawer(),
            apiRef.current.getEnabledModules(),
            // Settings are a nicety here: if they fail, the base system is
            // unknown and no drawer is hidden on its account. Wrapped so a
            // synchronous throw (an adapter without the read) fails only
            // this read, never the whole window.
            Promise.resolve()
              .then(() => apiRef.current.getAllSettings())
              .catch(() => []),
          ]);
        const baseSetting = (
          Array.isArray(settings) ? (settings as SettingRow[]) : []
        ).find((s) => s.key_name === "shop_base_system")?.value;
        const baseSystem =
          baseSetting === "WHISH"
            ? "WHISH"
            : baseSetting === "OMT"
              ? "OMT"
              : null;
        const enabled = new Set(
          (Array.isArray(modules) ? (modules as ModuleRow[]) : [])
            .filter((m) => m.is_enabled)
            .map((m) => m.key),
        );
        const drawers = listDrawersForCheckpoint(
          Object.keys(balances ?? {}),
          lastCheckpoints,
          today,
          // The other system's cash drawer is not asked for while empty —
          // the shop has no such physical drawer.
          (name) =>
            isDrawerVisible(name, (key) => enabled.has(key), {
              baseSystem,
              balances: balances?.[name] ?? {},
            }),
        );
        if (drawers && mounted.current) openRef.current(drawers);
      } catch (error) {
        // Never block the app over a convenience prompt.
        logger.warn("Could not decide the after-sign-in checkpoint", { error });
      }
    })();
  }, [freshSignIn, user, isAdmin, flagsLoaded, flags.sessionManagement]);
}
