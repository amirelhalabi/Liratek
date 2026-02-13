/**
 * Drawer Configuration
 * Centralized configuration for all drawer types
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
    label: "OMT System",
    description: "OMT system",
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
    description: "Touch recharges",
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
};

export const DRAWER_ORDER: DrawerType[] = [
  "General",
  "OMT_System",
  "OMT_App",
  "Whish_App",
  "Binance",
  "MTC",
  "Alfa",
];
