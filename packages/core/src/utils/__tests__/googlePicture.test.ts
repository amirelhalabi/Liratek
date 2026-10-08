/**
 * LIRA-294 — only Google's own image host may become an account photo
 * (it ends up in an <img src>, and the CSP allows exactly this host).
 */

import { safeGooglePictureUrl } from "../googlePicture.js";

describe("safeGooglePictureUrl", () => {
  it.each([
    "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c",
    "https://lh4.googleusercontent.com/-abc/photo.jpg",
    "https://LH3.GoogleUserContent.com/a/x",
  ])("accepts %s", (url) => {
    expect(safeGooglePictureUrl(url)).not.toBeNull();
  });

  it.each([
    ["plain http", "http://lh3.googleusercontent.com/a/x"],
    ["another host", "https://evil.example.com/a.png"],
    ["a look-alike host", "https://lh3.googleusercontent.com.evil.com/a"],
    ["a suffix without a dot", "https://evilgoogleusercontent.com/a"],
    ["the bare domain", "https://googleusercontent.com/a"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:image/png;base64,AAAA"],
    ["credentials", "https://user:pw@lh3.googleusercontent.com/a"],
    ["a port", "https://lh3.googleusercontent.com:8443/a"],
    ["not a URL", "not a url"],
    ["empty", ""],
    ["too long", `https://lh3.googleusercontent.com/${"a".repeat(3000)}`],
  ])("rejects %s", (_label, url) => {
    expect(safeGooglePictureUrl(url)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(safeGooglePictureUrl(undefined)).toBeNull();
    expect(safeGooglePictureUrl(null)).toBeNull();
    expect(safeGooglePictureUrl(42)).toBeNull();
  });
});
