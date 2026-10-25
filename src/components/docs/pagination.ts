import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

// Splits a document into pages the way a word processor does. The editor stays one ProseMirror
// view; this plugin measures the layout and inserts invisible spacers so nothing runs past a page's
// bottom margin: before a block that has to start on the next page, between the lines of a
// paragraph, or between the items of a list. The page sheets themselves are drawn behind the text
// by the component (see paged.tsx), one per page this plugin reports.
//
// Layout is simulated from each block's natural height and margins (with any spacers already
// inside it taken back out), so the spacers on screen never feed into the next measurement. A block
// that can't be split and is taller than a page (a long table, a big image) starts on a fresh page
// and runs on; text after it picks up on the next page boundary.

export type PageGeometry = { height: number; top: number; bottom: number; gap: number };
/** `inner`: a spacer inside a paragraph or list rather than between top-level blocks. */
type Break = { pos: number; height: number; page: number; inner: boolean };
type State = { breaks: Break[]; deco: DecorationSet };
/** A place a block can be split: `at` is the distance from the block's top, `pos` where the spacer goes. */
type Cut = { at: number; pos: () => number | null };

export const paginationKey = new PluginKey<State>("pagination");
export const REPAGINATE = "atrium:repaginate";

function decorations(state: EditorState, breaks: Break[]) {
  return DecorationSet.create(
    state.doc,
    breaks.map((b) =>
      Decoration.widget(
        b.pos,
        () => {
          // Inside a paragraph the spacer is a block-level span, which ends one line and starts the next.
          const el = document.createElement(b.inner ? "span" : "div");
          el.className = b.inner ? "page-split" : "page-gap";
          el.contentEditable = "false";
          el.dataset.page = String(b.page + 1);
          el.style.cssText = `display:block;height:${b.height}px;margin:0`;
          return el;
        },
        { side: -1, key: `gap-${b.pos}-${b.page}-${b.height.toFixed(1)}`, ignoreSelection: true },
      ),
    ),
  );
}

const same = (a: Break[], b: Break[]) => a.length === b.length && a.every((x, i) => x.pos === b[i].pos && Math.abs(x.height - b[i].height) < 0.5);

/** Text nodes that are part of the document (not a widget such as someone's caret label). */
function textNodes(el: HTMLElement): Text[] {
  const out: Text[] = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n.nodeValue && !n.parentElement?.closest('[contenteditable="false"]')) out.push(n as Text);
  }
  return out;
}

/**
 * Where a paragraph or list can be split, in its natural layout (as if no spacers were inside it).
 * `toNatural` maps a screen offset from the block's top to that natural offset.
 */
function cuts(view: EditorView, node: PMNode, offset: number, dom: HTMLElement, toNatural: (y: number) => number): Cut[] {
  const top = dom.getBoundingClientRect().top;
  if (node.type.name === "paragraph") {
    // Group the text's line fragments into lines, then cut between each pair of lines.
    const lines: { top: number; bottom: number }[] = [];
    const range = document.createRange();
    for (const t of textNodes(dom)) {
      range.selectNodeContents(t);
      for (const r of range.getClientRects()) {
        if (!r.height) continue;
        const a = toNatural(r.top - top);
        const b = a + r.height;
        const line = lines.find((l) => a < l.bottom - 1 && b > l.top + 1);
        if (line) {
          line.top = Math.min(line.top, a);
          line.bottom = Math.max(line.bottom, b);
        } else lines.push({ top: a, bottom: b });
      }
    }
    lines.sort((x, y) => x.top - y.top);
    return lines.slice(1).map((line, i) => ({
      // Lines stack edge to edge; halfway between the glyphs is the edge of the line box.
      at: (lines[i].bottom + line.top) / 2,
      pos: () => lineStart(view, dom, top, line.top, toNatural),
    }));
  }
  if (["bulletList", "orderedList", "taskList"].includes(node.type.name)) {
    const items: { top: number; bottom: number; pos: number }[] = [];
    node.forEach((_child, childOffset) => {
      const pos = offset + 1 + childOffset;
      const li = view.nodeDOM(pos);
      if (!(li instanceof HTMLElement)) return;
      const r = li.getBoundingClientRect();
      const a = toNatural(r.top - top);
      items.push({ top: a, bottom: a + r.height, pos });
    });
    return items.slice(1).map((item, i) => ({ at: (items[i].bottom + item.top) / 2, pos: () => item.pos }));
  }
  return [];
}

/** The document position of the first character drawn on the line starting at `lineTop`. */
function lineStart(view: EditorView, dom: HTMLElement, top: number, lineTop: number, toNatural: (y: number) => number): number | null {
  const range = document.createRange();
  const charTop = (t: Text, i: number) => {
    range.setStart(t, i);
    range.setEnd(t, i + 1);
    const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
    return toNatural(r.top - top);
  };
  for (const t of textNodes(dom)) {
    const n = t.nodeValue!.length;
    if (charTop(t, n - 1) < lineTop - 1) continue;
    // Binary search for the first character at or below the line.
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (charTop(t, mid) >= lineTop - 1) hi = mid;
      else lo = mid + 1;
    }
    return view.posAtDOM(t, lo);
  }
  return null;
}

function layout(view: EditorView, g: PageGeometry, margins: Map<string, [number, number]>) {
  const usable = g.height - g.top - g.bottom;
  const pitch = g.height + g.gap;
  const bottomOf = (page: number) => page * pitch + usable;
  const breaks: Break[] = [];
  let page = 0;
  let y = 0; // bottom border edge of the previous block, in the editor's content coordinates
  let prevMb = 0;
  let first = true;
  // The block before this one, in case it is a heading that has to follow this block to the next page.
  let prev: { offset: number; heading: boolean; y0: number; mb0: number; mt: number; h: number; mb: number; page: number; atTop: boolean } | null = null;
  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) return;
    // Spacers already inside this block (from the last measurement) are taken out of its height.
    const rect = dom.getBoundingClientRect();
    const inner = [...dom.querySelectorAll<HTMLElement>(".page-split")].map((el) => {
      const r = el.getBoundingClientRect();
      return { end: r.bottom - rect.top, height: r.height };
    });
    const toNatural = (y: number) => y - inner.reduce((sum, s) => (s.end <= y + 0.5 ? sum + s.height : sum), 0);
    const h = rect.height - inner.reduce((sum, s) => sum + s.height, 0);

    const key = `${dom.tagName}.${dom.className}`;
    let m = margins.get(key);
    if (!m) {
      const cs = getComputedStyle(dom);
      m = [parseFloat(cs.marginTop) || 0, parseFloat(cs.marginBottom) || 0];
      // The first block's top margin is zeroed by CSS; don't let it poison the cache for its tag.
      if (!first) margins.set(key, m);
    }
    const [mt, mb] = first ? [0, m[1]] : m;
    let top = first ? 0 : y + Math.max(prevMb, mt);

    let splits: Cut[] | null = null;
    const splitsOf = () => (splits ??= cuts(view, node, offset, dom, toNatural));
    if (!first && top + h > bottomOf(page) && top > page * pitch + 1) {
      // Doesn't fit. Keep it here if at least its first line (or item) fits and the rest can follow;
      // otherwise the whole block starts on the next page.
      const firstCut = splitsOf()[0];
      if (!firstCut || top + firstCut.at > bottomOf(page)) {
        if (prev?.heading && prev.page === page && !prev.atTop) {
          // Keep a heading with what follows it: the heading moves to the next page too.
          let next = page + 1;
          while (next * pitch < prev.y0 + prev.mb0) next++;
          page = next;
          breaks.push({ pos: prev.offset, height: Math.max(0, page * pitch - (prev.y0 + prev.mb0) - prev.mt), page, inner: false });
          y = page * pitch + prev.h;
          top = y + Math.max(prev.mb, mt);
        } else {
          // Next page that starts below where we are (more than one, after an oversized block).
          let next = page + 1;
          while (next * pitch < y + prevMb) next++;
          page = next;
          // A spacer stops margins collapsing, so both the previous block's bottom margin and this
          // block's top margin count in full around it.
          breaks.push({ pos: offset, height: Math.max(0, page * pitch - (y + prevMb) - mt), page, inner: false });
          top = page * pitch;
        }
      }
    }
    // Carry a long paragraph or list over as many pages as it needs.
    let shift = 0;
    let from = 0;
    while (top + shift + h > bottomOf(page)) {
      const fits = splitsOf().filter((c) => c.at > from + 1 && top + shift + c.at <= bottomOf(page));
      const cut = fits[fits.length - 1];
      const pos = cut?.pos();
      if (!cut || pos == null) break;
      const height = (page + 1) * pitch - (top + shift + cut.at);
      page++;
      breaks.push({ pos, height, page, inner: true });
      shift += height;
      from = cut.at;
    }
    prev = { offset, heading: node.type.name === "heading", y0: y, mb0: prevMb, mt, h, mb, page, atTop: top <= page * pitch + 1 };
    y = top + shift + h;
    // An unsplittable block that ran over keeps going; the next block finds its page from y.
    while (y > bottomOf(page) + g.bottom + g.gap / 2) page++;
    prevMb = mb;
    first = false;
  });
  const pages = Math.max(page + 1, Math.ceil((y + g.top) / pitch));
  return { breaks, pages };
}

export const Pagination = Extension.create<{ geometry: () => PageGeometry; onPages: (pages: number) => void }>({
  name: "pagination",

  addOptions() {
    return { geometry: () => ({ height: 1123, top: 96, bottom: 96, gap: 24 }), onPages: () => {} };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<State>({
        key: paginationKey,
        state: {
          init: () => ({ breaks: [], deco: DecorationSet.empty }),
          apply(tr, value, _old, state) {
            const next = tr.getMeta(paginationKey) as Break[] | undefined;
            if (next) return { breaks: next, deco: decorations(state, next) };
            if (!tr.docChanged) return value;
            // Keep the spacers where they were until the next measurement moves them.
            return { breaks: value.breaks.map((b) => ({ ...b, pos: tr.mapping.map(b.pos) })), deco: value.deco.map(tr.mapping, tr.doc) };
          },
        },
        props: {
          decorations: (state) => paginationKey.getState(state)?.deco,
        },
        view(view) {
          let frame = 0;
          let pages = 0;
          const margins = new Map<string, [number, number]>();
          const measure = () => {
            frame = 0;
            if (!view.dom.isConnected) return;
            const result = layout(view, options.geometry(), margins);
            if (!same(result.breaks, paginationKey.getState(view.state)!.breaks)) {
              view.dispatch(view.state.tr.setMeta(paginationKey, result.breaks).setMeta("addToHistory", false));
            }
            if (result.pages !== pages) options.onPages((pages = result.pages));
          };
          const schedule = () => {
            if (!frame) frame = requestAnimationFrame(measure);
          };
          const repaginate = () => {
            margins.clear();
            schedule();
          };
          // Images finishing loading, fonts arriving and window resizes all change heights.
          const resize = new ResizeObserver(schedule);
          resize.observe(view.dom);
          view.dom.addEventListener(REPAGINATE, repaginate);
          void document.fonts?.ready.then(repaginate);
          schedule();
          return {
            update(v, prev) {
              if (v.state.doc !== prev.doc) schedule();
            },
            destroy() {
              cancelAnimationFrame(frame);
              resize.disconnect();
              view.dom.removeEventListener(REPAGINATE, repaginate);
            },
          };
        },
      }),
    ];
  },
});
