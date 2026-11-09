import { admissionConfigSchema, type Scenario, type AdmissionProgram } from '@entertheblackbox/scenario';
export function AdmissionEditor({ config, groups, sources, onChange }: { config: Scenario['admission']; groups: { id: string; label: string }[]; sources: string[]; onChange: (value: Scenario['admission']) => void }) {
  function update(index: number, path: AdmissionProgram) { if (config) onChange({ ...config, paths: config.paths.map((p,i) => i === index ? path : p) }); }
  return <fieldset><legend>Admission programs</legend><p>Each participant starts their own intro, then repeats the waiting playlist until show start. A blank audio choice is timed silence. Requires the admission-capable native build.</p>
    <label><input type="checkbox" checked={!!config} disabled={!groups.length} onChange={e => onChange(e.target.checked ? { assignment: 'self-select', paths: [{ groupId: groups[0]!.id, intro: [], loop: [{ durationMs: 60000 }] }] } : undefined)} />Enable admission audio</label>
    {!groups.length && <p>Create an audience group first.</p>}
    {config && <><label>Group assignment<select value={config.assignment} onChange={e => onChange({ ...config, assignment: e.target.value as 'operator' | 'self-select' })}><option value="self-select">Participant chooses</option><option value="operator">Operator assigns</option></select></label>
      {config.paths.map((path,index) => <fieldset key={index}><legend>Admission path {index+1}</legend><label>Audience<select value={path.groupId} onChange={e => update(index,{ ...path,groupId:e.target.value })}>{groups.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
        {(['intro','loop'] as const).map(section => <fieldset key={section}><legend>{section === 'intro' ? 'One-time intro' : 'Repeating playlist'}</legend>{path[section].map((step,si) => <div key={si}>
          <label>Audio<select value={step.src ?? ''} onChange={e => update(index,{ ...path,[section]: path[section].map((v,i) => i !== si ? v : { durationMs:v.durationMs,...(e.target.value ? { src:e.target.value } : {}) }) })}><option value="">Silence</option>{step.src && !sources.includes(step.src) && <option value={step.src}>{step.src} (missing)</option>}{sources.map(src => <option key={src} value={src}>{src}</option>)}</select></label>
          <label>Duration (seconds)<input type="number" min="0.1" step="0.1" value={step.durationMs/1000} onChange={e => update(index,{ ...path,[section]: path[section].map((v,i) => i === si ? {...v,durationMs:Number(e.target.value)*1000} : v) })} /></label>
          <button type="button" disabled={section === 'loop' && path.loop.length === 1} onClick={() => update(index,{ ...path,[section]:path[section].filter((_,i) => i !== si) })}>Remove step</button>
        </div>)}<button type="button" disabled={path[section].length >= 16} onClick={() => update(index,{ ...path,[section]:[...path[section],{durationMs:10000}] })}>Add {section} step</button></fieldset>)}
        <button type="button" disabled={config.paths.length === 1} onClick={() => onChange({...config,paths:config.paths.filter((_,i) => i !== index)})}>Remove path</button>
      </fieldset>)}
      <button type="button" disabled={config.paths.length >= groups.length} onClick={() => {const group=groups.find(g => !config.paths.some(p => p.groupId===g.id));if(group)onChange({...config,paths:[...config.paths,{groupId:group.id,intro:[],loop:[{durationMs:60000}]}]});}}>Add audience path</button>
      {!admissionConfigSchema.safeParse(config).success && <p role="alert">Use unique audience paths and positive step durations. Each path needs a waiting loop.</p>}
    </>}
  </fieldset>;
}
