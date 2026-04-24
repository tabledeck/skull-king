import { redirect } from "react-router";
import type { Route } from "./+types/login";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { useState } from "react";
import { signIn } from "~/lib/auth-client";
import { BtnPrimary } from "~/components/tabledeck/BtnPrimary";

export function meta() {
  return [{ title: "Login — Skull King" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  if (user) throw redirect("/");
  return null;
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        setError("Invalid email or password.");
      } else {
        window.location.href = "/";
      }
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div className="td-table min-h-screen flex flex-col items-center justify-center p-4">
      {/* Wordmark */}
      <div className="mb-8 text-center">
        <h1
          className="font-serif font-semibold"
          style={{ fontSize: "36px", fontStyle: "italic", color: "var(--gold-hi)", textShadow: "0 1px 0 rgba(0,0,0,0.5)" }}
        >
          Skull King
        </h1>
        <p
          className="font-serif mt-1"
          style={{ fontVariant: "small-caps", letterSpacing: "0.22em", fontSize: "12px", color: "var(--parchment)", opacity: 0.55 }}
        >
          Sign in to track your conquests
        </p>
      </div>

      <div className="td-auth-card">
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label className="td-input-label">Email</label>
            <input
              type="email"
              placeholder="captain@sea.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="td-input"
            />
          </div>
          <div>
            <label className="td-input-label">Password</label>
            <input
              type="password"
              placeholder="••••••••"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="td-input"
            />
          </div>
          {error && (
            <p className="font-sans text-sm text-center" style={{ color: "var(--copper)" }}>
              {error}
            </p>
          )}
          <BtnPrimary type="submit" disabled={loading} fullWidth>
            {loading ? "Signing in…" : "Sign In"}
          </BtnPrimary>
          <p className="font-sans text-sm text-center" style={{ color: "var(--ink-soft)" }}>
            No account?{" "}
            <a href="/signup" className="underline" style={{ color: "var(--gold-lo)" }}>
              Sign up
            </a>
          </p>
          <a
            href="/"
            className="font-sans text-sm text-center"
            style={{ color: "var(--ink-faint)" }}
          >
            Play as guest instead
          </a>
        </form>
      </div>
    </div>
  );
}
