# Contract: Trial screens (web, phone, owner) (LIRA-332)

All text is shop-owner language, in English. The Arabic UI (LIRA-331) is a separate ticket. If it lands first, these strings go through its translation layer.

## WhatsApp activation link (one builder, FR-007)

`buildActivationWhatsAppUrl({ shopName, shopAddress })` in `packages/core/src/utils/activationLink.ts`. It is a pure leaf, exported from `browser.ts` and importable by `mobile/`.

```
https://wa.me/96181077357?text=<encodeURIComponent("Hi LiraTek, I'd like to activate my shop <shopName> (<shopAddress>).")>
```

- The number is the same as `landing/wa.html`'s `NUMBER = "96181077357"`. It is defined once in core as `LIRATEK_WHATSAPP_NUMBER`.
- If `shopName` or `shopAddress` is missing, the builder drops that part rather than printing "undefined".

## Web: `SubscriptionBanner` (MainLayout, every page)

| standing | Renders | testid |
| --- | --- | --- |
| `null`, `active` | nothing (unchanged) | |
| `grace`, `read_only` | today's exact markup and text (unchanged) | `subscription-banner` |
| `trial`, `endsSoon=false` | slim neutral strip: "Free trial: **{daysLeft} days left**" (singular: "1 day left") + button "Contact us to activate" (opens the WhatsApp URL in a new tab) | `trial-strip` |
| `trial`, `daysLeft=1` | amber strip: "**Last day of your free trial** (ends tonight, {lastDay})." + the same button | `trial-strip` |
| `trial`, `endsSoon=true` | amber strip: "Your free trial ends soon: **{daysLeft} days left**, last day {lastDay}." + the same button | `trial-strip` |
| `trial_ended` | red full-width alert: "**Your free trial has ended.** You can still sign in, see and export everything. To keep adding sales and records, contact LiraTek on WhatsApp to activate." + button "Contact LiraTek on WhatsApp" | `trial-ended` |

- **Refresh**: on mount, every 15 minutes (today's `REFRESH_MS`), and immediately on `TRIAL_ENDED_EVENT` (dispatched by `httpClient` when a response has `code === "TRIAL_ENDED"`).
- **Shown to everyone**: all roles see it (spec edge case: staff).
- **Never shown** on the desktop app (its status comes from the local licence row, which has no trial) or to a platform user.
- **Dates**: `lastDay` is shown as given by the server, `YYYY-MM-DD`, the same as the existing banner's date. The client does not reformat it with `toLocaleString` (rule 27).

## Web: refused action

Any page whose write comes back `{ success:false, code:"TRIAL_ENDED" }` shows the server's `error` text in its normal error spot (toast or inline). The banner switches to `trial-ended` because of the event. Nothing fails silently (FR-011).

## Phone: `(app)/_layout.tsx`

- A `TrialStrip` component sits above the tabs. It has the same states and words as the web table above, with the button opening the same URL through `Linking.openURL`.
- **Data**: `GET /api/subscription/status`, on sign-in, on focus, and every 15 minutes.
- **Refused write**: the phone's existing error banner shows the trial text when `error === "TRIAL_ENDED"` (`mobile/src/auth/messages.ts` maps the code).

## Owner: Tenants page and PlanModal

**`PlanCell`** (one line per shop):

- `trial` → "Trial · {daysLeft} days left · ends {lastDay}"
- `trial_ended` → "Trial ended {lastDay}" (red)
- everything else → today's text

The "Created" date comes from `tenant_created_at`.

**PlanModal** gains two separately saved sections, the same pattern as the existing ones:

- **"Activate subscription"**: radio "No end date" / "Paid until [date]", then the button "Activate subscription". Shown when standing is `trial` or `trial_ended`.
- **"Extend trial"**: a date input "New last day of trial", then the button "Extend trial". Shown for `trial`, `trial_ended`, or a no-period active shop. A past date shows the server's refusal inline.
- **"History"**: a list from `GET …/history`, with when, who, what, and before → after.

The existing **Suspend / Activate** row button keeps its text and behaviour. The new buttons never say just "Activate" (FR-016).
