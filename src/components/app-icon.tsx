import { FileText, Folder, HardDrive, NotebookPen, Presentation, Sheet, File, FileImage, FileVideo, FileAudio, FileArchive, FileCode } from "lucide-react";
import type { Item, Kind } from "@/lib/types";

export const APPS = [
  { kind: "doc", name: "Docs", href: "/docs", color: "var(--app-doc)", Icon: FileText, blurb: "Write documents" },
  { kind: "sheet", name: "Sheets", href: "/sheets", color: "var(--app-sheet)", Icon: Sheet, blurb: "Crunch numbers" },
  { kind: "slides", name: "Slides", href: "/slides", color: "var(--app-slides)", Icon: Presentation, blurb: "Build presentations" },
  { kind: "drive", name: "Drive", href: "/drive", color: "var(--app-drive)", Icon: HardDrive, blurb: "Store every file" },
  { kind: "notebook", name: "Notebook", href: "/notebook", color: "var(--app-notebook)", Icon: NotebookPen, blurb: "Take notes" },
] as const;

export type AppKind = (typeof APPS)[number]["kind"];
export const appOf = (kind: AppKind) => APPS.find((a) => a.kind === kind)!;

/** Square, coloured app tile as used in the launcher and editor headers. */
export function AppTile({ kind, size = 36 }: { kind: AppKind; size?: number }) {
  const app = appOf(kind);
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-[28%] text-white" style={{ width: size, height: size, background: app.color }}>
      <app.Icon size={size * 0.55} strokeWidth={2} />
    </span>
  );
}

const FILE_ICONS = { image: FileImage, video: FileVideo, audio: FileAudio, archive: FileArchive, code: FileCode, other: File };

function fileType(mime = ""): keyof typeof FILE_ICONS {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (/zip|tar|gzip|compressed|rar|7z/.test(mime)) return "archive";
  if (/json|javascript|xml|html|css/.test(mime)) return "code";
  return "other";
}

const KIND_ICONS = { folder: Folder, doc: FileText, sheet: Sheet, slides: Presentation, notebook: NotebookPen } as const;

const KIND_COLOR: Record<Kind, string> = {
  folder: "var(--app-drive)",
  doc: "var(--app-doc)",
  sheet: "var(--app-sheet)",
  slides: "var(--app-slides)",
  notebook: "var(--app-notebook)",
  file: "var(--muted)",
};

/** Icon for an item in a file list. */
export function ItemIcon({ item, size = 20 }: { item: Pick<Item, "kind" | "mime">; size?: number }) {
  const Icon = item.kind === "file" ? FILE_ICONS[fileType(item.mime)] : KIND_ICONS[item.kind];
  return <Icon size={size} style={{ color: KIND_COLOR[item.kind] }} fill={item.kind === "folder" ? "currentColor" : "none"} fillOpacity={0.25} />;
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#111827" />
      <rect x="6" y="6" width="9" height="9" rx="2.2" fill="#3b82f6" />
      <rect x="17" y="6" width="9" height="9" rx="2.2" fill="#22c55e" />
      <rect x="6" y="17" width="9" height="9" rx="2.2" fill="#f97316" />
      <rect x="17" y="17" width="9" height="9" rx="2.2" fill="#a855f7" />
    </svg>
  );
}

/** GitHub mark (lucide dropped brand icons). */
export function GithubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}
