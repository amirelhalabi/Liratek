/**
 * The shared email frame (LIRA-267, T023; research R7).
 *
 * Email clients ignore <style> blocks and modern layout, so this is the
 * conservative recipe: nested tables, a fixed 600px content width, inline
 * CSS only, system fonts. Colours are LiraTek's (frontend/src/index.css):
 * Porcelain page, white card, Cosmic Navy header, Signal Blue accent.
 *
 * The header is a TEXT wordmark, not an image: frontend/public holds no
 * logo file (only favicon.png, an emoji-style money icon, not the brand),
 * and a text mark also renders when a client blocks remote images.
 *
 * These functions only assemble the template string. Any {{var}} inside the
 * body passes through untouched and is filled (and escaped) by
 * renderTemplate at send time.
 */

export const EMAIL_COLORS = {
  page: "#F8F7F4",
  card: "#FFFFFF",
  header: "#0C134F",
  accent: "#0057FF",
  accentText: "#FFFFFF",
  wordmarkTail: "#D4ADFC",
  text: "#292823",
  muted: "#77746B",
  border: "#E4E2DB",
} as const;

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export interface LayoutParts {
  /** Hidden preview line shown by inbox lists next to the subject. */
  preheader: string;
  /** The card's inner HTML. */
  bodyHtml: string;
}

/** A primary call-to-action button (bulletproof table button). */
export function emailButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr>
    <td align="center" bgcolor="${EMAIL_COLORS.accent}" style="border-radius:8px;">
      <a href="${href}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:600;color:${EMAIL_COLORS.accentText};text-decoration:none;border-radius:8px;">${label}</a>
    </td>
  </tr>
</table>`;
}

export function renderLayout({ preheader, bodyHtml }: LayoutParts): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>LiraTek</title>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_COLORS.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_COLORS.page}" style="background-color:${EMAIL_COLORS.page};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:${EMAIL_COLORS.card};border:1px solid ${EMAIL_COLORS.border};border-radius:12px;">
        <tr>
          <td bgcolor="${EMAIL_COLORS.header}" style="padding:20px 32px;background-color:${EMAIL_COLORS.header};border-radius:12px 12px 0 0;font-family:${FONT};font-size:24px;font-weight:700;letter-spacing:0.5px;color:#FFFFFF;">Lira<span style="color:${EMAIL_COLORS.wordmarkTail};">Tek</span></td>
        </tr>
        <tr>
          <td style="padding:32px;font-family:${FONT};font-size:16px;line-height:1.5;color:${EMAIL_COLORS.text};">
${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 24px;border-top:1px solid ${EMAIL_COLORS.border};font-family:${FONT};font-size:12px;line-height:1.5;color:${EMAIL_COLORS.muted};">
            LiraTek &middot; point of sale for phone and electronics shops
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** The plain-text frame: body, then the same footer line. */
export function renderTextLayout(body: string): string {
  return `${body.trim()}\n\n--\nLiraTek - point of sale for phone and electronics shops\n`;
}
