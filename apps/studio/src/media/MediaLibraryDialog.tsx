import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { StudioProject } from "@smartphonecracy/studio-adapter";
import type { MediaManifest } from "./local.js";
import { phaseMediaSources, studioMediaKindForSource, type StudioMediaKind } from "./library.js";

export type MediaLibraryFeedback = {
  status: "info" | "success" | "danger";
  message: string;
};

export type MediaLibraryRow = MediaManifest["files"][number] & { references: string[] };

export type MediaLibrarySelection = {
  contextLabel: string;
  selectedSrc: string;
  mediaKind: Exclude<StudioMediaKind, "unknown">;
  onSelect: (row: MediaLibraryRow) => void;
};

export function formatMediaBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatMediaDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return "Duration unavailable";
  const seconds = Math.round(durationMs / 100) / 10;
  return seconds < 60 ? `${seconds.toFixed(1)} sec` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} sec`;
}

export function mediaLibraryRows(
  manifest: MediaManifest | undefined,
  project: StudioProject | undefined,
): MediaLibraryRow[] {
  const references = new Map<string, string[]>();
  for (const phase of project?.scenario.phases ?? []) {
    for (const src of phaseMediaSources(phase)) {
      references.set(src, [...(references.get(src) ?? []), phase.id]);
    }
  }
  return (manifest?.files ?? []).map((file) => ({
    ...file,
    references: references.get(file.src) ?? [],
  }));
}

export function MediaLibraryDialog({
  manifest,
  project,
  feedback,
  uploading,
  showActive = false,
  selection,
  onUpload,
  onDelete,
  onClose,
}: {
  manifest: MediaManifest | undefined;
  project: StudioProject | undefined;
  feedback: MediaLibraryFeedback | undefined;
  uploading: boolean;
  showActive?: boolean;
  selection?: MediaLibrarySelection;
  onUpload: (files: FileList) => void | Promise<void>;
  onDelete: (row: MediaLibraryRow, trigger: HTMLButtonElement) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => mediaLibraryRows(manifest, project), [manifest, project]);
  const selectableRows = selection
    ? rows.filter((row) => studioMediaKindForSource(row.src) === selection.mediaKind)
    : rows;
  const visibleRows = selectableRows.filter((row) => row.src.toLowerCase().includes(query.trim().toLowerCase()));
  const used = rows.filter((row) => row.references.length > 0).length;
  const selecting = selection !== undefined;
  const availableCount = selection ? selectableRows.length : rows.length;

  useEffect(() => searchRef.current?.focus(), []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !uploading) {
      event.preventDefault();
      onClose();
    }
  };
  const receiveDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!uploading && event.dataTransfer.files.length > 0) void onUpload(event.dataTransfer.files);
  };

  return <div className="sc-tool-dialog-scrim" onMouseDown={(event) => {
    if (!uploading && event.target === event.currentTarget) onClose();
  }}>
    <div className="sc-tool-dialog media-library" role="dialog" aria-modal="true" aria-labelledby="media-library-title" onKeyDown={handleKeyDown}>
      <header className="media-library-header">
        <div><p className="sc-tool-eyebrow">{selecting ? "Media picker" : "Shared media"}</p><h2 id="media-library-title">{selecting ? "Choose media" : "Media library"}</h2><p className="sc-tool-copy">{selection ? `${selection.contextLabel} · ` : ""}{availableCount} file{availableCount === 1 ? "" : "s"}{!selection && (project ? ` · ${used} used in this show` : " · shared across shows")}</p></div>
        <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={uploading} onClick={onClose}>{selecting ? "Cancel" : "Close"}</button>
      </header>
      {showActive && <p className="live-show-warning" role="status"><strong>Live show running.</strong> Uploads and removals are safe; the server will apply them after the show ends.</p>}
      <div
        className="media-dropzone"
        data-dragging={dragging}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={receiveDrop}
      >
        <strong>{uploading ? "Uploading media…" : "Drop several media files here"}</strong>
        <span className="sc-tool-copy">Video, image, or MP3 · choosing an existing filename replaces that file</span>
        <button className="sc-tool-button" data-sc-tool-variant="primary" type="button" disabled={uploading} onClick={() => inputRef.current?.click()}>Choose media…</button>
        <input ref={inputRef} aria-label="Upload media to media library" hidden multiple type="file" accept="video/mp4,video/webm,image/jpeg,image/png,image/webp,audio/mpeg,audio/mp3,.mp4,.webm,.jpg,.jpeg,.png,.webp,.mp3" onChange={(event) => {
          if (event.currentTarget.files?.length) void onUpload(event.currentTarget.files);
          event.currentTarget.value = "";
        }} />
      </div>
      {feedback && <p className="sc-tool-feedback media-library-feedback" data-sc-tool-status={feedback.status} role={feedback.status === "danger" ? "alert" : "status"}>{feedback.message}</p>}
      <label className="sc-tool-label media-search" htmlFor="media-library-search">Search library
        <input ref={searchRef} id="media-library-search" className="sc-tool-field" type="search" placeholder="Filename" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {manifest === undefined ? <div className="media-library-empty"><strong>Media library unavailable</strong><p className="sc-tool-copy">PocketBase could not be reached. Check the connection and reopen the library.</p></div>
        : visibleRows.length === 0 ? <div className="media-library-empty"><strong>{rows.length === 0 ? "No media yet" : selection && selectableRows.length === 0 ? `No ${selection.mediaKind} files yet` : "No matching media"}</strong><p className="sc-tool-copy">{rows.length === 0 || (selection && selectableRows.length === 0) ? "Upload one or several files above." : "Try another filename."}</p></div>
          : <div className="media-list" role="list">{visibleRows.map((row) => {
            const selected = selection?.selectedSrc === row.src;
            return <article className="media-row" data-selected={selected || undefined} role="listitem" key={row.src}>
            <div className="media-row-main"><strong>{row.src}</strong><span className="sc-tool-copy sc-tool-mono">{studioMediaKindForSource(row.src)} · {formatMediaBytes(row.bytes)}{row.durationMs === undefined ? "" : ` · ${formatMediaDuration(row.durationMs)}`}</span></div>
            <div className="media-references">{selected && <span className="media-state" data-selected="true">Selected</span>}{project === undefined
              ? <span className="media-state">Shared</span>
              : row.references.length > 0
              ? <><span className="media-state" data-used="true">Used</span>{row.references.map((reference) => <span className="media-reference" key={reference}>{reference}</span>)}</>
              : <span className="media-state">Unused</span>}</div>
            <div className="media-row-actions">
              {selection && <button className="sc-tool-button" data-sc-tool-variant={selected ? "secondary" : "primary"} type="button" disabled={uploading || selected} onClick={() => selection.onSelect(row)}>{selected ? "Current" : "Use media"}</button>}
              <button className="sc-tool-button" data-sc-tool-variant="danger" type="button" disabled={uploading} onClick={(event) => onDelete(row, event.currentTarget)}>Remove</button>
            </div>
          </article>})}</div>}
    </div>
  </div>;
}
