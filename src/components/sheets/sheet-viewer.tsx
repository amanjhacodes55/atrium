"use client";

import { useEffect, useState } from "react";
import { compute, loadEngine, type Computed } from "@/lib/sheets/engine";
import type { SheetBody } from "@/lib/types";
import { SheetTable } from "./sheet-table";

/** Read-only spreadsheet for public share links: computed values, formatting and tabs. */
export function SheetViewer({ body }: { body: SheetBody }) {
  const [values, setValues] = useState<Computed | null>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    let live = true;
    loadEngine().then((hf) => live && setValues(compute(hf, body.sheets)));
    return () => {
      live = false;
    };
  }, [body]);
  const tab = body.sheets[active] ?? body.sheets[0];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto bg-white">
        {values ? <SheetTable tab={tab} values={values[active] ?? {}} /> : <p className="p-6 text-sm text-muted">Calculating…</p>}
      </div>
      {body.sheets.length > 1 && (
        <div className="flex gap-1 border-t border-line bg-surface px-2 py-1">
          {body.sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActive(i)}
              className={`rounded-md px-3 py-1 text-sm ${i === active ? "bg-accent-wash font-medium text-accent" : "text-ink-2 hover:bg-hover"}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
