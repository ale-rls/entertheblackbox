import { useEffect, useState, type FormEvent } from "react";
import { displaySettingsSchema, type DisplaySettings } from "@entertheblackbox/protocol";

/**
 * How many checkpoints the hack needs. Replaces the counter total of every
 * operator-field scene, live and without republishing; saved with the display settings.
 */
export function HackCheckpoints({ token }: { token: string }) {
  const [saved, setSaved] = useState<number | null | undefined>(undefined);
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<{ status: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async (): Promise<DisplaySettings> => {
    const response = await fetch("/api/admin/settings/display", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(response.status === 401 ? "Operator sign-in expired." : `Loading settings failed (${response.status}).`);
    const parsed = displaySettingsSchema.safeParse(((await response.json()) as { display?: unknown }).display);
    if (!parsed.success) throw new Error("The server's display settings could not be read.");
    return parsed.data;
  };
  useEffect(() => {
    let stopped = false;
    load().then((settings) => { if (stopped) return; setSaved(settings.hackCheckpoints); setValue(settings.hackCheckpoints === null ? "" : String(settings.hackCheckpoints)); })
      .catch((reason: unknown) => { if (!stopped) setMessage({ status: "danger", text: reason instanceof Error ? reason.message : "Loading settings failed." }); });
    return () => { stopped = true; };
  }, [token]);
  const next = value.trim() === "" ? null : Math.round(Number(value));
  const valid = next === null || (Number.isInteger(next) && next >= 1 && next <= 99);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const current = await load();
      const response = await fetch("/api/admin/settings/display", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...current, hackCheckpoints: next }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? "Operator sign-in expired." : `Saving failed (${response.status}).`);
      setSaved(next);
      setMessage({ status: "success", text: next === null ? "Saved: each hack scene uses its own total." : `Saved: the hack needs ${next} checkpoints.` });
    } catch (reason) {
      setMessage({ status: "danger", text: reason instanceof Error ? reason.message : "Saving failed." });
    } finally {
      setBusy(false);
    }
  };
  return <section className="sc-tool-panel" aria-labelledby="hack-checkpoints-heading">
    <div className="admin-section-heading"><div><p className="sc-tool-eyebrow">K6 / T6</p><h2 id="hack-checkpoints-heading">Hack checkpoints</h2></div></div>
    <p className="sc-tool-help">How many checkpoints the hack needs. Applies live, also during the hack, and shows as “Checkpoints: n/total” on the main display and M1–M4. Empty uses the scene's own total.</p>
    <form className="admin-connection-form" onSubmit={(event) => void save(event)}>
      <label className="sc-tool-label">Checkpoints<input className="sc-tool-field" type="number" min="1" max="99" step="1" placeholder="Scene's own" value={value} disabled={saved === undefined} onChange={(event) => { setValue(event.target.value); setMessage(null); }} /></label>
      <button className="sc-tool-button" data-sc-tool-variant="primary" type="submit" disabled={busy || saved === undefined || !valid || next === saved}>Save</button>
    </form>
    {!valid && <p className="sc-tool-feedback" data-sc-tool-status="danger" role="alert">Enter a whole number from 1 to 99, or leave it empty.</p>}
    {message && <p className="sc-tool-feedback" data-sc-tool-status={message.status} role="status">{message.text}</p>}
  </section>;
}
