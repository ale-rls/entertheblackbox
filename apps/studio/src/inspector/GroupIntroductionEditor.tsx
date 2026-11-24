import { assignRestSchema, type AssignRest, type GroupIntroduction } from '@entertheblackbox/scenario';

type Group = { id: string; label: string; introduction?: GroupIntroduction | undefined };
type Media = { src: string; durationMs?: number };

/** Per-group introduction: played to a tablet whenever it is moved into the group. */
export function GroupIntroductionEditor({ group, media, onChange }: { group: Group; media: Media[]; onChange: (introduction: GroupIntroduction | undefined) => void }) {
  const value = group.introduction;
  const mp3 = media.filter(file => /\.mp3$/i.test(file.src));
  return <fieldset><legend>Introduction on assignment <small>introduction</small></legend>
    <label className="sc-tool-checkbox"><input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked ? { notificationBody: `Du bist jetzt: ${group.label}`, text: group.label } : undefined)} />Play an introduction when someone is moved into {group.label}</label>
    {value && <>
      <label className="sc-tool-label"><span>Notification<small>notificationBody</small></span><input className="sc-tool-field" maxLength={200} value={value.notificationBody} onChange={e => onChange({ ...value, notificationBody: e.target.value })} /></label>
      <label className="sc-tool-label"><span>Tablet text<small>text</small></span><textarea className="sc-tool-field" maxLength={2000} value={value.text} onChange={e => onChange({ ...value, text: e.target.value })} /></label>
      <label className="sc-tool-label"><span>Recording<small>audio</small></span><select className="sc-tool-select" value={value.audio?.src ?? ''} onChange={e => {
        const { audio: _, ...rest } = value;
        const file = mp3.find(f => f.src === e.target.value);
        onChange(file?.durationMs ? { ...rest, audio: { src: file.src, durationMs: Math.round(file.durationMs) } } : rest);
      }}>
        <option value="">No recording</option>
        {value.audio && !mp3.some(f => f.src === value.audio!.src) && <option value={value.audio.src}>{value.audio.src} (missing)</option>}
        {mp3.map(f => <option key={f.src} value={f.src} disabled={!f.durationMs}>{f.src}{f.durationMs ? '' : ' (length unknown)'}</option>)}
      </select></label>
      {(!value.notificationBody.trim() || !value.text.trim()) && <p className="field-error" role="alert">Notification and tablet text are required.</p>}
      <p className="sc-tool-copy field-hint">Moving someone between parts plays the new part's introduction again. Without a recording the text shows for 15 seconds.</p>
    </>}
  </fieldset>;
}

/** Admin → Devices "Assign rest": leads by hand, the rest drawn at random. */
export function AssignRestEditor({ config, groups, onChange }: { config: AssignRest | undefined; groups: Group[]; onChange: (config: AssignRest | undefined) => void }) {
  const select = (value: string, change: (id: string) => void) => <select className="sc-tool-select" value={value} onChange={e => change(e.target.value)}>
    {!groups.some(g => g.id === value) && <option value={value}>{value} (missing)</option>}
    {groups.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
  </select>;
  const first = groups[0]?.id ?? '';
  return <fieldset><legend>Assign rest <small>assignRest</small></legend>
    <label className="sc-tool-checkbox"><input type="checkbox" checked={!!config} disabled={groups.length < 2} onChange={e => onChange(e.target.checked ? { fromGroupId: first, leadGroupIds: [], fill: [], restGroupId: groups[1]?.id ?? first } : undefined)} />Show an Assign rest button in Admin → Devices</label>
    {config && <>
      <label className="sc-tool-label"><span>Draw everyone still in<small>fromGroupId</small></span>{select(config.fromGroupId, fromGroupId => onChange({ ...config, fromGroupId }))}</label>
      <div className="sc-tool-label"><span>Leads, picked by hand<small>leadGroupIds</small></span>
        {groups.map(g => <label key={g.id} className="sc-tool-checkbox"><input type="checkbox" checked={config.leadGroupIds.includes(g.id)} onChange={e => onChange({ ...config, leadGroupIds: e.target.checked ? [...config.leadGroupIds, g.id] : config.leadGroupIds.filter(id => id !== g.id) })} />{g.label}</label>)}
      </div>
      {config.fill.map((fill, index) => <div key={index} className="sc-tool-label"><span>Fill first<small>fill[{index}]</small></span>
        {select(fill.groupId, groupId => onChange({ ...config, fill: config.fill.map((f, i) => i === index ? { ...f, groupId } : f) }))}
        <label>Min<input className="sc-tool-field" type="number" min="0" value={fill.min} onChange={e => onChange({ ...config, fill: config.fill.map((f, i) => i === index ? { ...f, min: Math.max(0, Math.round(Number(e.target.value))) } : f) })} /></label>
        <label>Max<input className="sc-tool-field" type="number" min="1" value={fill.max} onChange={e => onChange({ ...config, fill: config.fill.map((f, i) => i === index ? { ...f, max: Math.max(1, Math.round(Number(e.target.value))) } : f) })} /></label>
        <label>Share (%)<input className="sc-tool-field" type="number" min="1" max="100" value={Math.round(fill.share * 100)} onChange={e => onChange({ ...config, fill: config.fill.map((f, i) => i === index ? { ...f, share: Math.min(1, Math.max(0.01, Number(e.target.value) / 100)) } : f) })} /></label>
        <button className="sc-tool-button" type="button" onClick={() => onChange({ ...config, fill: config.fill.filter((_, i) => i !== index) })}>Remove</button>
      </div>)}
      <button className="sc-tool-button" type="button" disabled={config.fill.length >= 10} onClick={() => onChange({ ...config, fill: [...config.fill, { groupId: first, min: 2, max: 4, share: 1 / 3 }] })}>Add a group to fill first</button>
      <label className="sc-tool-label"><span>Everyone else goes to<small>restGroupId</small></span>{select(config.restGroupId, restGroupId => onChange({ ...config, restGroupId }))}</label>
      {!assignRestSchema.safeParse(config).success && <p className="field-error" role="alert">Each fill group needs min ≤ max.</p>}
      <p className="sc-tool-copy field-hint">Each fill group gets about its share of everyone drawn plus those already in a drawn group, held between min and max. Pressing again later only places people who are still unassigned.</p>
    </>}
  </fieldset>;
}
