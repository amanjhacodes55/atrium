// Tiny builders for TipTap JSON, so templates read like the documents they produce.

export type TNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

export const text = (t: string, ...marks: string[]): TNode => ({ type: "text", text: t, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
export const p = (...content: (TNode | string)[]): TNode => ({
  type: "paragraph",
  content: content.filter(Boolean).map((c) => (typeof c === "string" ? text(c) : c)),
});
export const center = (...content: (TNode | string)[]): TNode => ({ ...p(...content), attrs: { textAlign: "center" } });
export const right = (...content: (TNode | string)[]): TNode => ({ ...p(...content), attrs: { textAlign: "right" } });
export const h = (level: 1 | 2 | 3, t: string, align?: "center"): TNode => ({
  type: "heading",
  attrs: { level, ...(align ? { textAlign: align } : {}) },
  content: [text(t)],
});
export const ul = (...items: string[]): TNode => ({ type: "bulletList", content: items.map((i) => ({ type: "listItem", content: [p(i)] })) });
export const ol = (...items: string[]): TNode => ({ type: "orderedList", content: items.map((i) => ({ type: "listItem", content: [p(i)] })) });
export const tasks = (...items: (string | [string, boolean])[]): TNode => ({
  type: "taskList",
  content: items.map((i) => {
    const [t, checked] = typeof i === "string" ? [i, false] : i;
    return { type: "taskItem", attrs: { checked }, content: [p(t)] };
  }),
});
export const table = (rows: string[][]): TNode => ({
  type: "table",
  content: rows.map((r, i) => ({ type: "tableRow", content: r.map((c) => ({ type: i === 0 ? "tableHeader" : "tableCell", content: [c ? p(c) : p()] })) })),
});
export const hr = (): TNode => ({ type: "horizontalRule" });
export const quote = (t: string): TNode => ({ type: "blockquote", content: [p(t)] });
export const doc = (...content: TNode[]): TNode => ({ type: "doc", content });
