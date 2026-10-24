"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, Ruler } from "lucide-react";
import { downloadIcon, EditorHeader, useAutosave } from "@/components/editor-shell";
import { RichContent, useRich } from "@/components/rich/editor";
import { RichToolbar } from "@/components/rich/toolbar";
import { Modal, Spinner, useToast } from "@/components/ui";
import { downloadBlob, drive, pickFile, safeFileName } from "@/lib/client";
import type { DocBody, Item } from "@/lib/types";

type Page = NonNullable<DocBody["page"]>;

// Screen sizes at 96 dpi: A4 is 210 mm wide, Letter 8.5 in.
const WIDTH = { a4: 794, letter: 816 };
const HEIGHT = { a4: 1123, letter: 1056 };
const PADDING = { normal: "96px", narrow: "48px", wide: "96px 192px" };

export default function DocPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Item | null>(null);
  const [body, setBody] = useState<DocBody | null>(null);
  const [error, setError] = useState("");
  // Bumped when content is replaced wholesale (Word import) to remount the editor.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    drive
      .body<DocBody>(id)
      .then((r) => {
        setItem(r.item);
        setBody(r.body);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (item) document.title = `${item.name} · Atrium Docs`;
  }, [item]);

  if (error) return <p className="m-auto p-10 text-center text-sm text-danger">{error}</p>;
  if (!item || !body) return <Spinner label="Opening document" />;
  return (
    <DocEditor
      key={version}
      item={item}
      setItem={setItem}
      initial={body}
      onReplace={(b) => {
        setBody(b);
        setVersion((v) => v + 1);
      }}
    />
  );
}

function DocEditor({ item, setItem, initial, onReplace }: { item: Item; setItem: (i: Item) => void; initial: DocBody; onReplace: (b: DocBody) => void }) {
  const toast = useToast();
  const body = useRef<DocBody>(initial);
  const [page, setPage] = useState<Page>(initial.page ?? { size: "a4", margins: "normal" });
  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  const [setup, setSetup] = useState(false);
  const { state, changed, flush } = useAutosave(item.id, setItem);

  const count = useCallback((text: string) => setCounts({ words: (text.match(/\S+/g) ?? []).length, chars: text.length }), []);
  const editor = useRich({
    content: initial.content,
    placeholder: "Start typing…",
    onChange: (json, ed) => {
      body.current = { ...body.current, content: json };
      changed(body.current);
      count(ed.getText());
    },
  });

  useEffect(() => {
    // The editor only exists after mount, so the first count has to happen here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (editor) count(editor.getText());
  }, [editor, count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush().then(() => toast("Saved"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush, toast]);

  const updatePage = (next: Page) => {
    setPage(next);
    body.current = { ...body.current, page: next };
    changed(body.current);
  };

  const fileName = safeFileName(item.name);
  const run = (fn: () => Promise<void>) => void fn().catch((e) => toast((e as Error).message, "error"));
  const content = () => editor?.getJSON() ?? body.current.content;

  const fileMenu = [
    {
      label: "Download as Word (.docx)",
      icon: downloadIcon,
      onClick: () =>
        run(async () => {
          const { exportDocx } = await import("@/lib/convert/docx");
          downloadBlob(await exportDocx({ ...body.current, content: content() }, item.name), `${fileName}.docx`);
        }),
    },
    { label: "Download as PDF", icon: downloadIcon, hint: "Print → Save as PDF", onClick: () => window.print() },
    {
      label: "Download as web page (.html)",
      icon: downloadIcon,
      onClick: () =>
        run(async () => {
          const { docToHtml } = await import("@/lib/convert/docx");
          downloadBlob(new Blob([await docToHtml(content(), item.name)], { type: "text/html" }), `${fileName}.html`);
        }),
    },
    {
      label: "Download as Markdown (.md)",
      icon: downloadIcon,
      onClick: () =>
        run(async () => {
          const { docToMarkdown } = await import("@/lib/convert/docx");
          downloadBlob(new Blob([docToMarkdown(content())], { type: "text/markdown" }), `${fileName}.md`);
        }),
    },
    "sep" as const,
    {
      label: "Import Word file…",
      icon: <FileUp size={16} />,
      onClick: () =>
        run(async () => {
          const file = await pickFile(".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document");
          if (!file) return;
          if (!confirmReplace()) return;
          const { importDocx } = await import("@/lib/convert/docx");
          const imported = await importDocx(file);
          const next = { ...imported, page: body.current.page };
          await flush();
          setItem(await drive.save(item.id, next));
          onReplace(next);
          toast(`Imported ${file.name}`);
        }),
    },
    { label: "Page setup…", icon: <Ruler size={16} />, onClick: () => setSetup(true) },
  ];

  return (
    <div className="flex h-dvh flex-col">
      <style>{`@media print { @page { size: ${page.size === "a4" ? "A4" : "letter"}; margin: 0; } }`}</style>
      <EditorHeader kind="doc" item={item} setItem={setItem} save={state} fileMenu={fileMenu} />
      {editor && <RichToolbar editor={editor} />}
      <div
        className="flex-1 overflow-auto bg-plane py-8 print:overflow-visible print:bg-white print:py-0"
        onClick={(e) => e.target === e.currentTarget && editor?.commands.focus("end")}
      >
        <div
          className="mx-auto cursor-text bg-[var(--paper)] shadow-[0_1px_3px_rgba(0,0,0,.12),0_8px_30px_rgba(0,0,0,.08)] print:shadow-none"
          style={{ width: WIDTH[page.size], maxWidth: "100%", minHeight: HEIGHT[page.size], padding: PADDING[page.margins] }}
          onClick={() => editor && !editor.isFocused && editor.commands.focus()}
        >
          <RichContent editor={editor} />
        </div>
      </div>
      <footer className="no-print flex h-7 items-center gap-4 border-t border-line bg-surface px-4 text-xs text-muted">
        <span>
          {counts.words.toLocaleString()} {counts.words === 1 ? "word" : "words"}
        </span>
        <span>{counts.chars.toLocaleString()} characters</span>
        <span className="flex-1" />
        <span>
          {page.size === "a4" ? "A4" : "Letter"} · {page.margins} margins
        </span>
      </footer>
      {setup && <PageSetup page={page} onChange={updatePage} onClose={() => setSetup(false)} />}
    </div>
  );
}

function confirmReplace() {
  return window.confirm("Replace this document's content with the Word file? You can undo with Ctrl+Z only until you reload.");
}

function PageSetup({ page, onChange, onClose }: { page: Page; onChange: (p: Page) => void; onClose: () => void }) {
  return (
    <Modal title="Page setup" onClose={onClose} width={380}>
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Paper size</span>
          <select className="input" value={page.size} onChange={(e) => onChange({ ...page, size: e.target.value as Page["size"] })}>
            <option value="a4">A4 (210 × 297 mm)</option>
            <option value="letter">Letter (8.5 × 11 in)</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Margins</span>
          <select className="input" value={page.margins} onChange={(e) => onChange({ ...page, margins: e.target.value as Page["margins"] })}>
            <option value="normal">Normal (1 in)</option>
            <option value="narrow">Narrow (0.5 in)</option>
            <option value="wide">Wide (2 in sides)</option>
          </select>
        </label>
        <div className="flex justify-end">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
