import { participantTaskSchema, type ParticipantRole, type ParticipantTask } from '@entertheblackbox/scenario';
import { useState } from 'react';
export function TaskEditor({ tasks, roles, groups, onChange }: { tasks: ParticipantTask[]; roles: ParticipantRole[]; groups: { id: string; label: string }[]; onChange: (tasks: ParticipantTask[]) => void }) {
  const [error, setError] = useState('');
  function update(index: number, value: ParticipantTask) { onChange(tasks.map((t, i) => i === index ? value : t)); }
  return <fieldset><legend>Participant task templates</legend><p>Publish these templates to operate them in Admin → Tasks, or attach one to an Audio + text scene. Capacity is awarded in server response order.</p>
    {tasks.map((t, index) => <fieldset key={index}><legend>{t.title}</legend>
      <label>Template ID<input value={t.id} onChange={e => update(index, { ...t, id: e.target.value })} /></label>
      <label>Title<input value={t.title} onChange={e => update(index, { ...t, title: e.target.value })} /></label>
      <label>Question<textarea value={t.question} onChange={e => update(index, { ...t, question: e.target.value })} /></label>
      <label>Notification text<input value={t.notificationBody} onChange={e => update(index, { ...t, notificationBody: e.target.value })} /></label>
      <label>Response time (seconds)<input type="number" min="1" value={t.durationMs / 1000} onChange={e => update(index, { ...t, durationMs: Number(e.target.value) * 1000 })} /></label>
      <p>No audience selected means all recipients in the current timeline.</p>
      {groups.map(g => <label key={g.id}><input type="checkbox" checked={t.groupIds.includes(g.id)} onChange={e => update(index, { ...t, groupIds: e.target.checked ? [...t.groupIds, g.id] : t.groupIds.filter(id => id !== g.id) })} />{g.label}</label>)}
      {t.options.map((o, oi) => <fieldset key={oi}><legend>Option {oi + 1}</legend>
        <label>ID<input value={o.id} onChange={e => update(index, { ...t, options: t.options.map((v, i) => i === oi ? { ...v, id: e.target.value } : v) })} /></label>
        <label>Label<input value={o.label} onChange={e => update(index, { ...t, options: t.options.map((v, i) => i === oi ? { ...v, label: e.target.value } : v) })} /></label>
        <label>Capacity (blank = unlimited)<input type="number" min="1" value={o.capacity ?? ''} onChange={e => update(index, { ...t, options: t.options.map((v, i) => { if (i !== oi) return v; const { capacity: _, ...rest } = v; return e.target.value ? { ...rest, capacity: Number(e.target.value) } : rest; }) })} /></label>
        <label>Assign role<select value={o.roleId ?? ''} onChange={e => update(index, { ...t, options: t.options.map((v,i) => { if(i!==oi)return v;const {roleId:_,...rest}=v;return e.target.value?{...rest,roleId:e.target.value}:rest;}) })}><option value="">No role</option>{roles.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
        <label>Individual result<textarea value={o.message} onChange={e => update(index, { ...t, options: t.options.map((v, i) => i === oi ? { ...v, message: e.target.value } : v) })} /></label>
        <button type="button" disabled={t.options.length === 1} onClick={() => update(index, { ...t, options: t.options.filter((_, i) => i !== oi) })}>Remove option</button>
      </fieldset>)}
      <button type="button" disabled={t.options.length >= 12} onClick={() => update(index, { ...t, options: [...t.options, { id: `option-${t.options.length + 1}`, label: 'New option', message: '' }] })}>Add option</button>
      <label>Full option message<textarea value={t.fullMessage} onChange={e => update(index, { ...t, fullMessage: e.target.value })} /></label>
      {!participantTaskSchema.safeParse(t).success && <p role="alert">Complete all fields and use unique option IDs, positive capacities and a response time of 1–3600 seconds.</p>}
      <button type="button" onClick={() => onChange(tasks.filter((_, i) => i !== index))}>Delete template</button>
    </fieldset>)}
    {error && <p role="alert">{error}</p>}
    <button type="button" onClick={() => { if (tasks.length >= 100) { setError('Maximum 100 templates'); return; } let n = tasks.length + 1; while (tasks.some(t => t.id === `task-${n}`)) n++; onChange([...tasks, { id: `task-${n}`, title: 'Participant task', question: 'Would you like to volunteer?', notificationBody: 'Your response is needed.', groupIds: [], durationMs: 60000, options: [{ id: 'yes', label: 'Yes', capacity: 2, message: 'You have a place. Wait for instructions.' }, { id: 'no', label: 'No', message: 'Thank you.' }], fullMessage: 'This option is full. Choose another available option.' }]); }}>Add task template</button>
  </fieldset>;
}
