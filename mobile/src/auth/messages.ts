import { NO_CONNECTION } from "@/api/client";

/** Shop-owner wording for each refusal (contracts/mobile-api.md). Never reveals which shops exist. */
export function signInErrorMessage(code: string): string {
  switch (code) {
    case "INVALID_CREDENTIALS":
      return "Wrong shop address, username or password.";
    case "ADMIN_ONLY":
      return "The LiraTek phone app is for shop owners (admins) only.";
    case "GOOGLE_NOT_CONNECTED":
      return "This Google account is not connected to LiraTek. Connect it in Settings on the web app first.";
    case "MULTIPLE_SHOPS":
      return "This Google account is an admin in more than one shop. Sign in with your shop address instead.";
    case "INVALID_GOOGLE_TOKEN":
      return "Google sign-in failed. Please try again.";
    case NO_CONNECTION:
      return "No connection. Check your internet and try again.";
    default:
      return "Sign-in failed. Please try again.";
  }
}
