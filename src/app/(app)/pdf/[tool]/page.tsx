"use client";

import { notFound, useParams } from "next/navigation";
import { CreateTool } from "@/components/pdf/create";
import { OcrTool, PdfToWordTool, WordToPdfTool } from "@/components/pdf/convert";
import { EditTool } from "@/components/pdf/edit";
import type { ToolId } from "@/components/pdf/kit";
import { MergeTool } from "@/components/pdf/merge";
import { SplitTool } from "@/components/pdf/split";

const TOOLS: Record<ToolId, () => React.ReactNode> = {
  merge: MergeTool,
  split: SplitTool,
  edit: EditTool,
  create: CreateTool,
  ocr: OcrTool,
  "pdf-to-word": PdfToWordTool,
  "word-to-pdf": WordToPdfTool,
};

export default function PdfToolPage() {
  const { tool } = useParams<{ tool: string }>();
  const Tool = TOOLS[tool as ToolId];
  if (!Tool) notFound();
  return <Tool />;
}
