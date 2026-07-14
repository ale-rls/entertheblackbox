import { createElement, type SVGProps } from "react";

export type ToolStatus = "info" | "success" | "warning" | "danger";

export interface StatusIconProps
  extends Omit<
    SVGProps<SVGSVGElement>,
    "aria-hidden" | "aria-label" | "children" | "role"
  > {
  status: ToolStatus;
  label?: string;
  size?: number;
}

const glyphs: Record<ToolStatus, ReturnType<typeof createElement>[]> = {
  info: [
    createElement("circle", { key: "outline", cx: 8, cy: 8, r: 6.25 }),
    createElement("path", { key: "stem", d: "M8 7.25v4" }),
    createElement("path", { key: "dot", d: "M8 4.75h.01" }),
  ],
  success: [
    createElement("circle", { key: "outline", cx: 8, cy: 8, r: 6.25 }),
    createElement("path", { key: "check", d: "m4.75 8.1 2.1 2.1 4.5-4.5" }),
  ],
  warning: [
    createElement("path", { key: "outline", d: "M8 2 14.5 13H1.5L8 2Z" }),
    createElement("path", { key: "stem", d: "M8 6v3.25" }),
    createElement("path", { key: "dot", d: "M8 11.5h.01" }),
  ],
  danger: [
    createElement("circle", { key: "outline", cx: 8, cy: 8, r: 6.25 }),
    createElement("path", { key: "cross", d: "m5.5 5.5 5 5m0-5-5 5" }),
  ],
};

/**
 * A small status glyph for current Admin and Studio feedback flows.
 * Provide `label` when the icon has meaning without adjacent visible status text.
 */
export function StatusIcon({
  status,
  label,
  size = 16,
  className,
  ...svgProps
}: StatusIconProps) {
  return createElement(
    "svg",
    {
      ...svgProps,
      ...(label
        ? { "aria-label": label, role: "img" }
        : { "aria-hidden": true }),
      className: ["sc-tool-status-icon", className].filter(Boolean).join(" "),
      "data-sc-tool-status": status,
      fill: "none",
      focusable: "false",
      height: size,
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 1.5,
      viewBox: "0 0 16 16",
      width: size,
      xmlns: "http://www.w3.org/2000/svg",
    },
    glyphs[status],
  );
}
