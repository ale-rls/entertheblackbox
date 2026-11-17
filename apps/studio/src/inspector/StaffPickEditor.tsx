import type { ParticipantRole, StaffAssignment } from '@entertheblackbox/scenario';

type Group = { id: string; label: string };

/** Picks for the PIN-protected staff menu on native tablets (the PIN itself is the server's STAFF_PIN). */
export function StaffPickEditor({ picks, roles, groups, onChange }: { picks: StaffAssignment[]; roles: ParticipantRole[]; groups: Group[]; onChange: (picks: StaffAssignment[]) => void }) {
  const update = (index: number, pick: StaffAssignment) => onChange(picks.map((p, i) => i === index ? pick : p));
  const set = (pick: StaffAssignment, key: 'roleId' | 'groupId', value: string): StaffAssignment => {
    const { [key]: _, ...rest } = pick;
    return (value ? { ...rest, [key]: value } : rest) as StaffAssignment;
  };
  return <fieldset><legend>Staff menu picks <small>staffAssignments</small></legend>
    <p>Staff hold the top-right corner of a tablet for a few seconds and enter the venue PIN (server setting STAFF_PIN). Each pick gives that tablet's holder a role, a group, or both. A role replaces any role the holder has in the same exclusive set.</p>
    {picks.map((pick, i) => <fieldset key={i}><legend>{pick.label}</legend>
      <label>ID<input value={pick.id} onChange={e => update(i, { ...pick, id: e.target.value })} /></label>
      <label>Label<input value={pick.label} onChange={e => update(i, { ...pick, label: e.target.value })} /></label>
      <label>Role<select value={pick.roleId ?? ''} onChange={e => update(i, set(pick, 'roleId', e.target.value))}><option value="">No role</option>{roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
      <label>Group<select value={pick.groupId ?? ''} onChange={e => update(i, set(pick, 'groupId', e.target.value))}><option value="">Keep group</option>{groups.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
      {!pick.roleId && !pick.groupId && <p role="alert">Choose a role or a group.</p>}
      <button type="button" onClick={() => onChange(picks.filter((_, j) => j !== i))}>Remove pick</button>
    </fieldset>)}
    <button type="button" onClick={() => { let n = picks.length + 1; while (picks.some(p => p.id === `pick-${n}`)) n++; onChange([...picks, { id: `pick-${n}`, label: 'New pick', ...(groups[0] ? { groupId: groups[0].id } : {}) }]); }}>Add pick</button>
  </fieldset>;
}
