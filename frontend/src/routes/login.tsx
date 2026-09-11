import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Boxes, Eye, EyeOff, Loader2, Lock, User } from "lucide-react";

const API_BASE = "http://127.0.0.1:8000";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "LEX — Sign In" },
      { name: "description", content: "Sign in to the LEX Sovereign AI Workbench" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Authentication failed (HTTP ${res.status})`);
      }

      const data = await res.json();
      localStorage.setItem("lex_token", data.access_token);
      localStorage.setItem("lex_user", JSON.stringify(data.user));
      navigate({ to: "/" });
    } catch (err: any) {
      setError(err.message || "Connection failed — is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      {/* Background nebula effect */}
      <div className="galaxy-nebula pointer-events-none fixed inset-0 -z-10" aria-hidden="true" />
      <div className="galaxy-vignette pointer-events-none fixed inset-0 -z-10" aria-hidden="true" />

      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-muted shadow-lg">
            <Boxes className="h-7 w-7 text-primary" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">LEX</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sovereign AI Workbench</p>
        </div>

        {/* Login Card */}
        <form onSubmit={submit} className="panel space-y-5 p-6">
          <div>
            <h2 className="text-base font-semibold text-foreground">Sign in</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              All credentials are verified locally — no external auth services.
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label htmlFor="login-username" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Username
              </label>
              <div className="relative">
                <User className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  id="login-username"
                  type="text"
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full rounded-md border border-input bg-background py-2 pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
            <div>
              <label htmlFor="login-password" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  id="login-password"
                  type={showPwd ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-md border border-input bg-background py-2 pl-8 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPwd ? "Hide password" : "Show password"}
                >
                  {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !username.trim() || !password.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {loading ? (
              <>
                <Loader2 className="spin-slow h-4 w-4" aria-hidden="true" />
                Authenticating…
              </>
            ) : (
              "Sign in"
            )}
          </button>

          <div className="space-y-1 border-t border-border pt-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Demo credentials</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setUsername("admin"); setPassword("admin123"); }}
                className="rounded border border-border bg-background/50 px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-accent"
              >
                <span className="font-semibold text-foreground">admin</span>
                <span className="ml-1 text-muted-foreground">/ admin123</span>
              </button>
              <button
                type="button"
                onClick={() => { setUsername("operator"); setPassword("operator123"); }}
                className="rounded border border-border bg-background/50 px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-accent"
              >
                <span className="font-semibold text-foreground">operator</span>
                <span className="ml-1 text-muted-foreground">/ operator123</span>
              </button>
            </div>
          </div>
        </form>

        <p className="mt-4 text-center text-[10px] text-muted-foreground">
          All data stays on-premise · Zero external connections · JWT signed locally
        </p>
      </div>
    </div>
  );
}
