/**
 * The email preview (LIRA-267, T039): `yarn workspace @liratek/backend
 * email:preview [name]` renders a template with built-in sample data to
 * files and opens the HTML. The logic lives in `email/preview.ts` so it is
 * testable; `scripts/email-preview.ts` is a thin runner. No browser is ever
 * opened here — the opener is injected.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EMAIL_PREVIEW_SAMPLES,
  defaultPreviewDir,
  openPreview,
  writeEmailPreview,
} from "../preview.js";
import { listEmailTemplateNames } from "../templates/index.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-preview-test-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("writeEmailPreview", () => {
  it("has sample data for every template", () => {
    for (const name of listEmailTemplateNames()) {
      expect(EMAIL_PREVIEW_SAMPLES[name]).toBeDefined();
    }
  });

  it("writes <name>.html and <name>.txt and returns their paths", () => {
    const out = writeEmailPreview("signup-invite", dir);
    expect(out.htmlPath).toBe(path.join(dir, "signup-invite.html"));
    expect(out.textPath).toBe(path.join(dir, "signup-invite.txt"));
    expect(out.subject).toBe("You're invited to open your shop on LiraTek");
    const html = fs.readFileSync(out.htmlPath, "utf8");
    const text = fs.readFileSync(out.textPath, "utf8");
    expect(html).toContain("Create my shop");
    expect(text).toContain("Open your shop on LiraTek");
  });

  it("the sample shop name is hostile, and the HTML shows it escaped", () => {
    const hint = EMAIL_PREVIEW_SAMPLES["signup-invite"]!.shopNameHint;
    expect(String(hint)).toContain("<script>");
    const out = writeEmailPreview("signup-invite", dir);
    const html = fs.readFileSync(out.htmlPath, "utf8");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("creates the directory if it does not exist", () => {
    const nested = path.join(dir, "a", "b");
    writeEmailPreview("signup-invite", nested);
    expect(fs.existsSync(path.join(nested, "signup-invite.html"))).toBe(true);
  });

  it("throws for an unknown template, naming the known ones", () => {
    expect(() => writeEmailPreview("nope", dir)).toThrow(/signup-invite/);
  });

  it("defaults to <tmpdir>/liratek-email-preview", () => {
    expect(defaultPreviewDir()).toBe(
      path.join(os.tmpdir(), "liratek-email-preview"),
    );
  });
});

describe("openPreview", () => {
  it("uses `open` on macOS and xdg-open elsewhere", () => {
    const calls: Array<[string, string[]]> = [];
    const spawner = (cmd: string, args: string[]) => {
      calls.push([cmd, args]);
    };
    openPreview("/tmp/x.html", "darwin", spawner);
    openPreview("/tmp/x.html", "linux", spawner);
    expect(calls).toEqual([
      ["open", ["/tmp/x.html"]],
      ["xdg-open", ["/tmp/x.html"]],
    ]);
  });

  it("ignores a failing opener", () => {
    expect(() =>
      openPreview("/tmp/x.html", "linux", () => {
        throw new Error("spawn xdg-open ENOENT");
      }),
    ).not.toThrow();
  });
});
