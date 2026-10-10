import { sessionHue } from "@liratek/core/utils/transactionRowDisplay";

/**
 * A session basket's colour, as on the web Transactions page: one hue per
 * session (core's `sessionHue`), with the web's saturation/lightness per
 * theme (frontend/src/index.css `--session-sat/-lig/-a1`).
 */
export function sessionColors(
  sessionId: number,
  scheme: "light" | "dark",
): { bar: string; tint: string } {
  const hue = sessionHue(sessionId);
  const [sat, lig, alpha] = scheme === "dark" ? [80, 66, 0.14] : [72, 42, 0.1];
  return {
    bar: `hsla(${hue}, ${sat}%, ${lig}%, 1)`,
    tint: `hsla(${hue}, ${sat}%, ${lig}%, ${alpha})`,
  };
}
