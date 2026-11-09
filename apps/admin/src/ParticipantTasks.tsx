import { useState } from 'react';
import type { ParticipantRole, RoleAssignment, ParticipantTask, TaskInstance } from '@entertheblackbox/scenario';
export type TaskStatus = { roles: ParticipantRole[]; assignments: RoleAssignment[]; templates: ParticipantTask[]; instances: TaskInstance[]; error: string | null; waitingForGo: boolean; paths: { phaseId: string; phaseEpoch: number; instances: TaskInstance[]; error: string | null; waitingForGo: boolean }[] };
export function ParticipantTasks({ token, state, sessionId, phaseId, phaseEpoch, participants, refresh }: {
  token: string; state: TaskStatus; sessionId: string; phaseId: string; phaseEpoch: number;
  participants: { clientId: string; name: string }[]; refresh: (state: TaskStatus) => void;
}) {
  const [roleId, setRole] = useState(''); const [participantId, setParticipant] = useState('');
  const [templateId, setTemplate] = useState(''); const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function command(action: string, instanceId?: string, target = { phaseId, phaseEpoch }, roleTarget = { roleId, participantId }) {
    setBusy(true); setError('');
    try { const response = await fetch('/api/admin/tasks', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, instanceId, templateId, sessionId, ...target, ...roleTarget, ...(selected.length ? { participantIds: selected } : {}) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Task command failed'); refresh(result as TaskStatus);
    } catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); } finally { setBusy(false); }
  }
  async function handover() {
    setBusy(true); setError('');
    try { const response = await fetch('/api/admin/handover', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ participantId, sessionId, phaseEpoch }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Handover failed'); setParticipant(result.replacementId); }
    catch(e) { setError(e instanceof Error ? e.message : 'Handover failed'); } finally { setBusy(false); }
  }
  async function downloadResults() {
    setBusy(true); setError('');
    try { const response = await fetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}/export?format=tasks-csv`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('Results export is not available yet. Check persistence and try again.'); const url=URL.createObjectURL(await response.blob()); const link=document.createElement('a'); link.href=url; link.download='participant-task-results.csv'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
    catch(e) { setError(e instanceof Error ? e.message : 'Export failed'); } finally { setBusy(false); }
  }
  const template = state.templates.find(t => t.id === templateId);
  return <section className="sc-tool-panel"><h2>Participant tasks</h2><p>Templates come from the active published show. Edit definitions in Studio → Show properties; publishing during a show takes effect after it ends.</p>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy || !sessionId || sessionId === "idle"} onClick={() => void downloadResults()}>Download task results CSV</button>
    <fieldset><legend>Roles and replacements</legend><label>Participant<select value={participantId} onChange={e=>setParticipant(e.target.value)}><option value="">Choose participant</option>{participants.map(p=><option key={p.clientId} value={p.clientId}>{p.name}</option>)}</select></label><label>Role<select value={roleId} onChange={e=>setRole(e.target.value)}><option value="">Choose role</option>{state.roles.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></label><button disabled={busy||!roleId||!participantId} onClick={()=>void command('assign-role')}>Assign role</button><ul>{state.assignments.map(a=><li key={`${a.participantId}:${a.roleId}`}>{participants.find(p=>p.clientId===a.participantId)?.name??a.participantId}: {state.roles.find(r=>r.id===a.roleId)?.label??a.roleId} <button disabled={busy} onClick={()=>void command('withdraw-role',undefined,{phaseId,phaseEpoch},a)}>Withdraw / free place</button></li>)}</ul></fieldset>
    <fieldset><legend>Tablet handover</legend><p>Use the selected participant above. This ends their participation and roles, gives the device a fresh identity in the same audience, and opens the replacement task configured in Studio. Their earlier answers stay attached to the former participant.</p><button disabled={busy || !participantId} onClick={() => void handover()}>Hand selected tablet to new participant</button></fieldset>
    <label>Published template<select value={templateId} onChange={e => setTemplate(e.target.value)}><option value="">Choose template</option>{state.templates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
    {template && <><p>{template.question}</p><p>Notification: {template.notificationBody}</p><p>Audience filter: {template.groupIds.join(', ') || 'All'}. Response window: {template.durationMs / 1000}s.</p></>}
    <details><summary>Choose individual recipients (default: eligible audience)</summary>{participants.map(p => <label key={p.clientId}><input type="checkbox" checked={selected.includes(p.clientId)} onChange={e => setSelected(e.target.checked ? [...selected, p.clientId] : selected.filter(id => id !== p.clientId))} />{p.name}</label>)}</details>
    <button disabled={busy || !template} onClick={() => void command('open')}>Send task</button>
    {[{ phaseId, phaseEpoch, ...state }, ...state.paths].map(path => <section key={`${path.phaseId}:${path.phaseEpoch}`}><h3>{path.phaseId}</h3>
      {path.error && <p role="alert">{path.error}</p>}
      {path.waitingForGo && <><p>Waiting for operator confirmation that the scene is ready to continue.</p><button disabled={busy} onClick={() => void command('go', undefined, path)}>Ready — GO</button></>}
      {path.instances.map(task => <details key={task.id} open={task.status === 'open'}><summary>{task.template.title} — {task.status} — {task.recipients.filter(r => r.status === 'accepted' || r.status === 'answered').length}/{task.recipients.length} responded</summary>
        <p>Closes: {new Date(task.deadlineAt).toLocaleTimeString()}</p>
        <ul>{task.recipients.map(r => <li key={r.participantId}>{participants.find(p => p.clientId === r.participantId)?.name ?? r.participantId}: {r.status} {r.optionId ?? ''}{r.sequence !== null ? ` (#${r.sequence})` : ''}</li>)}</ul>
        <button disabled={busy || task.status !== 'open'} onClick={() => void command('close', task.id, path)}>Close responses</button>
        <button disabled={busy || task.status === 'cancelled'} onClick={() => void command('cancel', task.id, path)}>Cancel task</button>
      </details>)}
    </section>)}
  </section>;
}
