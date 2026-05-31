import React, { useState } from "react";
import logger from "@/utils/logger";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { AlertCircle } from "lucide-react";
import clsx from "clsx";
import { useShopName } from "@/hooks/useShopName";
import PasswordInput from "@/shared/components/PasswordInput";
import { TextInput } from "@liratek/ui";
import { useTheme } from "@/contexts/ThemeContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const shopName = useShopName();
  const { theme } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await login(username, password, rememberMe);
      // If login is successful, redirect to dashboard
      if (result.success) {
        navigate("/");
      } else {
        setError(result.error || "Login failed");
      }
    } catch (err) {
      setError("An unexpected error occurred");
      logger.error("Login failed", { error: err });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={clsx(
      "min-h-screen flex items-center justify-center p-4 relative overflow-hidden transition-colors",
      theme === "dark"
        ? "bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950"
        : "bg-gradient-to-br from-gray-50 via-gray-50 to-gray-100"
    )}>
      {/* Subtle background pattern */}
      <div className={clsx("absolute inset-0", theme === "dark" ? "opacity-10" : "opacity-5")}>
        <div className={clsx("absolute top-0 left-1/4 w-72 h-72 rounded-full mix-blend-multiply filter blur-3xl", theme === "dark" ? "bg-violet-600" : "bg-violet-400")}></div>
        <div className={clsx("absolute -bottom-8 right-1/4 w-72 h-72 rounded-full mix-blend-multiply filter blur-3xl", theme === "dark" ? "bg-indigo-600" : "bg-indigo-400")}></div>
      </div>

      <div className={clsx(
        "relative rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transition-colors backdrop-blur-xl",
        theme === "dark"
          ? "bg-slate-800/80 border border-slate-700/50"
          : "bg-white/80 border border-gray-200/50"
      )}>
        {/* Header */}
        <div className={clsx(
          "bg-gradient-to-r p-10 text-center relative overflow-hidden",
          theme === "dark"
            ? "from-violet-600 to-indigo-600"
            : "from-violet-500 to-indigo-500"
        )}>
          {/* Decorative gradient overlay */}
          <div className="absolute inset-0 opacity-20 bg-gradient-to-b from-white to-transparent"></div>

          <div className="relative z-10">
            <h1 className="text-4xl font-bold text-white whitespace-nowrap mb-2">
              {shopName}
            </h1>
            <p className="font-medium text-white">
              Management System
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="p-8 relative z-10">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className={clsx(
                "p-4 rounded-lg flex items-start gap-3 text-sm animate-in fade-in border",
                theme === "dark"
                  ? "bg-red-500/15 border-red-500/40 text-red-300"
                  : "bg-red-500/10 border-red-500/30 text-red-600"
              )}>
                <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="pt-2">
              <TextInput
                value={username}
                onChange={setUsername}
                label="Username"
                placeholder="Enter username"
                icon="user"
                required
              />
            </div>

            <div>
              <PasswordInput
                value={password}
                onChange={setPassword}
                label="Password"
                placeholder="••••••••"
              />
            </div>

            <div className="flex items-center pt-2">
              <div className="relative flex items-center">
                <input
                  id="remember-me"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="peer w-5 h-5 bg-slate-700 border-2 border-slate-600 rounded cursor-pointer accent-violet-500 hover:border-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-slate-800 transition-colors"
                />
              </div>
              <label
                htmlFor="remember-me"
                className="ml-3 text-sm text-slate-300 cursor-pointer select-none"
              >
                Remember me for 1 day
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={clsx(
                "w-full py-3 px-4 rounded-lg text-white font-semibold transition-all duration-200 mt-6",
                loading
                  ? "bg-slate-600 cursor-not-allowed opacity-70"
                  : "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-[0.98] shadow-lg shadow-violet-600/30 hover:shadow-lg hover:shadow-violet-600/50",
              )}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  Signing in...
                </span>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          <div className={clsx(
            "mt-8 pt-6 text-center text-xs",
            theme === "dark"
              ? "border-t border-slate-700/50 text-slate-400"
              : "border-t border-gray-300/50 text-gray-600"
          )}>
            <p>
              <span className={theme === "dark" ? "text-slate-500" : "text-gray-500"}>Version</span> {__APP_VERSION__} <span className={clsx("mx-2", theme === "dark" ? "text-slate-600" : "text-gray-400")}>•</span> <span className={theme === "dark" ? "text-slate-300" : "text-gray-700"}>Licensed to</span> <span className={theme === "dark" ? "text-slate-300" : "text-gray-800 font-medium"}>{shopName}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
