import { redirect } from "react-router";
import type { Route } from "./+types/signup";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { useState } from "react";
import { signUp } from "~/lib/auth-client";
import { BtnPrimary } from "~/components/tabledeck/BtnPrimary";

export function meta() {
  return [{ title: "Sign Up — Skull King" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  if (user) throw redirect("/");
  return null;
}

export default function Signup() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signUp.email({ name, email, password });
      if (result.error) {
        setError(result.error.message ?? "Sign up failed.");
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
          Create an account to save your pillages
        </p>
      </div>

      <div className="td-auth-card">
        <form onSubmit={handleSignup} className="flex flex-col gap-4">
          <div>
            <label className="td-input-label">Pirate name</label>
            <input
              type="text"
              placeholder="Captain Redbeard"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="td-input"
            />
          </div>
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
            <label className="td-input-label">Password (min 8 chars)</label>
            <input
              type="password"
              placeholder="••••••••"
              required
              minLength={8}
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
            {loading ? "Creating account…" : "Create Account"}
          </BtnPrimary>
          <p className="font-sans text-sm text-center" style={{ color: "var(--ink-soft)" }}>
            Already have an account?{" "}
            <a href="/login" className="underline" style={{ color: "var(--gold-lo)" }}>
              Sign in
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
