"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TopBar, useSession } from "@/components/shell";
import { Modal, Spinner, useToast } from "@/components/ui";
import { api, formatBytes } from "@/lib/client";

export default function AccountPage() {
  const { user, usage, refresh } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  if (!user)
    return (
      <div className="flex min-h-screen flex-col">
        <TopBar title="Account" />
        <Spinner />
      </div>
    );

  const save = (json: object, done: string) => async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await api("/api/auth/account", { method: "PATCH", json });
      toast(done);
      form.reset();
      refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar title="Account" />
      <main className="mx-auto w-full max-w-xl flex-1 space-y-6 px-4 py-10">
        <h1 className="text-2xl font-semibold">Account settings</h1>
        {user.guest && (
          <div className="card border-accent p-5">
            <p className="text-sm">
              You are using a <b>guest workspace</b>. Sign up to keep your files and sign in from other devices.
            </p>
            <button type="button" className="btn btn-primary mt-3" onClick={() => router.push("/signup")}>
              Sign up
            </button>
          </div>
        )}
        <section className="card p-5">
          <h2 className="font-medium">Profile</h2>
          <p className="mt-1 text-sm text-muted">{user.guest ? "Guest" : user.email}</p>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              const name = new FormData(e.currentTarget).get("name");
              return save({ name }, "Name updated")(e);
            }}
          >
            <input className="input" name="name" defaultValue={user.name} maxLength={80} aria-label="Name" required />
            <button className="btn btn-primary">Save</button>
          </form>
        </section>
        {usage && (
          <section className="card p-5">
            <h2 className="font-medium">Storage</h2>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(1, (usage.used / usage.quota) * 100)}%` }} />
            </div>
            <p className="mt-2 text-sm text-muted">
              {formatBytes(usage.used)} of {formatBytes(usage.quota)} used
            </p>
          </section>
        )}
        {!user.guest && (
          <section className="card p-5">
            <h2 className="font-medium">Change password</h2>
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                const f = new FormData(e.currentTarget);
                return save({ current: f.get("current"), password: f.get("password") }, "Password changed")(e);
              }}
            >
              <input className="input" name="current" type="password" placeholder="Current password" autoComplete="current-password" required />
              <input className="input" name="password" type="password" placeholder="New password (8+ characters)" autoComplete="new-password" minLength={8} required />
              <button className="btn btn-primary">Change password</button>
            </form>
          </section>
        )}
        <section className="card p-5">
          <h2 className="font-medium" style={{ color: "var(--danger)" }}>
            Delete account
          </h2>
          <p className="mt-1 text-sm text-muted">Deletes your account and every file in your drive. This cannot be undone.</p>
          <button type="button" className="btn mt-3" style={{ color: "var(--danger)" }} onClick={() => setConfirming(true)}>
            Delete my account
          </button>
        </section>
      </main>
      {confirming && (
        <Modal title="Delete your account?" onClose={() => setConfirming(false)}>
          <p className="text-sm">All your documents, spreadsheets, presentations, notebooks and files will be deleted forever.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              style={{ background: "var(--danger)", color: "#fff", borderColor: "var(--danger)" }}
              onClick={async () => {
                await api("/api/auth/account", { method: "DELETE" });
                router.push("/");
              }}
            >
              Delete forever
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
