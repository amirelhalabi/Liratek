// HTML templates for Instagram slides. Colors and fonts are the landing
// page's tokens (landing/styles.css), so posts match liratek.shop.
import path from "node:path";

export const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const asset = (p) => "file://" + path.join(ROOT, "assets", p);

const esc = (s = "") =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// *word* → accent color. Everything else escaped.
const rich = (s = "") => esc(s).replace(/\*(.+?)\*/g, '<span class="hl">$1</span>');

export const SIZES = {
  feed: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

const BASE_CSS = `
:root {
  --bg: #020222; --bg-2: #050938; --card: #0c134f; --line: #25336a;
  --text: #ffffff; --muted: #bfc7dc; --accent: #d4adfc; --accent-ink: #0c134f;
  --blue: #518cff; --green: #10b981;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: var(--w); height: var(--h); overflow: hidden; }
body {
  font-family: Inter, system-ui, sans-serif; color: var(--text);
  -webkit-font-smoothing: antialiased;
  background:
    radial-gradient(900px 700px at 85% -5%, rgba(81,140,255,.28), transparent 60%),
    radial-gradient(800px 650px at -10% 105%, rgba(212,173,252,.22), transparent 60%),
    var(--bg);
}
.grid { position: absolute; inset: 0; opacity: .5;
  background-image: linear-gradient(rgba(37,51,106,.35) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(37,51,106,.35) 1px, transparent 1px);
  background-size: 72px 72px;
  mask-image: radial-gradient(ellipse at center, #000 30%, transparent 80%); }
.page { position: absolute; inset: 0; padding: 80px 88px 170px; display: flex; flex-direction: column; justify-content: center; }
.eyebrow { color: var(--accent); font-weight: 600; font-size: 30px; letter-spacing: .02em; margin-bottom: 26px;
  display: inline-flex; align-items: center; gap: 14px; }
.eyebrow::before { content: ""; width: 34px; height: 4px; border-radius: 2px; background: var(--accent); }
h1 { font-weight: 800; font-size: 92px; line-height: 1.04; letter-spacing: -.03em; }
h1.md { font-size: 74px; }
h1.sm { font-size: 62px; }
.hl { color: var(--accent); }
.blue { color: var(--blue); }
.body { color: var(--muted); font-size: 36px; line-height: 1.45; margin-top: 32px; }
.ar { font-family: "IBM Plex Sans Arabic", sans-serif; direction: rtl; text-align: right; }
.sub-ar { color: var(--accent); font-size: 38px; font-weight: 600; margin-top: 30px; opacity: .92; }
.footer { position: absolute; left: 88px; right: 88px; bottom: 64px; display: flex; align-items: center;
  justify-content: space-between; color: var(--muted); font-size: 28px; }
.footer img { height: 40px; }
.dots { display: flex; gap: 10px; }
.dots i { width: 12px; height: 12px; border-radius: 50%; background: var(--line); }
.dots i.on { background: var(--accent); width: 34px; border-radius: 6px; }
.shot { position: relative; overflow: hidden; border-radius: 26px; border: 2px solid var(--line);
  box-shadow: 0 50px 120px -40px rgba(0,0,0,.9), 0 0 0 1px rgba(212,173,252,.06); background: #03052c; }
.shot img { position: absolute; max-width: none; }
.ring { position: absolute; border: 5px solid var(--accent); border-radius: 16px;
  box-shadow: 0 0 46px rgba(212,173,252,.55); }
.chips { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 40px; }
.chip { border: 2px solid var(--line); background: rgba(12,19,79,.7); border-radius: 999px;
  padding: 14px 28px; font-size: 30px; font-weight: 600; }
.list { margin-top: 48px; display: flex; flex-direction: column; gap: 22px; }
.item { display: flex; gap: 28px; align-items: flex-start; background: rgba(12,19,79,.78);
  border: 2px solid var(--line); border-radius: 24px; padding: 28px 34px; }
.item .n { flex: none; width: 58px; height: 58px; border-radius: 16px; background: var(--accent); color: var(--accent-ink);
  font-weight: 800; font-size: 30px; display: grid; place-items: center; }
.item b { display: block; font-size: 36px; margin-bottom: 6px; }
.item span { color: var(--muted); font-size: 28px; line-height: 1.35; }
.btn { display: inline-flex; align-items: center; gap: 18px; background: var(--accent); color: var(--accent-ink);
  font-weight: 700; font-size: 40px; padding: 30px 52px; border-radius: 22px; margin-top: 56px; align-self: flex-start; }
.big { font-family: "SF Mono", Menlo, monospace; font-weight: 700; letter-spacing: -.02em; }
`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=block" />`;

function footer(ctx) {
  const dots =
    ctx.total > 1
      ? `<div class="dots">${Array.from({ length: ctx.total }, (_, i) => `<i class="${i === ctx.index ? "on" : ""}"></i>`).join("")}</div>`
      : `<span>liratek.shop</span>`;
  return `<div class="footer"><img src="${asset("brand/liratek-logo.png")}" />${dots}</div>`;
}

// A screenshot cropped to [x, y, w, h] (1920×1080 source pixels), scaled to `width`.
// `ring` is an optional [x, y, w, h] in the same source pixels to highlight.
function shot(s, width) {
  const [x, y, w, h] = s.crop;
  const k = width / w;
  const ring = s.ring
    ? `<div class="ring" style="left:${(s.ring[0] - x) * k - 10}px;top:${(s.ring[1] - y) * k - 10}px;width:${s.ring[2] * k + 20}px;height:${s.ring[3] * k + 20}px"></div>`
    : "";
  return `<div class="shot" style="width:${width}px;height:${Math.round(h * k)}px;${s.style || ""}">
    <img src="${asset("shots/" + s.file)}" style="width:${1920 * k}px;left:${-x * k}px;top:${-y * k}px" />${ring}</div>`;
}

const subAr = (s) => (s.sub_ar ? `<p class="sub-ar ar">${esc(s.sub_ar)}</p>` : "");
const titleCls = (s) => (s.title_size ? ` class="${s.title_size}"` : "");

const TEMPLATES = {
  hero: (s) => `
    <div class="page">
      ${s.eyebrow ? `<div class="eyebrow">${esc(s.eyebrow)}</div>` : ""}
      <h1${titleCls(s)}>${rich(s.title)}</h1>
      ${s.body ? `<p class="body">${rich(s.body)}</p>` : ""}
      ${s.chips ? `<div class="chips">${s.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>` : ""}
      ${subAr(s)}
    </div>`,

  shot: (s) => `
    <div class="page">
      ${s.eyebrow ? `<div class="eyebrow">${esc(s.eyebrow)}</div>` : ""}
      <h1 class="${s.title_size || "sm"}">${rich(s.title)}</h1>
      ${s.body ? `<p class="body" style="font-size:32px;margin-top:22px">${rich(s.body)}</p>` : ""}
      <div style="margin-top:48px">${shot(s.shot, 904)}</div>
      ${subAr(s)}
    </div>`,

  list: (s) => `
    <div class="page">
      ${s.eyebrow ? `<div class="eyebrow">${esc(s.eyebrow)}</div>` : ""}
      <h1 class="${s.title_size || "md"}">${rich(s.title)}</h1>
      <div class="list">${s.items
        .map((it, i) => `<div class="item"><div class="n">${i + 1}</div><div><b>${esc(it.t)}</b><span>${esc(it.d)}</span></div></div>`)
        .join("")}</div>
    </div>`,

  numbers: (s) => `
    <div class="page" style="justify-content:center;padding-bottom:140px">
      ${s.eyebrow ? `<div class="eyebrow">${esc(s.eyebrow)}</div>` : ""}
      ${s.lines
        .map(
          (l) =>
            `<div class="big" style="font-size:${l.size || 110}px;color:${l.color || "var(--text)"};line-height:1.15">${esc(l.text)}</div>${
              l.label ? `<div style="color:var(--muted);font-size:30px;margin:4px 0 30px">${esc(l.label)}</div>` : ""
            }`,
        )
        .join("")}
      <h1 class="sm" style="margin-top:40px">${rich(s.title)}</h1>
      ${subAr(s)}
    </div>`,

  cta: (s) => `
    <div class="page" style="justify-content:center;padding-bottom:140px">
      <img src="${asset("brand/logo.png")}" style="width:150px;height:150px;border-radius:34px;margin-bottom:56px" />
      <h1${titleCls(s)}>${rich(s.title)}</h1>
      ${s.body ? `<p class="body">${rich(s.body)}</p>` : ""}
      <div class="btn">${esc(s.button || "Talk to us on WhatsApp")}</div>
      <p class="body" style="font-size:32px">+961 81 077 357 · liratek.shop</p>
      ${subAr(s)}
    </div>`,

  phone: (s) => `
    <div class="page" style="flex-direction:row;gap:56px;align-items:center;padding-bottom:140px">
      <div style="flex:1">
        ${s.eyebrow ? `<div class="eyebrow">${esc(s.eyebrow)}</div>` : ""}
        <h1 class="sm">${rich(s.title)}</h1>
        <p class="body" style="font-size:31px">${rich(s.body)}</p>
        ${subAr(s)}
        ${s.note ? `<p style="color:var(--muted);font-size:24px;margin-top:30px;opacity:.85">${esc(s.note)}</p>` : ""}
      </div>
      <div style="flex:none;width:380px;height:780px;border-radius:56px;border:10px solid #1a2258;background:var(--bg-2);
        box-shadow:0 50px 120px -30px #000;padding:46px 22px 22px;display:flex;flex-direction:column;gap:14px;position:relative">
        <div style="position:absolute;top:16px;left:50%;transform:translateX(-50%);width:110px;height:26px;border-radius:14px;background:#000"></div>
        <div style="font-weight:700;font-size:24px;margin:10px 6px 6px">LiraTek mobile</div>
        ${(s.rows || [])
          .map(
            (r) =>
              `<div style="background:var(--card);border:2px solid var(--line);border-radius:18px;padding:16px 18px;font-size:20px">
                <div style="color:var(--muted);font-size:17px">${esc(r.k)}</div><div style="font-weight:700;margin-top:4px">${esc(r.v)}</div></div>`,
          )
          .join("")}
        <div style="margin-top:auto;display:flex;justify-content:space-around;color:var(--muted);font-size:16px;border-top:2px solid var(--line);padding-top:14px">
          ${["Home", "Sell", "Debts", "Activity", "Settings"].map((t, i) => `<span style="${i === 1 ? "color:var(--accent);font-weight:700" : ""}">${t}</span>`).join("")}
        </div>
      </div>
    </div>`,
};

export function slideHtml(slide, ctx) {
  const size = SIZES[ctx.size || "feed"];
  const tpl = TEMPLATES[slide.template];
  if (!tpl) throw new Error(`Unknown template "${slide.template}"`);
  return `<!doctype html><html><head><meta charset="utf-8" />${FONTS}
<style>:root{--w:${size.width}px;--h:${size.height}px}${BASE_CSS}</style></head>
<body><div class="grid"></div>${tpl(slide, ctx)}${slide.template === "cta" && ctx.total <= 1 ? "" : footer(ctx)}</body></html>`;
}

export { esc, rich, asset, shot, BASE_CSS, FONTS };
