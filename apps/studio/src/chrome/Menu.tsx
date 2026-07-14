import { useEffect, useRef, useState } from "react";

export type MenuItem =
  | { separator: true }
  | { separator?: false; label: string; onSelect: () => void; disabled?: boolean };

/** Minimal desktop-style dropdown menu: click to open, closes on select,
 *  outside click, or Escape. No external dependency. */
export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const initialFocus = useRef<"first" | "last">("first");
  const enabledItems = () => itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled));
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  const openAt = (position: "first" | "last") => {
    initialFocus.current = position;
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const enabled = enabledItems();
    (initialFocus.current === "last" ? enabled.at(-1) : enabled[0])?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(true); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button ref={triggerRef} className="menu-trigger" aria-haspopup="menu" aria-expanded={open}
        onClick={() => open ? close() : openAt("first")}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          openAt(event.key === "ArrowUp" ? "last" : "first");
        }}>{label}</button>
      {open && (
        <div className="menu-list sc-tool-menu" role="menu" onKeyDown={(event) => {
          const enabled = enabledItems();
          const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close(true);
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            (event.key === "Home" ? enabled[0] : enabled.at(-1))?.focus();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const offset = event.key === "ArrowDown" ? 1 : -1;
            enabled[(current + offset + enabled.length) % enabled.length]?.focus();
          }
        }}>
          {items.map((item, index) => item.separator
            ? <div key={index} className="menu-sep sc-tool-menu-separator" role="separator" />
            : <button key={index} ref={(element) => { itemRefs.current[index] = element; }} role="menuitem" tabIndex={-1} className="menu-item sc-tool-menu-item" disabled={item.disabled} onClick={() => { close(true); item.onSelect(); }}>{item.label}</button>)}
        </div>
      )}
    </div>
  );
}
