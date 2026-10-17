/**
 * LIRA-331: a drawer's label/description in the displayed language. The
 * drawer CODE (`OMT_System`) is the stored value and never changes; only the
 * words shown for it are translated. Unknown names are shown as they are.
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { DRAWER_CONFIGS } from "../config/drawers";
import type { DrawerType } from "../types";

function isDrawerType(name: string): name is DrawerType {
  return Object.prototype.hasOwnProperty.call(DRAWER_CONFIGS, name);
}

export function useDrawerText() {
  const { t } = useTranslation("closing");
  const label = useCallback(
    (name: string): string =>
      isDrawerType(name) ? t(`drawers.${name}.label`) : name,
    [t],
  );
  const description = useCallback(
    (name: string): string =>
      isDrawerType(name) ? t(`drawers.${name}.description`) : "",
    [t],
  );
  return { label, description };
}
