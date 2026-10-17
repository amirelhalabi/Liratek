/**
 * LIRA-331 (FR-014, plan D3): a DIRECTION icon (Chevron*, Arrow*Left/Right,
 * back/next) that points the other way in right-to-left layouts. Never use it
 * for direction-neutral icons (cash, phone, printer, search, currency).
 *
 * Import by subpath (`@liratek/ui/components/ui/DirIcon`), not from the
 * barrel: many tests mock the barrel with a fixed export list.
 */
import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

export interface DirIconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  icon: IconComponent;
  className?: string;
}

export function DirIcon({ icon: Icon, className, ...rest }: DirIconProps) {
  const classes = className ? `${className} rtl:-scale-x-100` : "rtl:-scale-x-100";
  return <Icon {...rest} className={classes} />;
}
