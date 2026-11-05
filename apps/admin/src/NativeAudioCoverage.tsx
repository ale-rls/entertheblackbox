import { useState } from 'react';
type Report = { scenarioVersion: string; checkedAt: number; background: string; rows: { phaseId: string; group: string; src: string | null; state: string }[] };
export function NativeAudioCoverage({ token }: { token: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function audit() {
    setBusy(true); setError(''); setReport(null);
    try {
      const response = await fetch('/api/admin/audio/native-coverage', { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`Audio audit unavailable (${response.status})`);
      setReport(await response.json());
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  return <section className="sc-tool-panel">
    <h2>Phone audio coverage</h2>
    <p>Check every scene and group against the published phone download. “No audio assigned” can be intentional; it means that scene has no foreground phone audio. Verified files do not prove headphone output.</p>
    <button className="sc-tool-button" disabled={busy} onClick={() => void audit()}>{busy ? 'Checking audio…' : 'Check all phone audio'}</button>
    {error && <p role="alert">{error}</p>}
    {report && <>
      <p>Show {report.scenarioVersion} · Checked {new Date(report.checkedAt).toLocaleTimeString()} · Background: {report.background}</p>
      <p>{report.rows.filter(r => r.state === 'Verified').length} verified assignments · {report.rows.filter(r => r.state === 'No audio assigned').length} without audio · {report.rows.filter(r => !['Verified', 'No audio assigned'].includes(r.state)).length} broken assignments</p>
      <div className="clock-table-scroll"><table><thead><tr><th>Scene</th><th>Group</th><th>Audio</th><th>Source</th></tr></thead><tbody>
        {report.rows.map(row => <tr key={`${row.phaseId}:${row.group}`}><td>{row.phaseId}</td><td>{row.group}</td><td>{row.state}</td><td>{row.src ?? '—'}</td></tr>)}
      </tbody></table></div>
    </>}
  </section>;
}
