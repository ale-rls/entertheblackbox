import { useEffect, useRef, useState } from "react";
import type { SaveStatus as SaveStatusValue } from "../drafts.js";

const SETTLED_ANNOUNCEMENT_DELAY_MS = 750;

export function SaveStatus({ status }: { status: SaveStatusValue }) {
  const [announcement, setAnnouncement] = useState("");
  const previous = useRef(status);

  useEffect(() => {
    if (previous.current === status) return;
    previous.current = status;
    if (status === "saving") {
      setAnnouncement("");
      return;
    }
    if (status === "error") {
      setAnnouncement("Changes could not be saved.");
      return;
    }
    const timer = window.setTimeout(() => setAnnouncement("Changes saved."), SETTLED_ANNOUNCEMENT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  return <>
    <span aria-hidden="true" className={`status ${status}`} data-save-status={status}>{status}</span>
    <span className="sc-tool-visually-hidden" data-save-announcement aria-live="polite" aria-atomic="true">{announcement}</span>
  </>;
}
