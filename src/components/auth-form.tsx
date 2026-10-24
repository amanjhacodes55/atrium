"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { api, ApiError } from "@/lib/client";
import { Logo } from "./app-icon";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2.5">
        <Logo size={36} />
        <span className="text-xl font-semibold">Atrium</span>
      </Link>
      <div className="card w-full max-w-sm p-7" style={{ boxShadow: "var(--shadow)" }}>
        {children}
      </div>
    </main>
  );
}

function useNext() {
  const next = useSearchParams().get("next");
  // Only same-site paths, so the sign-in page cannot be used to bounce people elsewhere.
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/home";
}

function Field({ label, error, ...props }: { label: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input className="input" aria-invalid={Boolean(error)} {...props} />
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}

export function GuestButton({ className = "btn w-full", children }: { className?: string; children?: ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api("/api/auth/guest", { method: "POST" });
            router.push("/home");
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {children ?? (
          <>
            <Sparkles size={16} /> {busy ? "Setting up…" : "Try it without an account"}
          </>
        )}
      </button>
      {error && <p className="mt-2 text-center text-xs text-danger">{error}</p>}
    </>
  );
}

function useForm() {
  const [errors, setErrors] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErrors(null);
    try {
      await fn();
    } catch (e) {
      setErrors({ field: e instanceof ApiError ? e.field : undefined, message: (e as Error).message });
      setBusy(false);
    }
  };
  const fieldError = (f: string) => (errors?.field === f ? errors.message : undefined);
  const formError = errors && !["email", "password", "name"].includes(errors.field ?? "") ? errors.message : null;
  return { busy, submit, fieldError, formError };
}

export function LoginForm() {
  const router = useRouter();
  const next = useNext();
  const { busy, submit, fieldError, formError } = useForm();
  return (
    <>
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Welcome back to your workspace.</p>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void submit(async () => {
            await api("/api/auth/login", { method: "POST", json: { email: f.get("email"), password: f.get("password") } });
            router.push(next);
          });
        }}
      >
        <Field label="Email" name="email" type="email" autoComplete="email" required error={fieldError("email")} />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required error={fieldError("password")} />
        {formError && <p className="text-sm text-danger">{formError}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <div className="my-5 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
      <GuestButton />
      <p className="mt-6 text-center text-sm text-muted">
        New here?{" "}
        <Link href={`/signup${next !== "/home" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-accent">
          Create an account
        </Link>
      </p>
    </>
  );
}

export function SignupForm() {
  const router = useRouter();
  const next = useNext();
  const { busy, submit, fieldError, formError } = useForm();
  return (
    <>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <p className="mt-1 text-sm text-muted">Free forever. No credit card, no seat limits.</p>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void submit(async () => {
            await api("/api/auth/signup", { method: "POST", json: { name: f.get("name"), email: f.get("email"), password: f.get("password") } });
            router.push(next);
          });
        }}
      >
        <Field label="Name" name="name" autoComplete="name" required maxLength={80} error={fieldError("name")} />
        <Field label="Email" name="email" type="email" autoComplete="email" required error={fieldError("email")} />
        <Field label="Password" name="password" type="password" autoComplete="new-password" required minLength={8} error={fieldError("password")} />
        {formError && <p className="text-sm text-danger">{formError}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent">
          Sign in
        </Link>
      </p>
    </>
  );
}
