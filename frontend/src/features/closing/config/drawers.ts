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
  OMT: {
    type: "OMT",
    label: "OMT",
    description: "Money transfers",
    icon: "dollar-sign",
    color: {
      border: "border-green-500/30",
      background: "bg-green-500/5",
      accent: "green-500",
    },
  },
  Whish: {
    type: "Whish",
    label: "Whish",
    description: "Whish wallet",
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
  "OMT",
  "Whish",
  "Binance",
  "MTC",
  "Alfa",
];
