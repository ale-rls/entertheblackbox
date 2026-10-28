import type { ServerToClientMessage } from '@entertheblackbox/protocol';
import type { Snapshot } from './cues';
export type Voting = Extract<ServerToClientMessage, { t: 'voting_options' }>;
export type Groups = Extract<ServerToClientMessage, { t: 'group_selection_options' }>;
export type ActionPrompt = { key: string; body: string };
export function actionPrompt(s: Snapshot | null, voting: Voting | null, groups: Groups | null, now: number): ActionPrompt | null {
  if (!s || s.participantState === 'finished' || s.participantState === 'unassigned') return null;
  const p = s.phase;
  if (now < p.startedAt || (p.deadlineAt !== null && now >= p.deadlineAt)) return null;
  const key = `${s.sessionId}:${s.routingEpoch ?? 0}:${s.phaseEpoch}`;
  const matches = (m: Voting | Groups) => m.sessionId === s.sessionId && m.phaseEpoch === s.phaseEpoch;
  if (groups && matches(groups) && !groups.selectedGroupId)
    return { key: `${key}:group`, body: 'Open the app to choose your group.' };
  if (voting && matches(voting) && !voting.closed && voting.method !== 'physical')
    return { key: `${key}:vote`, body: voting.method === 'phone-buttons' ? 'Open the app to choose your answer.' : 'Open the app to move your cursor and answer.' };
  const rating = 'rating' in p ? p.rating : null;
  if (rating) {
    const index = rating.windows ? rating.windows.findIndex(w => now - p.startedAt >= w.startAtMs && now - p.startedAt < w.endAtMs) : 0;
    if (index >= 0) return { key: `${key}:rating:${index}`, body: 'Open the app to send your reaction.' };
  }
  return null;
}

/** Serializes OS work; a phase change during an async delivery removes the stale alert. */
export class ActionAlerts {
  private revision = 0;
  private desired: string | null = null;
  private delivered: string | null = null;
  private seen = new Set<string>();
  private pending: Promise<void> = Promise.resolve();
  constructor(private show: (prompt: ActionPrompt) => Promise<string>, private dismiss: (id: string) => Promise<void>, private failed: () => void) {}
  update(prompt: ActionPrompt | null) {
    if ((prompt?.key ?? null) === this.desired) return;
    this.desired = prompt?.key ?? null;
    const revision = ++this.revision;
    this.pending = this.pending.then(async () => {
      if (this.delivered) { await this.dismiss(this.delivered); this.delivered = null; }
      if (revision !== this.revision || !prompt || this.seen.has(prompt.key)) return;
      const id = await this.show(prompt);
      this.delivered = id;
      this.seen.add(prompt.key);
      if (revision !== this.revision) { await this.dismiss(id); this.delivered = null; }
    }).catch(this.failed);
  }
  settled() { return this.pending; }
}
