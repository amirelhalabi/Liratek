import React, { useState } from "react";
import logger from "@/utils/logger";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Smartphone, AlertCircle } from "lucide-react";
import clsx from "clsx";
import { useShopName } from "@/hooks/useShopName";
import PasswordInput from "@/shared/components/PasswordInput";
import { TextInput } from "@liratek/ui";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const shopName = useShopName();
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
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-slate-700">
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-600 to-indigo-600 p-8 text-center">
          <div className="mx-auto w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mb-4 backdrop-blur-sm">
            <Smartphone className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">{shopName}</h1>
          <p className="text-violet-200">Management System</p>
        </div>

        {/* Form */}
        <div className="p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-red-500/10 border border-red-500/50 text-red-500 p-3 rounded-lg flex items-center gap-2 text-sm">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <TextInput
              value={username}
              onChange={setUsername}
              label="Username"
              placeholder="Enter username"
              icon="user"
              required
              className="mb-4"
            />

            <div>
              <PasswordInput
                value={password}
                onChange={setPassword}
                label="Password"
                placeholder="••••••••"
                className="mb-4"
              />
            </div>

            <div className="flex items-center">
              <input
                id="remember-me"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 bg-slate-900 border-slate-700 rounded text-violet-600 focus:ring-2 focus:ring-violet-500 focus:ring-offset-0"
              />
              <label
                htmlFor="remember-me"
                className="ml-2 text-sm text-slate-400"
              >
                Remember me for 1 day
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={clsx(
                "w-full py-3 px-4 rounded-lg text-white font-medium transition-all shadow-lg shadow-violet-600/20",
                loading
                  ? "bg-slate-600 cursor-not-allowed"
                  : "bg-violet-600 hover:bg-violet-500 active:scale-[0.98]",
              )}
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <div className="mt-6 text-center text-xs text-slate-500">
            <p>
              Version {__APP_VERSION__} • Licensed to {shopName}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
