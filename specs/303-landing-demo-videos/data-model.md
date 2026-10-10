# Data Model: Landing Page Demo Videos (LIRA-303)

There is no database change. The "data" here is (1) what the owner's test shop must hold so every scene
looks like a believable shop day, and (2) the storyboard the video is built from.

## 1. Demo shop seeding checklist (for the owner)

The same test shop serves the web, desktop and phone videos. Everything is made up.

**Shop**
- Shop name and address that are not a real shop (for example "Cedar Mobile", `cedar` / any test address).
- Exchange rate set (for example 89,000 LBP per dollar) so USD and LBP amounts both look normal.
- Receipt header set to the made-up shop name.

**For the POS scene**
- 8–12 products with photos or clear names: chargers, cables, earbuds, covers, one or two phones.
  Prices in dollars that convert to round-looking LBP amounts.
- One made-up customer to pick at checkout (name + phone that is not real, for example "Rami Haddad",
  `70 000 001`).

**For the OMT / Whish scene**
- OMT and Whish set up as suppliers (they are by default on new web shops).
- A made-up sender and receiver (names and phones).
- A few earlier transfers so the history behind the form is not empty.

**For the Mobile recharge scene**
- An MTC line and an Alfa line with credit on them.
- Recharge items priced (credit amounts and days).

**For the Loto scene**
- Loto set up with ticket prices in LBP.
- A few earlier ticket sales.

**For the desktop scene**
- Nothing extra: it reuses the POS screen.

**For the phone scene**
- The phone app signed in to the same test shop, so Home shows its drawer and wallet balances in light mode.
- The sign-in page in dark mode (signed out).

**Never on screen**
- Real customer names, real phone numbers, a real shop address, a real email, or a real staff name in the top bar.
  The signed-in user should be a made-up name too (for example "Owner").

## 2. Storyboard (entity: Scene)

Each scene has: a time window, an English title with an Arabic line, the real screens it uses, and one on-screen
action. Times are a plan; the build may move them by a few tenths of a second.

| # | Time (s) | Scene | Title (EN / AR) | Screens | On-screen action | Currencies |
|---|---|---|---|---|---|---|
| 1 | 0.0–3.0 | Hook | "Two currencies. One counter." / "عملتان. صندوق واحد." | none | 0.0–0.6 s holds the settled hook frame (= the poster); the amounts in $ and LBP then re-animate in and settle | USD + LBP |
| 2 | 3.0–6.0 | Logo | "LiraTek" + "The POS for Lebanese phone shops" / "برنامج محلات الخليوي في لبنان" | none | Swirl logo + wordmark reveal | — |
| 3 | 6.0–10.0 | POS | "Sell in dollars or lira" / "بِع بالدولار أو بالليرة" | `/pos` cart → checkout | Total in $ with its LBP amount highlighted; "Complete" pressed | USD + LBP |
| 4 | 10.0–14.0 | OMT / Whish | "OMT and Whish, fees worked out" / "OMT وWhish، العمولة محسوبة" | `/services` transfer form | Amount typed, fee appears, total highlighted | USD + LBP |
| 5 | 14.0–18.0 | Recharge | "MTC and Alfa recharges" / "تشريج MTC وAlfa" | `/recharge` | Item picked, price in LBP and $ shown | USD + LBP |
| 6 | 18.0–22.0 | Loto | "Loto, in lira" / "اللوتو، بالليرة" | `/loto` | Ticket sold, LBP total | LBP only |
| 7a | 22.0–24.5 | Desktop: Windows | "Also on your computer" / "أيضاً على الكمبيوتر" | POS screen inside the LiraTek app window on a Windows 11 desktop (wallpaper, centred taskbar with a LiraTek icon) | The screen shrinks from full size into the app window | — |
| 7b | 24.5–27.0 | Desktop: Mac | (same title) | The same POS screen in a browser window on a macOS desktop (menu bar, Dock); the address bar reads `test.liratek.shop` | Cut from Windows to Mac; the browser window settles | — |
| 8 | 27.0–31.0 | Phones | "And on your phone" / "وعلى هاتفك" | Two phones side by side: an iPhone 17 (simulator screenshot) on the **sign-in page in dark mode**, and a drawn Galaxy-Ultra-style Android phone with the **Home tab in light mode** | Phones slide up one after the other | — |
| 9 | 31.0–34.0 | Outro | "liratek.shop" · "Talk to us on WhatsApp" / "تواصل معنا على واتساب" | none | Logo, address and call to action settle; the last 0.5 s fades into the settled hook frame (frame 0) so the loop is seamless | — |

All Arabic titles above are drafts and need native review.

## 3. Output files (entity: Hero media)

See [contracts/landing-hero-media.md](contracts/landing-hero-media.md) for the exact files, sizes and page changes.
