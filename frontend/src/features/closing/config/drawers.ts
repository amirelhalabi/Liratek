/**
 * Drawer Configuration
 * Centralized configuration for all drawer types
 *
 * OMT_System / Whish_System labels (Primary Cash Drawer plan §1, §8.1):
 * these are the PHYSICAL cash drawer at the shop's money-transfer counter,
 * not a spendable balance held inside the provider's own system (the PR #66
 * float model the owner rejected). The drawer NAMES never change — only the
 * label wording does. Both entries always exist (registered regardless of
 * which system is primary); the non-primary one just lies dormant per
 * `shop_base_system` (see useShopBase()).
 */

import type { DrawerType, DrawerConfig } from "../types";

export const DRAWER_CONFIGS: Record<DrawerType, DrawerConfig> = {
  General: {
    type: "General",
    label: "General",
    description: "Main cash register",
    icon: "wallet",
    color: {
      border: "border-blue-500/30",
      background: "bg-blue-500/5",
      accent: "blue-500",
    },
  },
  OMT_System: {
    type: "OMT_System",
    label: "OMT Cash Drawer",
    description: "Physical cash drawer at the OMT counter",
    icon: "dollar-sign",
    color: {
      border: "border-green-500/30",
      background: "bg-green-500/5",
      accent: "green-500",
    },
  },
  OMT_App: {
    type: "OMT_App",
    label: "OMT App",
    description: "OMT app wallet",
    icon: "smartphone",
    color: {
      border: "border-lime-500/30",
      background: "bg-lime-500/5",
      accent: "lime-500",
    },
  },
  Whish_App: {
    type: "Whish_App",
    label: "Whish App",
    description: "Whish app",
    icon: "dollar-sign",
    color: {
      border: "border-emerald-500/30",
      background: "bg-emerald-500/5",
      accent: "emerald-500",
    },
  },
  Binance: {
    type: "Binance",
    label: "Binance",
    description: "Binance wallet",
    icon: "dollar-sign",
    color: {
      border: "border-yellow-500/30",
      background: "bg-yellow-500/5",
      accent: "yellow-500",
    },
  },
  MTC: {
    type: "MTC",
    label: "MTC",
    description: "MTC recharges",
    icon: "phone",
    color: {
      border: "border-orange-500/30",
      background: "bg-orange-500/5",
      accent: "orange-500",
    },
  },
  Alfa: {
    type: "Alfa",
    label: "Alfa",
    description: "Alfa recharges",
    icon: "phone",
    color: {
      border: "border-red-500/30",
      background: "bg-red-500/5",
      accent: "red-500",
    },
  },
  iPick: {
    type: "iPick",
    label: "iPick",
    description: "iPick services",
    icon: "zap",
    color: {
      border: "border-sky-500/30",
      background: "bg-sky-500/5",
      accent: "sky-500",
    },
  },
  Katsh: {
    type: "Katsh",
    label: "Katsh",
    description: "Katsh services",
    icon: "zap",
    color: {
      border: "border-orange-500/30",
      background: "bg-orange-500/5",
      accent: "orange-500",
    },
  },
  Whish_System: {
    type: "Whish_System",
    label: "Whish Cash Drawer",
    description: "Physical cash drawer at the Whish counter",
    icon: "zap",
    color: {
      border: "border-fuchsia-500/30",
      background: "bg-fuchsia-500/5",
      accent: "fuchsia-500",
    },
  },
};

/**
 * The two provider drawers whose balance is the shop's OWN SIM credit stock
 * (D2 / plan §0.1: `drawer == Σ credits of that carrier's active lines`).
 * A checkpoint of these counts the line — credits AND validity expiry — and
 * lets the drawer follow. Mirrors `CARRIER_DRAWER_NAMES` in `@liratek/core`,
 * inverted; the two must stay in step.
 */
export const DRAWER_CARRIER: Partial<Record<DrawerType, "alfa" | "mtc">> = {
  MTC: "mtc",
  Alfa: "alfa",
};

export const DRAWER_ORDER: DrawerType[] = [
  "General",
  "OMT_System",
  "OMT_App",
  "Whish_App",
  "Binance",
  "MTC",
  "Alfa",
  "iPick",
  "Katsh",
  "Whish_System",
];
