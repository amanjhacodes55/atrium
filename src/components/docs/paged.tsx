"use client";

import { useEffect, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { RichContent } from "@/components/rich/editor";
import type { DocBody } from "@/lib/types";
import { REPAGINATE, type PageGeometry } from "./pagination";

export type PageSettings = NonNullable<DocBody["page"]>;
export const DEFAULT_PAGE: PageSettings = { size: "a4", margins: "normal" };

// Screen sizes at 96 dpi: A4 is 210 x 297 mm, Letter 8.5 x 11 in.
const SIZE = { a4: { w: 794, h: 1123 }, letter: { w: 816, h: 1056 } };
const MARGINS = {
  normal: { top: 96, right: 96, bottom: 96, left: 96 },
  narrow: { top: 48, right: 48, bottom: 48, left: 48 },
  wide: { top: 96, right: 192, bottom: 96, left: 192 },
};
/** Grey space between two sheets. */
const GAP = 20;

export function pageGeometry(page: PageSettings): PageGeometry & { width: number; left: number; right: number } {
  const m = MARGINS[page.margins] ?? MARGINS.normal;
  const s = SIZE[page.size] ?? SIZE.a4;
  return { width: s.w, height: s.h, top: m.top, bottom: m.bottom, left: m.left, right: m.right, gap: GAP };
}

/** Tells the pagination plugin to measure again (after the page size or margins change). */
export function repaginate(editor: Editor | null) {
  editor?.view.dom.dispatchEvent(new Event(REPAGINATE));
}

/**
 * The document as a stack of paper sheets: the sheets are drawn behind one continuous editor, and
 * the pagination plugin keeps every block inside a sheet. `pages` comes from the plugin's onPages.
 */
export function PagedSurface({ editor, page, pages, overlay, onBackgroundClick }: { editor: Editor | null; page: PageSettings; pages: number; overlay?: ReactNode; onBackgroundClick?: () => void }) {
  const g = pageGeometry(page);
  const pitch = g.height + g.gap;
  const count = Math.max(1, pages);
  // Page sizes change the line width, so measure again once the new width has been laid out.
  useEffect(() => {
    repaginate(editor);
  }, [editor, g.width, g.left, g.right, g.top, g.bottom, g.height]);
  return (
    <div className="paged relative mx-auto" style={{ width: g.width, ["--page-top" as string]: `${g.top}px`, ["--page-right" as string]: `${g.right}px`, ["--page-bottom" as string]: `${g.bottom}px`, ["--page-left" as string]: `${g.left}px` }}>
      <div aria-hidden className="page-sheets">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="page-sheet" style={{ top: i * pitch, height: g.height }}>
            <span className="page-number">{i + 1}</span>
          </div>
        ))}
      </div>
      <div
        className="page-flow relative"
        style={{ padding: `${g.top}px ${g.right}px 0 ${g.left}px`, minHeight: count * pitch - g.gap }}
        onMouseDown={(e) => {
          // Clicking the paper around the text puts the caret in the document, like a real editor.
          const t = e.target as HTMLElement;
          if (onBackgroundClick && (t === e.currentTarget || t.classList.contains("page-gap"))) {
            e.preventDefault();
            onBackgroundClick();
          }
        }}
      >
        <RichContent editor={editor} />
      </div>
      {overlay}
    </div>
  );
}
