/**
 * LIRA-294 — the account picture: the user's Google profile photo in a
 * circle, or the person icon when there is none or it fails to load. Used by
 * the top bar (the My account link, the SAME size as the icon it replaces)
 * and, larger, by My account → Profile. Web only in practice: desktop users
 * have no Google link, so they always get the icon.
 *
 * `referrerPolicy="no-referrer"`: Google's image host may refuse hot-linked
 * requests that carry a referrer, and the shop's address has no business
 * reaching Google with every page view. The URL itself is only ever an https
 * URL on *.googleusercontent.com (core `safeGooglePictureUrl`, and the CSP's
 * img-src allows exactly that host).
 */

import { useState } from "react";
import { UserCircle } from "lucide-react";

export interface AccountAvatarProps {
  url: string | null | undefined;
  /** Pixel size of the circle (and of the fallback icon). */
  size: number;
  alt?: string;
  className?: string;
}

export default function AccountAvatar({
  url,
  size,
  alt = "My account",
  className = "",
}: AccountAvatarProps) {
  // The URL that failed to load: a NEW url gets its own chance.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!url || failedUrl === url) {
    return <UserCircle size={size} aria-hidden="true" className={className} />;
  }
  return (
    <img
      src={url}
      alt={alt}
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(url)}
      data-testid="account-avatar"
      className={`rounded-full object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
