# Provider brand assets (Whish, OMT, Katsh, iPick, MTC, Alfa, Binance)

Captured 2026-10-16 from the Whish, OMT Pay, Katsh and i-Pick Android apps on
the test emulator, for use in LiraTek's provider screens.

| File                                            | What                                      | Colour                          |
| ----------------------------------------------- | ----------------------------------------- | ------------------------------- |
| `whish-icon-2048.png`, `whish-icon.svg`         | Round app icon, white W on red            | `#FF0033`                       |
| `whish-logo-red-3000.png`, `whish-logo-red.svg` | W logo, transparent background            | `#FF0A46`                       |
| `whish-logo-white-3000.png`                     | W logo in white, for red/dark backgrounds | `#FFFFFF`                       |
| `omt-icon-2048.png`                             | Round app icon, ring "O" on yellow        | `#FFD800`                       |
| `omt-pay-logo-3716.png`, `omt-pay-logo.svg`     | "OMT \| Pay" pill logo                    | `#FFD800`                       |
| `omt-logo-2119.png`, `omt-logo.svg`             | "OMT" wordmark, dark letters, yellow ring | `#FFD800`                       |
| `katsh-icon-1024.png`                           | Round app icon, lime K on blue            | `#0057B7` / `#97D700`           |
| `katsh-logo-400.png`                            | Lime K, transparent background            | `#97D700`                       |
| `ipick-logo-688.png`                            | i-Pick "iP" rounded-square logo           | gradient `#3DB387` to `#38A4B3` |
| `mtc-touch-logo-300.png`                        | Touch (MTC) logo, as shipped in i-Pick    | `#009CBC`                       |
| `alfa-logo-225.png`                             | Alfa logo, as shipped in i-Pick           | `#E41E2D`                       |
| `binance-icon.svg`, `binance-icon-2048.png`     | Round icon, yellow mark on near-black     | `#F0B90B` / `#0B0E11`           |
| `binance-mark.svg`, `binance-mark-2048.png`     | Yellow mark, transparent background       | `#F0B90B`                       |

How they were made:

- **OMT**: true vector. OMT Pay ships its logo as a Lottie animation
  (`raw/logo_anim`); the SVGs are its final frame with the empty background
  layers removed. The round icon is the vector "O" on a yellow circle (the app
  itself only ships a 432 px icon).
- **Whish**: the app ships no vector logo (largest is the 432 px launcher
  foreground), so the W was traced to a vector from that icon. Very close to,
  but not byte-identical with, Whish's own artwork.
- **Katsh**: from the app's own 1152 px splash logo (Flutter asset); the K is
  about 400 px tall there, so these are raster only. Brand blue `#0057B7`,
  lime `#97D700`.
- **i-Pick** (package `com.eclecticdev.omt`): its own 1024 px launcher logo,
  cropped; the Touch and Alfa logos are the small ones the i-Pick app itself
  uses (raster). The Touch logo is the older "touch" branding of MTC.
- **Binance**: the app was not installed; the mark was measured from its Play
  Store icon and redrawn as exact vector polygons (it is pure geometry). The
  yellow `#F0B90B` is Binance's published brand yellow as remembered, not
  sampled (the store icon is a gradient around `#F7C210`) — verify against
  Binance's brand page if the exact shade matters.
- Colour classes for every provider live in
  `frontend/src/shared/brand/providerBrands.ts`.
- Whish uses two reds: `#FF0033` on the launcher icon, `#FF0A46` inside the
  app. LiraTek's Whish App accent is already `#FF0A46`.

These are the providers' trademarks, used only to label their services in the
shop's own POS.
