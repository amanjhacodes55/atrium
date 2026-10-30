"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PDF_TOOLS, ToolTile } from "@/components/pdf/kit";
import { TopBar } from "@/components/shell";

export default function PdfHome() {
  useEffect(() => {
    document.title = "PDF tools · Atrium";
  }, []);
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar title="PDF" color="var(--app-pdf)" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-semibold">Every tool you need for PDFs</h1>
        <p className="mt-1 text-sm text-muted">Merge, split, edit, OCR and convert. Your files are processed on your own device and never uploaded.</p>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PDF_TOOLS.map((t) => (
            <Link key={t.id} href={`/pdf/${t.id}`} className="card flex flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:border-accent hover:shadow-md">
              <ToolTile id={t.id} size={44} />
              <div>
                <div className="font-semibold">{t.name}</div>
                <div className="mt-1 text-sm text-muted">{t.blurb}</div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
