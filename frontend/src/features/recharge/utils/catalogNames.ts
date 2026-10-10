import type { ApiAdapter } from "@liratek/ui";

/**
 * Catalog category / subcategory names are free text stored on each item —
 * there is no category table, so a name exists only while an item uses it.
 *
 * Any name is allowed, but a typed name that matches an existing one ignoring
 * case and surrounding spaces must reuse the EXISTING spelling. Otherwise
 * "ALFA" and "alfa" become two groups, and the carrier checks disagree about
 * the "ALFA" one: `parseCarrierKey` (core) lowercases, while
 * `KatshForm.isTelecomVoucher` compares exactly.
 */
export function resolveCatalogName(
  typed: string,
  existing: readonly string[],
): string {
  const trimmed = typed.trim();
  const lower = trimmed.toLowerCase();
  return (
    existing.find((name) => name.trim().toLowerCase() === lower) ?? trimmed
  );
}

/** Form state of the sale screen's inline "add item" form. `isNewCategory`
 * makes the category itself editable (a new category is saved with its
 * first item). */
export interface NewServiceItemForm {
  provider: string;
  category: string;
  subcategory: string;
  label: string;
  cost_lbp: string;
  sell_lbp: string;
  sort_order: string;
  isNewCategory?: boolean;
}

export function emptyNewServiceItemForm(
  provider: string,
  category: string,
  isNewCategory = false,
): NewServiceItemForm {
  return {
    provider,
    category,
    subcategory: "",
    label: "",
    cost_lbp: "",
    sell_lbp: "",
    sort_order: "0",
    ...(isNewCategory ? { isNewCategory: true } : {}),
  };
}

/** The adapter's create payload, derived — never a hand-copied shape. */
type CreateMobileServiceItemPayload = Parameters<
  ApiAdapter["createMobileServiceItem"]
>[0];

export type NewServiceItemPayloadResult =
  | {
      ok: true;
      payload: CreateMobileServiceItemPayload;
    }
  | { ok: false; error: string };

/**
 * Validate the form and build the create payload — ONE builder for both sale
 * screens. Category and subcategory reuse an existing spelling on a
 * case-insensitive match ({@link resolveCatalogName}).
 */
export function buildNewServiceItemPayload(
  form: NewServiceItemForm,
  existingCategories: readonly string[],
  existingSubcategoriesFor: (category: string) => readonly string[],
): NewServiceItemPayloadResult {
  if (!form.category.trim() || !form.subcategory.trim()) {
    return { ok: false, error: "Category and subcategory are required" };
  }
  if (!form.label.trim() || !form.cost_lbp || !form.sell_lbp) {
    return { ok: false, error: "Label, cost, and sell are required" };
  }
  const costLbp = parseInt(form.cost_lbp, 10);
  const sellLbp = parseInt(form.sell_lbp, 10);
  if (isNaN(costLbp) || isNaN(sellLbp)) {
    return { ok: false, error: "Cost and sell must be valid numbers" };
  }
  const category = resolveCatalogName(form.category, existingCategories);
  const subcategory = resolveCatalogName(
    form.subcategory,
    existingSubcategoriesFor(category),
  );
  return {
    ok: true,
    payload: {
      provider: form.provider,
      category,
      subcategory,
      label: form.label.trim(),
      cost_lbp: costLbp,
      sell_lbp: sellLbp,
      sort_order: parseInt(form.sort_order, 10) || 0,
    },
  };
}
