# Feature Specification: Landing Page Demo Videos

**Feature Branch**: `303-landing-demo-videos` (work happens on `main`; no branch)

**Created**: 2026-10-10

**Status**: Draft

**Ticket**: LIRA-303 (`current_sprint.md`)

**Input**: User description: "Replace the marketing site's hero video (landing/assets/demo.mp4 and its poster), which still shows the old green brand, with a new demo of the LiraTek web app in the new brand. The same web screens also showcase the desktop app, shown inside a desktop window frame, because desktop and web share one interface. A phone app demo video comes later, as a separate deliverable. All on-screen data comes from a demo shop with made-up customers, products and amounts. Show only features that are built and live. Built later with /brag, reusing the earlier video's working files. Must stay light for the landing page, keep the sound toggle, the poster as first paint, and the reduce-motion behaviour. Owner decides scenes, length, music and whether desktop is a separate video or a scene in the same one."

## Context

- The landing page (English `/` and Arabic `/ar`) shows one hero video and its poster image. Both still show the old look: a green logo tile, green "liratek.shop" text, a green button and green-tinted screens. The rest of the page already uses the new brand.
- The earlier video was made with `/brag`: 21 seconds, 1920×1080, 30 frames per second, 2.2 MB, with music and a sound on/off button. Its storyboard: a hook ("Two currencies. One counter."), the logo, three product scenes (checkout, an OMT send with its fee, drawer balances), and an outro with the WhatsApp call to action. Its titles carry an Arabic line under the English one, so one video serves both pages.
- Desktop and web use the same screens. This Mac cannot run the desktop app (owner rule), so desktop is shown with web screens inside a desktop window frame.
- Some features (warranty, drawer counts with "sales since the last count") are live on the web app today but reach the desktop app only in its next update.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A visitor sees the web app in the new brand (Priority: P1)

A phone-shop owner opens liratek.shop. The first thing they see is a poster in the new colours. The video then plays without sound and shows real LiraTek screens doing the jobs their shop does every day: a sale at the till, an OMT or Whish transfer, a mobile recharge and a Loto ticket, in dollars and lira. They can turn the sound on with the button.

**Why this priority**: the hero video is the first and largest thing on the page. While it shows the old green look, the page contradicts its own brand.

**Independent Test**: open `/` and `/ar` on a desktop browser and on a phone. Check the poster and every frame of the video for the new colours and logo, for made-up data only, and for features that are live.

**Acceptance Scenarios**:

1. **Given** a visitor on a slow connection, **When** the page loads, **Then** the new-brand poster shows before the video starts, in the same spot the video takes.
2. **Given** the video is playing without sound, **When** the visitor presses the sound button, **Then** the video restarts from the beginning with music, and the button shows sound on.
3. **Given** a visitor whose device asks for reduced motion, **When** the page loads, **Then** only the poster shows and the video does not play by itself.
4. **Given** any frame of the video, **When** checked against the brand, **Then** it shows no old logo and no green brand accent. Green that belongs to the product's own screens (for example a module colour on the Dashboard) is allowed.
5. **Given** an Arabic visitor on `/ar`, **When** the video plays, **Then** every title they see has an Arabic line, as in the earlier video.

---

### User Story 2 - A visitor understands there is a desktop app too (Priority: P2)

The visitor sees that LiraTek also runs as a desktop app in the shop, with the same screens as the web app.

**Why this priority**: most current customers use the desktop app; the page says "on your computer or in the browser" but never shows the computer.

**Independent Test**: watch the desktop part on its own. A shop owner can tell it is the desktop app. Every feature it shows is in the desktop app the owner can install today.

**Acceptance Scenarios**:

1. **Given** the desktop part, **When** a visitor watches it, **Then** the screens sit inside a desktop window frame and a title says this is the desktop app.
2. **Given** a feature that the desktop app does not have yet, **When** the desktop part is made, **Then** that feature does not appear inside the desktop window frame.

---

### User Story 3 - A visitor sees the phone app too (Priority: P3)

The hero video ends its tour with the phone app on two phones (FR-008a). A fuller phone-app demo for the phone section of the landing page still follows later, from real phone screens.

**Why this priority**: it depends on the phone changes in progress. The phone scene in this video is short; the separate phone video is not built in this feature.

**Independent Test**: not part of this delivery. The plan names it as a follow-up and fixes the shared style (colours, fonts, music, title format) so the phone video matches.

**Acceptance Scenarios**:

1. **Given** the web and desktop video is done, **When** the phone video is planned, **Then** it reuses the same title style, colours and music family.

---

### Edge Cases

- A screen in the demo shop shows a real person's name, phone number, shop address or email: the shot is retaken. Real customer data never goes into the video.
- A feature is live on the web app but not yet in a desktop release: it may appear in the web part, never inside the desktop window frame.
- The video file is too heavy for the landing page: lower the quality or the length until it fits the size budget; never ship a heavier file.
- The browser cannot play the video or blocks autoplay: the poster stays on screen and the page still reads correctly.
- The video or the poster changes but the browser holds the old copy in its cache: the page asks for the new version (the cache-busting number goes up on the poster and the video together).
- A visitor turns the sound on: the soundtrack sits at about −16 LUFS integrated with peaks at or below −1 dBTP (a common level for web video), and there is no voice-over to translate.

## Requirements *(mandatory)*

### Functional Requirements

**Brand and content**

- **FR-001**: The new video and poster MUST use only the new brand: the violet swirl logo, pastel violet and signal blue on dark navy, and no green brand accents.
- **FR-002**: Every product screen in the video MUST be a real LiraTek screen, taken from a demo shop. No mocked-up screens and no edited numbers.
- **FR-003**: All on-screen names, phone numbers, products, amounts and shop details MUST be made up. Real customer or shop data MUST NOT appear in any frame.
- **FR-004**: The video MUST show only features that are built and live on the app it is shown in.
- **FR-005**: The video MUST have exactly 4 product scenes, in this order (owner decision 2026-10-10):
  1. **POS**: a sale at the till.
  2. **OMT / Whish services**: a transfer on the Services page, fee worked out.
  3. **Mobile recharge**: an MTC or Alfa recharge on the Recharge page.
  4. **Loto**: a ticket sale on the Loto page.
- **FR-005a**: In the POS, OMT / Whish and Mobile recharge scenes, both currencies (USD and LBP) MUST show briefly on screen, for example a total in dollars with its lira amount. The Loto scene MUST show LBP only, as the Loto page does.
- **FR-006**: There MUST be two videos, one per language (owner decision 2026-10-10): the English page shows an English-only video, the Arabic page an Arabic-only video. No frame mixes the two languages in titles (product screens and drawn OS chrome stay as they are).
- **FR-007**: The video MUST end on the call to action used on the page: "Talk to us on WhatsApp", with liratek.shop.

**Desktop**

- **FR-008**: The computer scene MUST show the same screens on two desktops, one after the other, under the title "Also on your computer" and its Arabic line (owner decision 2026-10-10): first the LiraTek **desktop app** window on a Windows 11 desktop with its taskbar (about 2.5 s), then the **web app in a browser** window on a macOS desktop with its menu bar and Dock (about 2.5 s). There is no Mac desktop app (the desktop app is built for Windows only), so the Mac part MUST show a browser, never a native app window.
- **FR-008a**: A phone scene of about 4 seconds MUST follow, titled "And on your phone" and its Arabic line: two phones side by side, an iPhone 17 on the phone app's sign-in page in dark mode, and an Android phone in the style of a Galaxy Ultra (drawn, not an emulator) on the Home tab in light mode. Both screens MUST be real phone-app screens from the test shop. Drawn devices carry no maker logos.
- **FR-009**: Inside the Windows app window, only features in the current desktop release may appear.

**Landing page behaviour**

- **FR-010**: The poster MUST be the first thing shown in the video's place, and MUST be frame 0 of the video: the settled hook frame ("Two currencies. One counter." with its amounts). The last frames of the outro MUST fade into that same frame, so neither the poster-to-video switch nor the loop shows a jump.
- **FR-011**: The video MUST start muted and loop. The sound button MUST keep working as it does today (restart with sound, label in the page's language).
- **FR-012**: With reduced motion asked for, only the poster MUST show.
- **FR-013**: The video file MUST stay within the size budget (see SC-003), and the poster MUST stay light.
- **FR-014**: Replacing the files MUST bump the cache-busting number on the poster and on the video, on both pages.

**Demo data**

- **FR-015**: The screens MUST be taken from a demo shop seeded with made-up data that makes every chosen scene look like a busy, believable shop day. It MUST be the same seeded test shop the owner is preparing for the phone screenshots (owner decision 2026-10-10), so the web, desktop and phone videos show the same customers and products. Screen capture waits until the owner says the seeding is done.

**Follow-up**

- **FR-016**: The plan MUST name the phone app demo video as a follow-up, with the shared style it will reuse. Making the phone video is out of scope here.

### Key Entities

- **Demo shop**: a LiraTek shop holding only made-up customers, products, suppliers, drawers and transactions, used only for screenshots and videos.
- **Scene**: one part of the video: a title (English with Arabic line), one or more real screens, and an on-screen action (a number typed, a button pressed, a total appearing).
- **Video and poster**: the landing page's hero media; the poster is a still image shown first and on its own under reduced motion.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a frame-by-frame check (one frame every half second), no frame and not the poster shows the old logo or a green brand accent.
- **SC-002**: In the same check, no frame shows a real person's name, phone number or shop. The owner signs this off before the video ships.
- **SC-003**: The video file is no larger than 3 MB and the poster no larger than 25 KB (earlier: 2.2 MB and 15 KB).
- **SC-004**: On a phone-width screen (375 px) over a slow mobile connection (Slow 4G), the poster appears no more than 100 ms later than today's poster (median of 3 loads), on `/` and on `/ar`.
- **SC-005**: A shop owner who watches the video once can name at least 3 of the 4 jobs it shows (selling, OMT/Whish transfers, recharges, Loto).
- **SC-006**: Every feature shown can be found and used in the live web app (and, inside the desktop frame, in the current desktop release) on the day the video ships.

## Assumptions

- The video is made with `/brag`, reusing the earlier composition, render script and music from `brag-output/` (git-ignored, on this Mac only).
- The format stays as before: landscape 1920×1080, 30 frames per second, music with no voice-over.
- Length is about 34 seconds: hook 3 s, logo 3 s, 4 product scenes of about 4 s each, the computer scene 5 s (Windows, then Mac), the phone scene 4 s, outro 3 s. The size budget (SC-003) still applies.
- One video serves both pages; there is no separate Arabic video.
- The web app runs locally against the demo shop for the screenshots. The desktop app is not launched on this Mac.
- The music keeps the earlier style (soft and calm, in the same key family) unless the owner asks for a change.
- The landing page copy, the Modules menu and the phone section are done separately; this feature changes only the hero media and its cache-busting numbers.
- Pushing to `main` deploys the landing page together with everything else on `main`; shipping is the owner's call.
