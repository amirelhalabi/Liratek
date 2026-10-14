import { CARD_IMAGE_MANIFEST } from "./cardImageManifest";

/** Lower-case and collapse whitespace in a category / subcategory name. */
function normalisePart(part: string): string {
  return part.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Normalise a label so "4.50", "4.5$" and "$4.5" all hit the "4.5" key, and
 * "10$ PSN" hits "10 psn".
 */
function normaliseLabel(label: string): string {
  const trimmed = label
    .trim()
    .toLowerCase()
    .replace(/\$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return String(Number(trimmed));
  return trimmed;
}

/**
 * Card image for a mobile-service item, or `undefined` when there is none.
 * The lookup key includes the subcategory, so a group that reuses a numeric
 * label for something that is not a physical card (e.g. mtc Credits "7.58")
 * never picks up a Prepaid card's artwork. The provider is not part of the
 * key: iPick, Katsh and WHISH_APP sell the same card and share its image.
 */
export function getCardImage(item: {
  category: string;
  subcategory: string;
  label: string;
}): string | undefined {
  const key = [
    normalisePart(item.category),
    normalisePart(item.subcategory),
    normaliseLabel(item.label),
  ].join("|");
  return CARD_IMAGE_MANIFEST[key];
}
