/**
 * LIRA-331 (FR-015, plan D3): keeps a number, phone, IMEI, reference or
 * amount with its currency marker left-to-right inside Arabic text, so the
 * sign and the `$`/`LBP` stay attached and digits never reorder.
 *
 * Import by subpath (`@liratek/ui/components/ui/Ltr`), not from the barrel:
 * many tests mock the barrel with a fixed export list.
 */
import type { ReactNode } from "react";

export interface LtrProps {
  children: ReactNode;
  className?: string;
}

export function Ltr({ children, className }: LtrProps) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}
