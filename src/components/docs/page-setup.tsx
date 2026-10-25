"use client";

import type { SaveState } from "@/components/editor-shell";
import { Modal } from "@/components/ui";
import type { LiveStatus } from "@/lib/live-client";
import type { PageSettings } from "./paged";

/** Saving to the drive and syncing with others are separate; show whichever needs attention. */
export function saveState(save: SaveState, live: LiveStatus): SaveState {
  return live === "offline" ? "error" : save;
}

export function PageSetup({ page, onChange, onClose }: { page: PageSettings; onChange: (p: PageSettings) => void; onClose: () => void }) {
  return (
    <Modal title="Page setup" onClose={onClose} width={380}>
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Paper size</span>
          <select className="input" value={page.size} onChange={(e) => onChange({ ...page, size: e.target.value as PageSettings["size"] })}>
            <option value="a4">A4 (210 × 297 mm)</option>
            <option value="letter">Letter (8.5 × 11 in)</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Margins</span>
          <select className="input" value={page.margins} onChange={(e) => onChange({ ...page, margins: e.target.value as PageSettings["margins"] })}>
            <option value="normal">Normal (1 in)</option>
            <option value="narrow">Narrow (0.5 in)</option>
            <option value="wide">Wide (2 in sides)</option>
          </select>
        </label>
        <p className="text-xs text-muted">Changes apply for everyone editing this document.</p>
        <div className="flex justify-end">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
