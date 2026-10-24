import type { CSSProperties } from "react";
import type { Slide, SlideEl } from "@/lib/types";

// Pure rendering of a slide on its 960x540 canvas, scaled by `scale`. Used for thumbnails, the
// editor canvas, the slideshow and the public viewer, so every view draws slides identically.

export const W = 960;
export const H = 540;

export const FONTS: Record<NonNullable<SlideEl["font"]>, string> = {
  sans: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "var(--font-mono-face), ui-monospace, monospace",
};

/** Themes set the slide background and the colours of new text. */
export const THEMES = [
  { id: "light", name: "Paper", bg: "#ffffff", title: "#1f2937", text: "#374151", accent: "#2563eb" },
  { id: "dark", name: "Midnight", bg: "#0f172a", title: "#f8fafc", text: "#cbd5e1", accent: "#38bdf8" },
  { id: "ocean", name: "Ocean", bg: "#1e3a8a", title: "#ffffff", text: "#bfdbfe", accent: "#fbbf24" },
  { id: "forest", name: "Forest", bg: "#14532d", title: "#f0fdf4", text: "#bbf7d0", accent: "#facc15" },
  { id: "sunset", name: "Sunset", bg: "#fff7ed", title: "#9a3412", text: "#431407", accent: "#ea580c" },
  { id: "lavender", name: "Lavender", bg: "#f5f3ff", title: "#4c1d95", text: "#3b0764", accent: "#7c3aed" },
] as const;

export type Theme = (typeof THEMES)[number];
export const themeOf = (id: string): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0];

export function elementStyle(el: SlideEl): CSSProperties {
  const base: CSSProperties = { position: "absolute", left: el.x, top: el.y, width: el.w, height: el.h, boxSizing: "border-box" };
  if (el.type === "rect" || el.type === "ellipse") {
    return {
      ...base,
      background: el.fill ?? "#cbd5e1",
      borderRadius: el.type === "ellipse" ? "50%" : 6,
      border: el.stroke && el.strokeWidth ? `${el.strokeWidth}px solid ${el.stroke}` : undefined,
    };
  }
  if (el.type === "text") {
    return {
      ...base,
      background: el.fill,
      color: el.color ?? "#1f2937",
      fontSize: el.size ?? 24,
      fontWeight: el.bold ? 700 : 400,
      fontStyle: el.italic ? "italic" : "normal",
      textDecoration: el.underline ? "underline" : "none",
      textAlign: el.align ?? "left",
      fontFamily: FONTS[el.font ?? "sans"],
      lineHeight: 1.25,
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      padding: "4px 8px",
    };
  }
  return base;
}

export function ElementView({ el }: { el: SlideEl }) {
  if (el.type === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={el.src} alt="" draggable={false} style={{ ...elementStyle(el), objectFit: "contain" }} />
    );
  }
  return <div style={elementStyle(el)}>{el.type === "text" ? el.text : null}</div>;
}

export function SlideView({ slide, scale = 1, hide }: { slide: Slide; scale?: number; hide?: string }) {
  return (
    <div style={{ width: W * scale, height: H * scale, overflow: "hidden", position: "relative", background: slide.bg }}>
      <div style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "0 0", position: "absolute", left: 0, top: 0 }}>
        {slide.els.map((el) => (el.id === hide ? null : <ElementView key={el.id} el={el} />))}
      </div>
    </div>
  );
}
