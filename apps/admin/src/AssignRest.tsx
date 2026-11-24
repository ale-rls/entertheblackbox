import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

export type AssignRestConfig = { fromGroupId: string; leadGroupIds: string[]; fill: { groupId: string; min: number; max: number; share: number }[]; restGroupId: string };
type Plan = { assignments: { participantId: string; groupId: string }[]; emptyLeadGroupIds: string[] };
type Group = { id: string; label: string; color?: string };
type Participant = { clientId: string; name: string; deviceLabel?: string | null };

async function post(token: string, body: object): Promise<unknown> {
  const response = await fetch('/api/admin/groups/assign-rest', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(response.status === 401 ? 'Your session has expired. Sign in again.' : result?.error === 'stale' ? 'The show restarted. Try again.' : result?.error ?? `Request failed (${response.status})`);
  return result;
}

/**
 * Admin → Devices: draws everyone still in the "from" group into the authored parts. The operator sees the draw
 * first and can draw again; Apply moves them, and each move plays that part's introduction on the tablet.
 */
export function AssignRest({ token, config, sessionId, groups, participants, disabled, onApplied }: {
  token: string; config: AssignRestConfig; sessionId: string | null; groups: Group[]; participants: Participant[]; disabled: boolean;
  onApplied: (message: string) => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = (id: string) => groups.find(g => g.id === id)?.label ?? id;
  const person = (id: string) => { const p = participants.find(x => x.clientId === id); return p ? `${p.name}${p.deviceLabel && p.deviceLabel !== p.name ? ` · Tablet ${p.deviceLabel}` : ''}` : id; };

  async function draw() {
    setBusy(true); setError('');
    try { setPlan(await post(token, { sessionId }) as Plan); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not draw'); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!plan) return;
    setBusy(true); setError('');
    try {
      const result = await post(token, { sessionId, apply: plan.assignments }) as { moved: number; skipped: string[] };
      setPlan(null);
      onApplied(result.skipped.length ? `Assigned ${result.moved}. Skipped ${result.skipped.length} moved by hand since the draw: ${result.skipped.map(person).join(', ')}.` : `Assigned ${result.moved}. Their introductions are playing.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not assign'); }
    finally { setBusy(false); }
  }

  return <div className="admin-assign-rest">
    <button className="sc-tool-button" data-sc-tool-variant="primary" type="button" disabled={disabled || busy} onClick={() => void draw()}>Assign rest…</button>
    <span className="sc-tool-help">Draws everyone still in {label(config.fromGroupId)} into {[...config.fill.map(f => `${label(f.groupId)} (${f.min}–${f.max})`), label(config.restGroupId)].join(', ')}. Set the leads by hand first.</span>
    {error && !plan && <p className="sc-tool-feedback" role="alert">{error}</p>}
    {plan && <AssignRestDialog plan={plan} busy={busy} error={error} label={label} person={person} onRedraw={() => void draw()} onApply={() => void apply()} onCancel={() => { setPlan(null); setError(''); }} />}
  </div>;
}

function AssignRestDialog({ plan, busy, error, label, person, onRedraw, onApply, onCancel }: {
  plan: Plan; busy: boolean; error: string; label: (id: string) => string; person: (id: string) => string;
  onRedraw: () => void; onApply: () => void; onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  const byGroup = [...new Set(plan.assignments.map(a => a.groupId))].map(groupId => ({ groupId, ids: plan.assignments.filter(a => a.groupId === groupId).map(a => a.participantId) }));
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } };
  return <div className="sc-tool-dialog-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <div className="sc-tool-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-assign-rest-title" onKeyDown={onKeyDown}>
      <p className="sc-tool-eyebrow">Preview · nothing has moved yet</p>
      <h2 id="admin-assign-rest-title">Assign rest</h2>
      {plan.emptyLeadGroupIds.length > 0 && <p className="sc-tool-feedback" role="alert">No one is in {plan.emptyLeadGroupIds.map(label).join(', ')} yet. You can still apply and assign the lead later.</p>}
      {plan.assignments.length === 0 ? <p>Everyone already has a part.</p> : byGroup.map(({ groupId, ids }) => <div key={groupId}>
        <h3>{label(groupId)} · {ids.length}</h3>
        <ul className="admin-assign-rest-list">{ids.map(id => <li key={id}>{person(id)}</li>)}</ul>
      </div>)}
      {error && <p className="sc-tool-feedback" role="alert">{error}</p>}
      <div className="sc-tool-dialog-actions">
        <button ref={cancelRef} className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={onCancel}>Cancel</button>
        <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={busy} onClick={onRedraw}>Draw again</button>
        <button className="sc-tool-button" data-sc-tool-variant="primary" type="button" disabled={busy || plan.assignments.length === 0} onClick={onApply}>Apply</button>
      </div>
    </div>
  </div>;
}
