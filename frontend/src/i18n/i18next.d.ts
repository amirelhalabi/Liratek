/**
 * LIRA-331: typed translation keys. A mistyped key or namespace is a compile
 * error, checked against the bundled English catalogs.
 */
import "i18next";
import type { EN_RESOURCES } from "@liratek/ui/i18n/resources";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: typeof EN_RESOURCES;
    returnNull: false;
  }
}
