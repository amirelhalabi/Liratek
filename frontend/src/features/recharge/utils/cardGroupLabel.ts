/**
 * The group an item belongs to: its subcategory, or its category when it has
 * no subcategory. One definition for every card grid (rule 14).
 */
export function cardGroupLabel(item: {
  category: string;
  subcategory: string;
}): string {
  return item.subcategory.trim() || item.category.trim();
}
