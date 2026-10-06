# Public Landing Page on `liratek.shop`

> **Status**: in progress. Phase 1 (site in `landing/`) and Phase 3a (Playwright video,
> `yarn workspace @liratek/frontend demo:record`) built and checked locally 2026-10-07,
> not deployed. Remaining: Vercel project + Phase 2 domain switch (owner), Phase 3b
> (`/brag`, needs install), Phase 4 DNS + Search Console (owner). `robots.txt` and
> `sitemap.xml` exist.
> **Written**: 2026-10-07, after the owner asked for `liratek.shop` to open a
> landing page (with a product video) instead of going straight to login.
> **Money**: no. **Touches login**: only by moving the bare domain — see §6.
> Related: `docs/DEPLOYMENT.md` § 8 (realm matrix), `OPEN_PUBLIC_SIGNUP_PLAN.md`.

---

## 1. Goal

A visitor who types `liratek.shop` sees what LiraTek is, watches a short demo,
and has one obvious next step. Shops and the super admin keep logging in exactly
where they do today.

**Non-goals**: changing the login page, the realm rules, the backend, or the
SPA. No new admin page — the super admin keeps using `www.liratek.shop/login`
(decided by the owner 2026-10-07: "I don't want a separate page for superadmin").

## 2. What is true today (checked 2026-10-07)

| Fact | Source |
| --- | --- |
| `liratek.shop` (bare) answers **308 → `www.liratek.shop`**, sent by Vercel (`server: Vercel`). `vercel.json` has no redirects, so it is a **Vercel domain setting** | live `curl -sI`; `DEPLOYMENT.md` § 8 |
| Bare and `www` both resolve to a Vercel address (`216.198.79.1`), not a Cloudflare proxy IP — DNS-only | live `dig` |
| **No wildcard DNS**: an unknown shop name does not resolve at all (`Could not resolve host`) | live `curl` on a made-up subdomain |
| Live `signup-status`: `www` → `platformHost: true`; `cornertech` → `shopName: "CornerTech"`; both `enabled: true` | live `curl` |
| `www.liratek.shop` is the **platform realm**: super admins only; a shop admin is refused with the generic error | `DEPLOYMENT.md` § 8; `frontend/src/features/auth/pages/Login.tsx:29` |
| Shops log in at `<slug>.liratek.shop` | `DEPLOYMENT.md` § 8 |
| One `Login` page serves every host; a super admin lands on `/admin/tenants` | `Login.tsx:75` |
| Sign-up exists at `/signup` but is **invite-code only**: `enabled` means "an invite code is set", and `POST /signup` rejects a wrong `inviteCode` | `backend/src/api/auth.ts:623`, `:689` |
| Latest GitHub release is **v1.30.5** (2026-09-04), Windows `.exe` only, while the app is at **1.33.0** | `gh release list`; `package.json` |
| The GitHub repo is **public** | `gh repo view` |
| What's New screenshots exist for reuse: `frontend/public/whats-new/1.33.0/` (3 images) | `ls` |
| Opening sign-up to the public is its own unbuilt plan (Turnstile, `pending` status, verified email) | `OPEN_PUBLIC_SIGNUP_PLAN.md` |
| The DNS zone is on Cloudflare; Vercel records are DNS-only | `DEPLOYMENT.md` § 4b/4c |
| The SPA is one Vercel project; `vercel.json` (repo root) builds the `frontend/` service and rewrites `/api` to Fly | `vercel.json` |

**Consequence for the design**: a public "Sign up" button would lead to a form
that asks for an invite code the visitor does not have. Until
`OPEN_PUBLIC_SIGNUP_PLAN` ships, the main call to action must be **contact**
(WhatsApp), not sign-up.

**Consequence for the desktop download (D5)**: a "latest release" link today
gives v1.30.5, three minor versions behind, and Windows only. Either publish a
current release first or leave the link out.

## 3. Target layout

| Host | Serves | Changes? |
| --- | --- | --- |
| `liratek.shop` | **New** static landing site (separate Vercel project) | yes |
| `www.liratek.shop` | SPA — super admin login, `/signup` | no |
| `<slug>.liratek.shop` | SPA — that shop | no |
| `api.liratek.shop` | Fly backend | no |

Why a separate static site, not a route inside the SPA:

- **Link previews.** WhatsApp/Facebook read the raw HTML and do not run
  JavaScript. A static page carries its own title, description and preview
  image; the SPA's `index.html` is shared by every shop and cannot.
- **Isolation.** The landing site makes no API calls, so it cannot affect
  realm resolution, `X-Forwarded-Host`, CORS or any shop's login.
- **Speed.** Plain HTML loads instantly on a phone; the SPA bundle does not.

## 4. Owner decisions (answered 2026-10-07)

| # | Question | Decision |
| --- | --- | --- |
| D1 | Languages | **Arabic + English**, with a toggle. Arabic uses a right-to-left layout |
| D2 | Main call to action while sign-up is invite-only | **WhatsApp chat** to **81077357**, i.e. `https://wa.me/96181077357` (Lebanon +961), with a prefilled message |
| D3 | Prices on the page? | **No — "contact us for pricing"** |
| D4 | Sign-up link? | **Small secondary link**: "Have an invite code? Sign up" → `https://www.liratek.shop/#/signup` (the app uses hash routes) |
| D5 | Desktop download link? | **Left out for now.** Add it once a current release (1.33.x) is published |
| D6 | Video source | **Make both** — one Playwright recording (Phase 3a) and one with `/brag` (Phase 3b); the owner picks one |
| D7 | Super admin access | **Bookmark only.** Nothing on the landing page points to `https://www.liratek.shop/#/login` |

## 5. Phases

Each phase has its own pass condition. Phases 1, 3a and 3b can run in parallel.

### Phase 1 — Static landing site

- New folder `landing/` at the repo root: `index.html`, `styles.css`, a small
  `main.js`, `assets/` (screenshots, poster image, video). No build step, no
  framework, not a yarn workspace.
- Content, top to bottom:
  1. One-line promise + WhatsApp button (D2).
  2. Demo video: muted, autoplay, loops, `playsinline`, poster image shown while
     loading.
  3. Three or four feature blocks with screenshots (reuse the What's New
     images in `frontend/public/whats-new/`).
  4. "Log in to your shop": a text box for the shop name and a button that
     navigates to `https://<name>.liratek.shop/login`. It only trims and
     lowercases the input. It does **not** copy the slug regex or the reserved
     list (`packages/core/src/utils/tenantSlug.ts` owns those — rule 14).
     Because there is no wildcard DNS, a wrong name would show the browser's
     own "site can't be reached" error. So before navigating, the page probes
     the address (e.g. a `no-cors` fetch of `https://<name>.liratek.shop/favicon.png`);
     if that fails, it shows "Shop not found — check the name" instead.
     Untested: confirm the probe tells a missing host from an existing one in
     Chrome and Safari before relying on it.
  5. Sign-up link (D4) and footer. No desktop download (D5), no staff login link (D7).
  - Built without screenshots on the feature cards (text only); the demo video carries the visuals.
  - Old bare-domain app links (`liratek.shop/#/…`, `/login`, `/signup`) are forwarded to `www`
    by `main.js` and `landing/vercel.json`, because the 308 that used to carry them goes away in Phase 2.
- `<head>`: title, description, Open Graph + Twitter preview tags, favicon.
- New Vercel project, root directory `landing/`, framework "Other", no build
  command.
  - Likely, not verified: Vercel can skip a project's build when nothing under
    its root directory changed. If so, enable it, so app pushes do not
    redeploy the landing site.

**Pass**: the project's preview URL renders on a phone and a desktop. A
WhatsApp link preview shows the title, description and image. Typing an existing
shop name opens that shop's login page.

### Phase 2 — Move the bare domain

1. In the SPA's Vercel project, Settings → Domains: remove `liratek.shop`
   (today it is set to redirect to `www`). That is where the 308 comes from (§2).
2. Attach `liratek.shop` to the landing project in Vercel. Do **not** touch the
   `www` domain or any `<slug>` domain on the SPA project.
3. Confirm the Cloudflare record for the bare domain still points at Vercel and
   is still DNS-only.

**Pass** — run all of these after the switch:

- `curl -sI https://liratek.shop` → `200` from the landing project, no redirect.
- `curl -s https://www.liratek.shop/api/auth/signup-status` → `platformHost: true`.
- `curl -s https://<a real slug>.liratek.shop/api/auth/signup-status` → that shop's `shopName`.
- Log in as a shop admin on its subdomain, and as the super admin on `www` — both succeed.
- `https://liratek.shop/#/login` and `https://liratek.shop/login` both end on the `www` login page.
- `node scripts/deploy-api.mjs --verify-only` still passes (it checks that
  `X-Forwarded-Host` survives Vercel → Fly).

**Known catch**: a 308 is permanent, so browsers that already visited
`liratek.shop` may keep jumping to `www` from their cache. Clearing the browser
cache fixes it. Expected to affect few people today.

### Phase 3a — Demo video, Playwright recording

- A dedicated spec, e.g. `frontend/tests/demo/record-demo.spec.ts`, with its
  own config. It must **not** be inside `tests/e2e-web` or `tests/e2e-electron`
  (the `testDir`s of `playwright.web.config.ts` / `playwright.electron.config.ts`),
  or every e2e run, CI included, would record the demo too.
- Runs against the local web stack with seeded demo data — never a real shop's
  database, because the video is public.
- Scripted story, 30–60 seconds: a sale, a money transfer, a debt payment,
  closing the day.
- Captions are shown on the page itself during recording (a fixed overlay
  injected with `page.evaluate`). They are part of the recording, so every
  re-recording keeps them.
- Record at 1280×720 (`video: { mode: "on", size: … }`). Playwright writes
  `.webm`; convert to H.264 `.mp4` with `ffmpeg` for Safari/iPhone, and export
  one frame as the poster image.
- Target under ~5 MB. Over that, host on YouTube and embed.

**Pass**: one command produces `demo.mp4` + `poster.jpg`. The file plays on an
iPhone and in desktop Chrome. No real customer names or numbers appear in it.

### Phase 3b — Demo video, `/brag`

- `/brag` is not installed in this environment, and what it produces is not
  verified. First step: install it, read what it takes as input, and confirm it
  can produce a file the page can host (MP4).
- Feed it the same story and captions as Phase 3a, so the two videos can be
  compared fairly.
- Same rules as 3a: demo data only, under ~5 MB, MP4 + poster image.

**Pass**: a second `demo.mp4` + `poster.jpg` exists. The owner watches both
and picks one; the page ships with only the chosen video.

### Phase 4 — Search and email hygiene

- `landing/robots.txt` and `landing/sitemap.xml` (one URL). Register the
  domain in Google Search Console and submit the sitemap.
- DNS (Cloudflare), only if the backend still sends no email: SPF
  `v=spf1 -all` and `_dmarc` `v=DMARC1; p=reject`. This stops anyone sending
  email that pretends to be from `liratek.shop`. Re-check for a mail library
  before adding them.
  - The `SUBSCRIPTION_MANAGEMENT_PLAN` will need email later. When it lands,
    replace these records with real SPF/DKIM for that sender.

**Pass**: Search Console shows the sitemap as read. An online SPF/DMARC checker
reports both records valid.

## 6. Risks

| Risk | Guard |
| --- | --- |
| The domain switch breaks shop or super-admin login (highest cost) | Only the bare domain moves; Phase 2 pass list re-checks both logins and `X-Forwarded-Host` |
| Visitor clicks "Sign up" and meets an invite-code wall | D2/D4: contact is the main action until public sign-up ships |
| Shop owner types a wrong shop name | No wildcard DNS, so the browser would fail to connect; the existence probe in Phase 1 shows "Shop not found" instead |
| Demo video leaks real data | Recorded only from seeded demo data (Phase 3) |
| Cached 308 sends old visitors to `www` | Accepted; few visitors today |

## 7. Release note (rule 30)

Under `## 🌐 Web app` in `docs/release-notes/UNRELEASED.md`, when Phase 2 ships:

> liratek.shop now opens an information page about LiraTek. Shops keep logging
> in at their own address, as before.
