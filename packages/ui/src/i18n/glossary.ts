/**
 * LIRA-331 (FR-010, SC-005): the agreed Arabic words, seeded from
 * landing/ar.html (data-model.md §7). The owner reviews and extends this list
 * before Arabic ships (OD-4).
 *
 * scripts/check-i18n.mjs (G5) fails when any Arabic catalog value contains a
 * `forbidden` variant, so one concept is always called the same thing across
 * the desktop app, the web app, the phone app and the landing page.
 *
 * The guard reads `forbidden: [...]` lists by matching quoted strings, so keep
 * each entry's forbidden list on one line. Pure leaf.
 */
export interface GlossaryTerm {
  en: string;
  ar: string;
  forbidden: readonly string[];
  source: "landing" | "owner";
}

export const GLOSSARY = {
  shopKind: { en: "mobile shop", ar: "محل خليوي", forbidden: ["محل هواتف"], source: "landing" },
  drawers: { en: "drawers", ar: "الصناديق", forbidden: ["الأدراج"], source: "landing" },
  drawer: { en: "drawer", ar: "الصندوق", forbidden: ["الدرج"], source: "landing" },
  change: { en: "change (money returned)", ar: "الفكّة", forbidden: ["الصرافة"], source: "landing" },
  currencies: { en: "dollars and lira", ar: "الدولار والليرة", forbidden: [], source: "landing" },
  debts: { en: "debts", ar: "الديون", forbidden: ["الذمم"], source: "landing" },
  debtBook: { en: "customer debt book", ar: "دفتر ديون الزبائن", forbidden: [], source: "landing" },
  closing: { en: "closing", ar: "الإقفال", forbidden: ["الإغلاق"], source: "landing" },
  profits: { en: "profits", ar: "الأرباح", forbidden: [], source: "landing" },
  recharge: { en: "credit and days top-up", ar: "تشريج رصيد وأيام", forbidden: [], source: "landing" },
  repairs: { en: "repairs", ar: "التصليحات", forbidden: ["الصيانة"], source: "landing" },
  warranty: { en: "warranty", ar: "الكفالة", forbidden: ["الضمان"], source: "landing" },
  inventory: { en: "inventory", ar: "المخزون", forbidden: [], source: "landing" },
  sales: { en: "sales", ar: "المبيعات", forbidden: [], source: "landing" },
  customer: { en: "customer", ar: "الزبون", forbidden: ["العميل"], source: "landing" },
  supplier: { en: "supplier", ar: "المورّد", forbidden: [], source: "landing" },
  wallet: { en: "wallet", ar: "المحفظة", forbidden: [], source: "landing" },
  commission: { en: "commission", ar: "العمولة", forbidden: [], source: "landing" },
  drawerCount: { en: "count the drawer", ar: "عدّ الصندوق", forbidden: ["جرد"], source: "landing" },
} as const satisfies Record<string, GlossaryTerm>;

export type GlossaryTermId = keyof typeof GLOSSARY;
