import { useState } from "react";

type RunOfShowLink = {
  label: string;
  value: string;
  copyable?: boolean;
  note?: string;
};

type RunOfShowGroup = {
  machine: string;
  links: RunOfShowLink[];
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return <button
    type="button"
    className="sc-tool-button run-of-show-copy"
    data-sc-tool-variant="secondary"
    onClick={() => {
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      });
    }}
  >{copied ? "Copied" : "Copy"}</button>;
}

/**
 * Static reference, not live config: the admin client has no access to
 * DISPLAY_TOKEN/installation/room (server-only env), so the display URL is
 * shown as a fill-in-the-blanks pattern rather than a fabricated value.
 */
export function runOfShowGroups(origin: string): RunOfShowGroup[] {
  return [
    {
      machine: "Installation machine (server + display)",
      links: [
        {
          label: "Authenticated display",
          value: "http://<installation-host>:<port>/display/?installation=<installation-id>&room=<room>&token=<DISPLAY_TOKEN>",
          note: "Fill in this installation's host, room, and DISPLAY_TOKEN from the server's environment (see README “Run locally”). The server accepts only one authenticated display connection — keep exactly one tab open on this URL.",
        },
      ],
    },
    {
      machine: "Operator machine (this browser)",
      links: [
        { label: "Operations dashboard", value: `${origin}/admin/`, copyable: true },
        { label: "Audio diagnostics", value: `${origin}/admin/?view=audio`, copyable: true, note: "Read-only; safe to leave open in a second tab for the whole show." },
      ],
    },
    {
      machine: "Participant phones",
      links: [
        {
          label: "Phone join (this machine only)",
          value: `${origin}/phone/`,
          copyable: true,
          note: "For physical phones on the venue network, use the LAN address configured via PHONE_JOIN_BASE_URL instead — printed at the bottom of the display lobby and in its corner QR, not this browser's own address.",
        },
      ],
    },
    {
      machine: "Tracking machine (optional, camera positions)",
      links: [
        {
          label: "services/trackingbox",
          value: "Runs on its own; no browser tab needed here. Set TRACKINGBOX_URL on the server to use it.",
        },
      ],
    },
  ];
}

export function RunOfShowPanel() {
  const groups = runOfShowGroups(window.location.origin);
  return <section className="sc-tool-panel run-of-show" aria-labelledby="run-of-show-heading">
    <div className="admin-section-heading">
      <div><p className="sc-tool-eyebrow">Reference</p><h2 id="run-of-show-heading">Run of show</h2></div>
    </div>
    <p className="sc-tool-copy">What needs to be open, and where, to run this show. Full setup in README.md.</p>
    <div className="run-of-show-groups">
      {groups.map((group) => <div className="run-of-show-group" key={group.machine}>
        <h3>{group.machine}</h3>
        <ul className="run-of-show-list">
          {group.links.map((link) => <li key={link.label}>
            <div className="run-of-show-link-main">
              <strong>{link.label}</strong>
              <span className="sc-tool-mono run-of-show-value">{link.value}</span>
              {link.copyable && <CopyButton text={link.value} />}
            </div>
            {link.note && <p className="sc-tool-help">{link.note}</p>}
          </li>)}
        </ul>
      </div>)}
    </div>
  </section>;
}
