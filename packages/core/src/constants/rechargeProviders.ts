/**
 * Recharge Provider Constants
 *
 * Defines the list of providers that support drawer top-up functionality.
 * These providers have dedicated drawers that can be topped up from other drawers.
 */

export const TOP_UP_PROVIDERS = [
  "MTC",
  "Alfa",
  "OMT_APP",
  "WHISH_APP",
  "OMT_SYSTEM",
  "WHISH_SYSTEM",
  "iPick",
  "Katsh",
] as const;

export type TopUpProvider = (typeof TOP_UP_PROVIDERS)[number];

/**
 * Map of top-up providers to their destination drawer names
 */
export const TOP_UP_PROVIDER_DRAWERS: Record<TopUpProvider, string> = {
  MTC: "MTC",
  Alfa: "Alfa",
  OMT_APP: "OMT_App",
  WHISH_APP: "Whish_App",
  OMT_SYSTEM: "OMT_System",
  WHISH_SYSTEM: "Whish_System",
  iPick: "iPick",
  Katsh: "Katsh",
};

/**
 * Map of top-up providers to their default source drawer names
 */
export const TOP_UP_PROVIDER_DEFAULT_SOURCES: Record<TopUpProvider, string> = {
  MTC: "General",
  Alfa: "General",
  OMT_APP: "OMT_System",
  WHISH_APP: "General",
  OMT_SYSTEM: "General",
  WHISH_SYSTEM: "General",
  iPick: "General",
  Katsh: "General",
};

/**
 * Map of top-up providers to their display labels
 */
export const TOP_UP_PROVIDER_LABELS: Record<TopUpProvider, string> = {
  MTC: "MTC",
  Alfa: "Alfa",
  OMT_APP: "OMT App",
  WHISH_APP: "Whish App",
  OMT_SYSTEM: "OMT System",
  WHISH_SYSTEM: "Whish System",
  iPick: "iPick",
  Katsh: "Katsh",
};

/**
 * Check if a provider supports top-up functionality
 */
export function isTopUpProvider(provider: string): provider is TopUpProvider {
  return TOP_UP_PROVIDERS.includes(provider as TopUpProvider);
}
