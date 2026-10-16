// Vertical (1080×1920) reel layouts.
import { BASE_CSS, FONTS, asset, esc, rich, shot } from "./templates.mjs";

const head = (extra = "") => `<!doctype html><html><head><meta charset="utf-8" />${FONTS}
<style>:root{--w:1080px;--h:1920px}${BASE_CSS}${extra}</style></head>`;

// Static brand frame for a landscape demo video; `slot` is left empty for ffmpeg to fill.
export function reelFrameHtml(r, slot) {
  return `${head()}<body><div class="grid"></div>
  <div style="position:absolute;left:80px;right:80px;top:200px">
    <div class="eyebrow">${esc(r.eyebrow || "")}</div>
    <h1 class="md">${rich(r.title)}</h1>
    ${r.sub_ar ? `<p class="sub-ar ar">${esc(r.sub_ar)}</p>` : ""}
  </div>
  <div style="position:absolute;left:${slot.x - 4}px;top:${slot.y - 4}px;width:${slot.w + 8}px;height:${slot.h + 8}px;
    border-radius:20px;border:4px solid var(--line);box-shadow:0 60px 140px -40px #000"></div>
  <div style="position:absolute;left:80px;right:80px;top:${slot.y + slot.h + 90}px">
    <p class="body" style="margin:0">${rich(r.body || "")}</p>
    <div class="btn">${esc(r.button || "Talk to us on WhatsApp")}</div>
  </div>
  <div class="footer" style="bottom:110px"><img src="${asset("brand/liratek-logo.png")}" /><span>liratek.shop</span></div>
  </body></html>`;
}

// Timeline of scenes; window.render(t) shows the right one with a short fade.
export function scenesHtml(r) {
  const layers = r.scenes
    .map((s, i) => {
      if (s.kind === "shot") {
        return `<div class="layer" id="s${i}">
          <div style="position:absolute;left:80px;right:80px;top:230px">
            ${s.eyebrow ? `<div class="eyebrow">${esc(s.eyebrow)}</div>` : ""}
            <h1 class="md lift">${rich(s.title)}</h1>
            ${s.sub_ar ? `<p class="sub-ar ar lift">${esc(s.sub_ar)}</p>` : ""}
          </div>
          <div class="zoom" style="position:absolute;left:60px;top:${s.top || 760}px;transform-origin:50% 50%">${shot(s.shot, 960)}</div>
          ${s.caption ? `<p class="body lift" style="position:absolute;left:80px;right:80px;top:${s.caption_top || 1500}px">${rich(s.caption)}</p>` : ""}
        </div>`;
      }
      if (s.kind === "logo") {
        return `<div class="layer" id="s${i}" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 80px">
          <img class="zoom" src="${asset("brand/logo.png")}" style="width:220px;height:220px;border-radius:50px" />
          <img src="${asset("brand/liratek-logo.png")}" style="width:640px;margin-top:70px" />
          <h1 class="sm lift" style="margin-top:70px">${rich(s.title)}</h1>
          ${s.sub_ar ? `<p class="sub-ar ar lift" style="text-align:center">${esc(s.sub_ar)}</p>` : ""}
          ${s.button ? `<div class="btn lift" style="align-self:center">${esc(s.button)}</div>` : ""}
          <p class="body lift" style="font-size:34px">liratek.shop</p>
        </div>`;
      }
      return `<div class="layer" id="s${i}" style="display:flex;flex-direction:column;justify-content:center;padding:0 80px 200px">
        ${s.eyebrow ? `<div class="eyebrow">${esc(s.eyebrow)}</div>` : ""}
        <h1 class="lift" style="font-size:${s.size || 104}px">${rich(s.title)}</h1>
        ${s.sub_ar ? `<p class="sub-ar ar lift" style="font-size:48px">${esc(s.sub_ar)}</p>` : ""}
      </div>`;
    })
    .join("");

  return `${head(`.layer{position:absolute;inset:0;opacity:0}`)}<body><div class="grid"></div>${layers}
  <script>
    const S = ${JSON.stringify(r.scenes.map((s) => [s.t0, s.t1]))};
    const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
    window.render = (t) => {
      S.forEach(([a, b], i) => {
        const el = document.getElementById("s" + i);
        const fade = 0.35;
        const o = t < a || t > b ? 0 : Math.min(1, (t - a) / fade, (b - t) / fade);
        el.style.opacity = o;
        const p = (t - a) / (b - a);
        el.querySelectorAll(".zoom").forEach((z) => (z.style.transform = "scale(" + (1 + 0.06 * ease(p)) + ")"));
        el.querySelectorAll(".lift").forEach((z, k) => {
          const e = ease((t - a - 0.12 * k) / 0.6);
          z.style.transform = "translateY(" + (40 * (1 - e)) + "px)";
          z.style.opacity = e;
        });
      });
    };
    window.render(0);
  </script></body></html>`;
}
