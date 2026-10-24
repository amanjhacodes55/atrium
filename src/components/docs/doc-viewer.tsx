"use client";

import { RichContent, useRich } from "@/components/rich/editor";
import type { DocBody } from "@/lib/types";

const WIDTH = { a4: 794, letter: 816 };
const PADDING = { normal: "96px", narrow: "48px", wide: "96px 192px" };

/** Read-only document on a white page, for public share links. */
export function DocViewer({ body }: { body: DocBody }) {
  const page = body.page ?? { size: "a4", margins: "normal" };
  const editor = useRich({ content: body.content, editable: false });
  return (
    <div className="bg-plane py-8 print:bg-white print:py-0">
      <div
        className="mx-auto bg-[var(--paper)] shadow-[0_1px_3px_rgba(0,0,0,.12),0_8px_30px_rgba(0,0,0,.08)] print:shadow-none max-sm:!px-5 max-sm:!py-8"
        style={{ width: WIDTH[page.size], maxWidth: "100%", minHeight: 600, padding: PADDING[page.margins] }}
      >
        <RichContent editor={editor} />
      </div>
    </div>
  );
}
