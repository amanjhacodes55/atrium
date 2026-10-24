"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Grip, LogOut, Moon, Sun, UserRound } from "lucide-react";
import { auth } from "@/lib/client";
import type { PublicUser, Usage } from "@/lib/types";
import { APPS, AppTile, Logo } from "./app-icon";
import { ToastProvider, useDismiss } from "./ui";

type Session = { user: PublicUser | null; usage: Usage | null; refresh: () => void };
const SessionCtx = createContext<Session>({ user: null, usage: null, refresh: () => {} });
export const useSession = () => useContext(SessionCtx);

export function Workspace({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ user: PublicUser | null; usage: Usage | null }>({ user: null, usage: null });
  const refresh = useCallback(() => {
    auth
      .me()
      .then((r) => setState({ user: r.user, usage: r.usage }))
      .catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);
  return (
    <SessionCtx.Provider value={{ ...state, refresh }}>
      <ToastProvider>{children}</ToastProvider>
    </SessionCtx.Provider>
  );
}

export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    // Read the theme the inline head script already applied.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("atrium-theme", next);
    } catch {}
    setTheme(next);
  };
  return { theme, toggle };
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"} title="Toggle theme">
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

/** The 3x3 grid button that jumps between apps. */
export function Launcher() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  return (
    <div ref={ref} className="relative">
      <button type="button" className="icon-btn" aria-label="Apps" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Grip size={20} />
      </button>
      {open && (
        <div className="menu left-0 top-full mt-1 grid w-72 grid-cols-3 gap-1 p-3">
          {APPS.map((a) => (
            <Link key={a.kind} href={a.href} onClick={close} className="flex flex-col items-center gap-1.5 rounded-lg p-2.5 text-xs font-medium hover:bg-hover">
              <AppTile kind={a.kind} size={38} />
              {a.name}
            </Link>
          ))}
          <Link href="/home" onClick={close} className="flex flex-col items-center gap-1.5 rounded-lg p-2.5 text-xs font-medium hover:bg-hover">
            <Logo size={38} />
            Home
          </Link>
        </div>
      )}
    </div>
  );
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function AccountMenu() {
  const { user } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  if (!user) return <span className="h-8 w-8" />;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
        style={{ background: user.guest ? "#64748b" : "linear-gradient(135deg,#2563eb,#7c3aed)" }}
      >
        {initials(user.name)}
      </button>
      {open && (
        <div className="menu right-0 top-full mt-1 w-64">
          <div className="px-2.5 py-2">
            <div className="text-sm font-semibold">{user.name}</div>
            <div className="truncate text-xs text-muted">{user.guest ? "Guest workspace" : user.email}</div>
          </div>
          {user.guest && (
            <Link href="/signup" onClick={close} className="mx-1 mb-1 block rounded-lg bg-accent px-3 py-2 text-center text-sm font-medium text-white">
              Sign up to keep your files
            </Link>
          )}
          <div className="menu-sep" />
          <Link href="/account" onClick={close} className="menu-item">
            <UserRound size={16} /> Account settings
          </Link>
          <button
            type="button"
            className="menu-item"
            onClick={async () => {
              await auth.logout().catch(() => {});
              router.push("/");
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Top bar for the home, drive and app list pages. */
export function TopBar({ title, color, children }: { title: string; color?: string; children?: ReactNode }) {
  return (
    <header className="no-print sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-line bg-surface px-3">
      <Launcher />
      <Link href="/home" className="flex items-center gap-2 pr-2">
        <Logo size={26} />
        <span className="text-[15px] font-semibold" style={color ? { color } : undefined}>
          {title}
        </span>
      </Link>
      <div className="flex min-w-0 flex-1 justify-center">{children}</div>
      <ThemeToggle />
      <AccountMenu />
    </header>
  );
}
