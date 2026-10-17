/**
 * LIRA-306 — "Pair this PC" (desktop, never-paired; O-new-8). An admin of
 * the shop signs in here once; the server issues this PC's own key (stored
 * encrypted on the PC) and the app restarts on the standby screen. From then
 * on the shop works in the web app and this PC keeps a copy for outages.
 *
 * Desktop-only by nature (E1): the web adapter answers "Available on the
 * desktop app". ONE payload, typed from the core schema (rules 21/22).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@liratek/ui";
import type { DesktopPairInput } from "@liratek/core";

const input =
  "w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500";

export function PairThisPcCard() {
  const api = useApi();
  const { t } = useTranslation("offline");
  const [shop, setShop] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const ready = shop.trim() && username.trim() && password && deviceName.trim();

  async function submit() {
    setBusy(true);
    setError(null);
    const payload: DesktopPairInput = {
      shop: shop.trim(),
      username: username.trim(),
      password,
      deviceName: deviceName.trim(),
    };
    try {
      const r = await api.pairThisPc(payload);
      if (r.success && r.data) {
        setDone(
          t("pair.done", {
            deviceNo: r.data.deviceNo,
            shopName: r.data.shopName,
          }),
        );
        setPassword("");
      } else {
        setError(r.error ?? t("pair.failed"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg space-y-3 rounded-xl border border-slate-700/50 bg-slate-800 p-4">
      <h3 className="text-lg font-semibold text-white">
        {t("pair.title")}
      </h3>
      <p className="text-sm text-slate-400">
        {t("pair.intro")}
      </p>
      <label className="block text-xs text-slate-400">
        {t("pair.shop")}
        <input
          className={input}
          value={shop}
          onChange={(e) => setShop(e.target.value)}
        />
      </label>
      <label className="block text-xs text-slate-400">
        {t("pair.username")}
        <input
          className={input}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      <label className="block text-xs text-slate-400">
        {t("pair.password")}
        <input
          className={input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label className="block text-xs text-slate-400">
        {t("pair.deviceName")}
        <input
          className={input}
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={busy || !ready}
        onClick={() => void submit()}
        className="w-full rounded-lg bg-violet-600 py-2 font-semibold text-white hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500"
      >
        {busy ? t("pair.pairing") : t("pair.submit")}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="text-sm text-emerald-400">
          {done}
        </p>
      ) : null}
    </div>
  );
}

export default PairThisPcCard;
