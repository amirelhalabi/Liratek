import { i18n } from "@/i18n/setup";

/**
 * LIRA-331 (OD-3): the label shown for a product category. The stored name
 * is what every payload, filter value and comparison uses; only the text on
 * screen is translated. A category create_db.sql seeds, whose name still
 * equals that seed, shows its catalog entry (`inventory:categorySeed.<Name>`)
 * in the display language. A renamed seed, or a category the shop added, is
 * shown as stored.
 */
const SEEDED_CATEGORIES = [
  "Accessories",
  "Phones",
  "Chargers",
  "Audio",
  "Parts",
  "Services",
] as const;

type SeededCategory = (typeof SEEDED_CATEGORIES)[number];

function isSeeded(name: string): name is SeededCategory {
  return (SEEDED_CATEGORIES as readonly string[]).includes(name);
}

export function categoryLabel(
  name: string | null | undefined,
  /** The language shown — `i18n.language` from the caller's useTranslation. */
  language: string,
): string {
  if (!name) return name ?? "";
  if (!isSeeded(name)) return name;
  return i18n.getFixedT(language, "inventory")(`categorySeed.${name}`);
}
