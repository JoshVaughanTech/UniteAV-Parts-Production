"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { btnPrimary, btnGhost, input } from "@/components/ui";

const DEMO = [
  { role: "Admin", email: "admin@unite.local" },
  { role: "Manager", email: "manager@unite.local" },
  { role: "Operator", email: "operator@unite.local" },
  { role: "Viewer", email: "viewer@unite.local" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@unite.local");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) setError("Invalid email or password.");
    else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-lg font-bold text-white">
            U
          </div>
          <h1 className="text-lg font-semibold text-ink">Unite AV — Parts &amp; Production</h1>
          <p className="mt-1 text-sm text-muted">Sign in to continue</p>
        </div>

        <form onSubmit={submit} className="space-y-3 rounded-xl border bg-surface p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Email</label>
            <input className={input} value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Password</label>
            <input
              className={input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </div>
          {error && <p className="text-sm text-critical">{error}</p>}
          <button className={`${btnPrimary} w-full`} disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-4 rounded-xl border bg-surface p-3">
          <p className="mb-2 text-xs text-muted">Demo accounts (password: password123)</p>
          <div className="grid grid-cols-2 gap-1.5">
            {DEMO.map((d) => (
              <button
                key={d.email}
                type="button"
                onClick={() => {
                  setEmail(d.email);
                  setPassword("password123");
                }}
                className={`${btnGhost} justify-start text-xs`}
              >
                {d.role}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
