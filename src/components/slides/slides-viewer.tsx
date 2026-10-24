"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import type { SlidesBody } from "@/lib/types";
import { Slideshow } from "./present";
import { SlideView, W } from "./render";

/** Read-only presentation for public share links. */
export function SlidesViewer({ body }: { body: SlidesBody }) {
  const [i, setI] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [scale, setScale] = useState(0.8);
  const stage = useRef<HTMLDivElement>(null);
  const count = body.slides.length;
  const go = (d: number) => setI((n) => Math.max(0, Math.min(count - 1, n + d)));

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1.25, e.contentRect.width / W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (presenting) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") go(1);
      if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenting, count]);

  const slide = body.slides[i];
  if (!slide) return <p className="p-10 text-center text-muted">This presentation has no slides.</p>;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <div ref={stage} className="w-full">
        <div className="overflow-hidden rounded-lg shadow-lg ring-1 ring-black/10">
          <SlideView slide={slide} scale={scale} />
        </div>
      </div>
      <div className="flex items-center justify-center gap-3">
        <button type="button" className="icon-btn" aria-label="Previous slide" onClick={() => go(-1)} disabled={i === 0}>
          <ChevronLeft size={20} />
        </button>
        <span className="text-sm tabular-nums text-ink-2">
          {i + 1} / {count}
        </span>
        <button type="button" className="icon-btn" aria-label="Next slide" onClick={() => go(1)} disabled={i === count - 1}>
          <ChevronRight size={20} />
        </button>
        <button type="button" className="btn btn-primary btn-sm ml-3" onClick={() => setPresenting(true)}>
          <Play size={14} /> Present
        </button>
      </div>
      {slide.notes && <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm text-ink-2">{slide.notes}</p>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {body.slides.map((s, n) => (
          <button
            key={s.id}
            type="button"
            aria-label={`Slide ${n + 1}`}
            onClick={() => setI(n)}
            className={`shrink-0 overflow-hidden rounded-md ring-2 ${n === i ? "ring-accent" : "ring-transparent hover:ring-line"}`}
          >
            <SlideView slide={s} scale={0.16} />
          </button>
        ))}
      </div>
      {presenting && <Slideshow slides={body.slides} start={i} onClose={() => setPresenting(false)} />}
    </div>
  );
}
