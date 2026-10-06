import alfa303 from "@/assets/cards/alfa-3.03.jpg";
import alfa758 from "@/assets/cards/alfa-7.58.jpg";
import alfa1515 from "@/assets/cards/alfa-15.15.jpg";
import alfa2273 from "@/assets/cards/alfa-22.73.jpg";
import alfa7728 from "@/assets/cards/alfa-77.28.jpg";
import mtc167 from "@/assets/cards/mtc-1.67.jpg";
import mtc379 from "@/assets/cards/mtc-3.79.jpg";
import mtc450 from "@/assets/cards/mtc-4.5.jpg";
import mtc758 from "@/assets/cards/mtc-7.58.jpg";
import mtc1515 from "@/assets/cards/mtc-15.15.jpg";
import mtc2273 from "@/assets/cards/mtc-22.73.jpg";
import mtc7728 from "@/assets/cards/mtc-77.28.jpg";
import mtcStart from "@/assets/cards/mtc-start.jpg";

/**
 * Artwork for prepaid recharge cards, keyed by carrier then by the card's
 * face value as the catalog labels it (`frontend/src/data/mobileServices.ts`,
 * Prepaid group). Denominations with no artwork (alfa 1.22/4.5/10, mtc 1/10,
 * startSOS/smart/super) are simply absent — the tile falls back to its
 * logo + subcategory text.
 */
const CARD_IMAGES: Record<"alfa" | "mtc", Record<string, string>> = {
  alfa: {
    "3.03": alfa303,
    "7.58": alfa758,
    "15.15": alfa1515,
    "22.73": alfa2273,
    "77.28": alfa7728,
  },
  mtc: {
    "1.67": mtc167,
    "3.79": mtc379,
    "4.5": mtc450,
    "7.58": mtc758,
    "15.15": mtc1515,
    "22.73": mtc2273,
    "77.28": mtc7728,
    start: mtcStart,
  },
};

/** Normalise a label so "4.50", "4.5$" and "$4.5" all hit the "4.5" key. */
function normaliseLabel(label: string): string {
  const trimmed = label.trim().toLowerCase().replace(/\$/g, "").trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return String(Number(trimmed));
  return trimmed;
}

/**
 * Card image for a mobile-service item, or `undefined` when there is none.
 * Only Prepaid items qualify: other groups reuse numeric labels (e.g. mtc
 * Credits "3$") that are not physical cards.
 */
export function getCardImage(item: {
  category: string;
  subcategory: string;
  label: string;
}): string | undefined {
  if (item.subcategory.trim().toLowerCase() !== "prepaid") return undefined;
  const carrier = item.category.trim().toLowerCase();
  if (carrier !== "alfa" && carrier !== "mtc") return undefined;
  return CARD_IMAGES[carrier][normaliseLabel(item.label)];
}
