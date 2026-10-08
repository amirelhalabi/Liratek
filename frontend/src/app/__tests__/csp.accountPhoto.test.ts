/**
 * LIRA-294 — the web app's Content-Security-Policy (frontend/index.html) lets
 * the Google profile photo load from Google's image host, and NOTHING
 * broader: img-src is exactly 'self', data: and https://*.googleusercontent.com.
 * Core's `safeGooglePictureUrl` accepts only that host, so the two agree.
 */

import fs from "node:fs";
import path from "node:path";
import { GOOGLE_PICTURE_HOST_SUFFIX } from "@liratek/core";

const html = fs.readFileSync(
  path.join(__dirname, "../../../index.html"),
  "utf8",
);

function imgSrc(): string[] {
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(
    html,
  )?.[1];
  expect(csp).toBeDefined();
  const directive = csp!
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("img-src "));
  expect(directive).toBeDefined();
  return directive!.split(/\s+/).slice(1);
}

it("img-src allows Google's image host and nothing broader", () => {
  expect(imgSrc()).toEqual([
    "'self'",
    "data:",
    `https://*${GOOGLE_PICTURE_HOST_SUFFIX}`,
  ]);
});
