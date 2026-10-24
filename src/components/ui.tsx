"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Closes on outside click or Escape. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

export type MenuEntry = { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; hint?: string } | "sep";

/** A button that opens a dropdown of actions. */
export function Dropdown({
  trigger,
  items,
  align = "left",
  className = "",
  label,
}: {
  trigger: ReactNode;
  items: MenuEntry[];
  align?: "left" | "right";
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} className={className} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div role="menu" className={`menu top-full mt-1 ${align === "right" ? "right-0" : "left-0"}`}>
          {items.map((it, i) =>
            it === "sep" ? (
              <div key={i} className="menu-sep" />
            ) : (
              <button
                key={i}
                role="menuitem"
                type="button"
                className="menu-item"
                style={it.danger ? { color: "var(--danger)" } : undefined}
                onClick={() => {
                  close();
                  it.onClick();
                }}
              >
                {it.icon}
                <span className="flex-1">{it.label}</span>
                {it.hint && <span className="text-xs text-muted">{it.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function Modal({ title, onClose, children, width = 440 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal aria-label={title} className="card w-full p-5 shadow-xl" style={{ maxWidth: width, boxShadow: "var(--shadow)" }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A small "type a name" dialog. */
export function PromptDialog({
  title,
  initial = "",
  confirm = "Save",
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: string;
  confirm?: string;
  onSubmit: (value: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!value.trim()) return;
          setBusy(true);
          try {
            await onSubmit(value.trim());
            onClose();
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <input className="input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} maxLength={200} />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !value.trim()}>
            {confirm}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---- Toasts ----

type Toast = { id: number; text: string; tone: "info" | "error" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-5 left-1/2 z-[200] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg"
            style={{ background: t.tone === "error" ? "#b91c1c" : "#1f2937" }}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted" role="status">
      <span className="mr-3 inline-block h-5 w-5 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label}…
    </div>
  );
}
