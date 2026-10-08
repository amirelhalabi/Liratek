/**
 * "This email already has a LiraTek shop." + "Sign in instead →" (LIRA-290,
 * owner decision 2026-10-08: one shop per owner email, shown on the page
 * instead of emailing a sign-up link). One component for every place a
 * sign-up can learn it — the emailed-link request, the Google landing page
 * (`error=email_has_shop`) and the Google sign-up form — so the wording and
 * the link cannot drift. The message comes from core (rule 14); pages
 * decide to show it by the CODE, never by message text.
 *
 * Every page that shows it lives on www (a shop's address redirects sign-up
 * there), so `/login` is the www sign-in page.
 */

import { Link } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import { EMAIL_ALREADY_HAS_SHOP_MESSAGE } from "@liratek/core";

export default function EmailHasShopNotice({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      role="alert"
      data-testid="signup-email-has-shop"
      className={
        "flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500 " +
        (className ?? "")
      }
    >
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>
        {EMAIL_ALREADY_HAS_SHOP_MESSAGE}{" "}
        <Link
          to="/login"
          className="font-semibold text-orange-500 hover:text-orange-400 whitespace-nowrap"
        >
          Sign in instead →
        </Link>
      </span>
    </div>
  );
}
