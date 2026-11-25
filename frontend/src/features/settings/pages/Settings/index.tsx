import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@liratek/ui";
import { isElectron } from "@/api/backendApi";
import UsersManager from "./UsersManager";
import Diagnostics from "./Diagnostics";
import LicensePanel from "./LicensePanel";
import CurrencyManager from "./CurrencyManager";
import ShopConfig from "./ShopConfig";
import NotificationsConfig from "./NotificationsConfig";
import ModulesManager from "./ModulesManager";
import IntegrationsConfig from "./IntegrationsConfig";
import CategoriesManager from "./CategoriesManager";
import MobileServicesManager from "./MobileServicesManager";
import CarrierLinesManager from "./CarrierLinesManager";
import ProfitsPasswordPanel from "./ProfitsPasswordPanel";
import ResetDataPanel from "./ResetDataPanel";
import SignedInDevices from "./SignedInDevices";
// LIRA-306 US3: paired PCs for offline work (web app).
import PairedPcsPanel from "./PairedPcsPanel";
// Web app: an admin downloads a backup file of their own shop.
import ShopBackupPanel from "./ShopBackupPanel";
// LIRA-377: an admin restores the shop to an earlier time, a file, or undoes a restore.
import ShopRestorePanel from "./ShopRestorePanel";
// LIRA-306: pair THIS desktop PC for offline work (desktop app).
import { PairThisPcCard } from "@/features/offline/components/PairThisPcCard";
// LIRA-280: Connect Google, on the tab about how this user signs in.
import GoogleAccountPanel from "./GoogleAccountPanel";

type TabKey =
  | "shop"
  | "categories"
  | "notifications"
  | "modules"
  | "currencies"
  | "users"
  | "devices"
  | "paired-pcs"
  | "this-pc"
  | "diagnostics"
  | "integrations"
  | "mobile-services"
  | "carrier-lines"
  | "profits"
  | "license"
  | "backup"
  | "reset";

/** Every valid tab key — the single source of truth for the `?tab=` deep
 *  link below, so a new tab automatically becomes a valid deep-link target
 *  without a second list to maintain (rule 14). */
const TAB_KEYS: readonly TabKey[] = [
  "shop",
  "categories",
  "notifications",
  "modules",
  "currencies",
  "users",
  "devices",
  "paired-pcs",
  "this-pc",
  "diagnostics",
  "integrations",
  "mobile-services",
  "carrier-lines",
  "profits",
  "license",
  "backup",
  "reset",
];

/** `tabs.<label>` i18n key for each tab. */
const TAB_LABEL_KEYS = {
  shop: "shop",
  categories: "categories",
  notifications: "notifications",
  modules: "modules",
  currencies: "currencies",
  users: "users",
  devices: "devices",
  "paired-pcs": "pairedPcs",
  "this-pc": "thisPc",
  diagnostics: "diagnostics",
  integrations: "integrations",
  "mobile-services": "mobileServices",
  "carrier-lines": "carrierLines",
  profits: "profits",
  license: "license",
  backup: "backup",
  reset: "reset",
} as const satisfies Record<TabKey, string>;

/** The one-sentence intro under each section's title, shown once by the
 *  shell (owner request 2026-11-25: every section looks alike). Where a
 *  panel already had an intro, its existing key is reused here and the
 *  panel no longer renders it — one sentence, one place (rule 14). */
const SECTION_INTRO_KEYS = {
  shop: "sectionIntro.shop",
  categories: "sectionIntro.categories",
  notifications: "sectionIntro.notifications",
  modules: "modules.intro",
  currencies: "sectionIntro.currencies",
  users: "sectionIntro.users",
  devices: "devices.intro",
  "paired-pcs": "pairedPcs.intro",
  "this-pc": "sectionIntro.thisPc",
  diagnostics: "sectionIntro.diagnostics",
  integrations: "integrations.intro",
  "mobile-services": "sectionIntro.mobileServices",
  "carrier-lines": "carrierLines.intro",
  profits: "profitsPassword.intro",
  license: "license.intro",
  backup: "sectionIntro.backup",
  reset: "sectionIntro.reset",
} as const satisfies Record<TabKey, string>;

/** The side menu's groups, in order. Every tab key appears exactly once.
 *  "reset" stays last — a destructive action, kept away from the tabs an
 *  operator reaches for day to day. */
const MENU_GROUPS: readonly {
  key: "shop" | "catalogue" | "people" | "devices" | "data";
  tabs: readonly TabKey[];
}[] = [
  {
    key: "shop",
    tabs: ["shop", "modules", "currencies", "notifications", "integrations"],
  },
  {
    key: "catalogue",
    tabs: ["categories", "mobile-services", "carrier-lines"],
  },
  { key: "people", tabs: ["users", "profits", "devices"] },
  { key: "devices", tabs: ["paired-pcs", "this-pc"] },
  { key: "data", tabs: ["backup", "diagnostics", "license", "reset"] },
];

function isTabKey(value: string | null): value is TabKey {
  return value != null && (TAB_KEYS as readonly string[]).includes(value);
}

/** Tabs whose entire content needs a capability the web build does not have.
 *  Filtered out of both the tab bar AND the `?tab=` deep link below, so a
 *  web visitor gets "this tab doesn't exist" (falls back to Shop Config)
 *  instead of a panel that throws on `window.api` being undefined:
 *    - "diagnostics" — local backup files, the on-disk SQLite path, and the
 *      embedded electron-updater panel; see Diagnostics.tsx's header for the
 *      section-by-section reasoning (it is not ALL desktop-only by nature —
 *      some of it is just not wired to the web adapter yet).
 *    - "license" — desktop licence-key entry; on the web a tenant's plan is
 *      carried in the JWT, not typed in. See LicensePanel.tsx's header.
 *  Do not "fix" either by adding a REST route for a file picker or an
 *  updater check — read the linked headers first.
 *    - "devices" (LIRA-291) — on the web, sign-in methods and signed-in
 *      devices live on "My account" (/account), which every role can open
 *      (Settings is admin-only). One place, not a second copy here. The
 *      desktop app has no My account link, so it keeps this tab. */
const DESKTOP_ONLY_TABS: readonly TabKey[] = [
  "diagnostics",
  "license",
  "devices",
  // LIRA-306 — pair THIS PC for offline work: only a desktop holds a copy.
  "this-pc",
];

/** Tabs that act on the server's shop data, which a desktop PC does not
 *  hold (LIRA-306, constitution E1):
 *    - "paired-pcs" — the PCs paired for offline work, and Unpair.
 *    - "backup" — download a backup file of the shop's server data (the
 *      desktop keeps its own local backups on Diagnostics). */
const WEB_ONLY_TABS: readonly TabKey[] = ["paired-pcs", "backup"];

function isTabAvailable(key: TabKey): boolean {
  if (WEB_ONLY_TABS.includes(key)) return !isElectron();
  return isElectron() || !DESKTOP_ONLY_TABS.includes(key);
}

/**
 * Deep-link mechanism (carrier-lines-validity plan Phase 4): any caller can
 * navigate here with `?tab=<key>` (e.g. `navigate("/settings?tab=carrier-lines")`
 * from the Dashboard's carrier-line expiry banner) and land directly on that
 * tab instead of the "Shop Config" default. Deliberately generic — keyed off
 * `TAB_KEYS`, not carrier-lines-specific — so any future tab gets the same
 * deep-link for free.
 *
 * Seeded once, in the `useState` initializer, deliberately not re-synced via
 * a `useEffect` on every `searchParams` change: `/settings` is one of several
 * distinct top-level routes (see `App.tsx`), so React Router always unmounts
 * and remounts this component on the way in from elsewhere — the initializer
 * reruns on every such navigation. A live-sync effect would only matter for a
 * second deep-link fired while already mounted here, which nothing in this
 * app does today, and it trips the `react-hooks/set-state-in-effect` rule.
 */
export default function Settings() {
  const [searchParams] = useSearchParams();
  const { t } = useTranslation("settings");
  const [active, setActive] = useState<TabKey>(() => {
    const tab = searchParams.get("tab");
    return isTabKey(tab) && isTabAvailable(tab) ? tab : "shop";
  });

  // The side menu: tabs grouped under headings (owner request 2026-11-25).
  // Desktop-only / web-only tabs (see the lists above) are filtered out per
  // build, and a group left empty is not shown.
  const groups = MENU_GROUPS.map((group) => ({
    key: group.key,
    label: t(`groups.${group.key}`),
    tabs: group.tabs
      .filter((key) => isTabAvailable(key))
      .map((key) => ({ key, label: t(`tabs.${TAB_LABEL_KEYS[key]}`) })),
  })).filter((group) => group.tabs.length > 0);

  // On a narrow screen the menu becomes one sideways-scrolling row; keep the
  // active tab in view (a `?tab=` deep link may open one past the edge).
  const tabBarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    tabBarRef.current
      ?.querySelector<HTMLElement>(`[data-tab="${active}"]`)
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-6 pt-6 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
      <PageHeader title={t("page.title")} />

      {/* Side menu (grouped) + the active section */}
      <div className="flex-1 min-h-0 bg-slate-800 rounded-xl border border-slate-700 shadow-lg flex flex-col lg:flex-row overflow-hidden">
        <nav
          ref={tabBarRef}
          aria-label={t("page.title")}
          className="shrink-0 flex lg:flex-col gap-2 lg:gap-4 p-2 lg:p-3 lg:w-56 border-b lg:border-b-0 lg:border-e border-slate-700 overflow-x-auto lg:overflow-x-hidden lg:overflow-y-auto"
        >
          {groups.map((group) => (
            <div
              key={group.key}
              role="group"
              aria-labelledby={`settings-group-${group.key}`}
              className="flex lg:flex-col gap-2 lg:gap-0.5 shrink-0"
            >
              <span
                id={`settings-group-${group.key}`}
                className="sr-only lg:not-sr-only px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
              >
                {group.label}
              </span>
              {group.tabs.map((tab) => (
                <button
                  key={tab.key}
                  data-tab={tab.key}
                  aria-current={active === tab.key ? "page" : undefined}
                  onClick={() => setActive(tab.key)}
                  className={`shrink-0 whitespace-nowrap lg:whitespace-normal text-start px-3 py-1.5 rounded-lg text-sm transition-colors ${active === tab.key ? "bg-violet-600 text-white" : "text-slate-300 hover:bg-slate-700/60 hover:text-white"}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="flex-1 min-h-0 overflow-y-auto -me-6 ps-4 pt-4 pe-10 pb-6">
          {/* The section header — rendered here once for every tab, so no
              panel draws its own title or intro. */}
          <header className="mb-6">
            <h2 className="text-lg font-semibold text-white">
              {t(`tabs.${TAB_LABEL_KEYS[active]}`)}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {t(SECTION_INTRO_KEYS[active])}
            </p>
          </header>
          {active === "shop" && <ShopConfig />}
          {active === "categories" && <CategoriesManager />}
          {active === "notifications" && <NotificationsConfig />}
          {active === "modules" && <ModulesManager />}
          {active === "currencies" && <CurrencyManager />}
          {active === "users" && <UsersManager />}
          {active === "devices" && (
            <>
              <GoogleAccountPanel />
              <SignedInDevices showIntro={false} />
            </>
          )}
          {active === "paired-pcs" && isTabAvailable("paired-pcs") && (
            <PairedPcsPanel />
          )}
          {active === "this-pc" && isTabAvailable("this-pc") && (
            <PairThisPcCard />
          )}
          {active === "profits" && <ProfitsPasswordPanel />}
          {active === "integrations" && <IntegrationsConfig />}
          {active === "mobile-services" && <MobileServicesManager />}
          {active === "carrier-lines" && (
            <CarrierLinesManager showIntro={false} />
          )}
          {/* isTabAvailable(...) here too, not just in the tab bar/deep-link
              seed above: belt-and-suspenders so neither of these ever
              mounts on the web build even if `active` were ever set some
              other way in the future. */}
          {active === "diagnostics" && isTabAvailable("diagnostics") && (
            <Diagnostics />
          )}
          {active === "license" && isTabAvailable("license") && (
            <LicensePanel />
          )}
          {active === "backup" && isTabAvailable("backup") && (
            <div className="space-y-6">
              <ShopBackupPanel />
              <ShopRestorePanel />
            </div>
          )}
          {active === "reset" && <ResetDataPanel />}
        </div>
      </div>
    </div>
  );
}
