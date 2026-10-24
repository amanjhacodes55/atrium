"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Slide } from "@/lib/types";
import { H, SlideView, W } from "./render";

function useWindowScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return scale;
}

/** Full-screen slideshow: arrows, space, PageUp/PageDown or clicks to move; Escape to leave. */
export function Slideshow({ slides, start = 0, onClose }: { slides: Slide[]; start?: number; onClose: () => void }) {
  const [i, setI] = useState(Math.min(start, slides.length - 1));
  const [notes, setNotes] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const scale = useWindowScale();
  const go = (d: number) => setI((n) => Math.max(0, Math.min(slides.length - 1, n + d)));
  // Callers pass inline callbacks; read the latest through a ref so effects run once.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  const close = () => closeRef.current();

  useEffect(() => {
    const el = ref.current;
    el?.requestFullscreen?.().catch(() => {});
    const onFs = () => {
      if (!document.fullscreenElement) closeRef.current();
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n"].includes(e.key)) go(1);
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p"].includes(e.key)) go(-1);
      else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(slides.length - 1);
      else if (e.key === "s") setNotes((v) => !v);
      else if (e.key === "Escape") closeRef.current();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  const slide = slides[i];
  if (!slide) return null;
  return createPortal(
    <div ref={ref} className="group fixed inset-0 z-[300] flex items-center justify-center bg-black" onClick={() => go(1)}>
      <SlideView slide={slide} scale={scale} />
      <div
        className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-sm text-white opacity-0 transition group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" aria-label="Previous slide" className="rounded-full p-1 hover:bg-white/20" onClick={() => go(-1)}>
          <ChevronLeft size={18} />
        </button>
        <span className="tabular-nums">
          {i + 1} / {slides.length}
        </span>
        <button type="button" aria-label="Next slide" className="rounded-full p-1 hover:bg-white/20" onClick={() => go(1)}>
          <ChevronRight size={18} />
        </button>
        <button type="button" className="rounded-full px-2 py-0.5 text-xs hover:bg-white/20" onClick={() => setNotes((v) => !v)}>
          Notes (S)
        </button>
        <button type="button" aria-label="End slideshow" className="rounded-full p-1 hover:bg-white/20" onClick={close}>
          <X size={18} />
        </button>
      </div>
      {notes && slide.notes && (
        <div className="absolute right-4 top-4 max-w-sm whitespace-pre-wrap rounded-xl bg-black/75 p-4 text-sm leading-relaxed text-white" onClick={(e) => e.stopPropagation()}>
          {slide.notes}
        </div>
      )}
    </div>,
    document.body,
  );
}
