import type { PlaybackState } from './audio-playback';
import { AudioProgress } from './audio-progress';

export type JanusFeed = { server: string; mountpoint: number; pin: string; iceServers: RTCIceServer[] };
export function parseJanusFeed(value: unknown): JanusFeed {
  const feed = value as Partial<JanusFeed> | null;
  if (!feed || typeof feed.server !== 'string' || !/^https?:\/\//.test(feed.server)
      || !Number.isSafeInteger(feed.mountpoint) || (feed.mountpoint ?? 0) < 1 || typeof feed.pin !== 'string'
      || !Array.isArray(feed.iceServers)) throw new Error('Headphone audio unavailable. Retrying…');
  return feed as JanusFeed;
}

type Session = { abort: AbortController; pc: RTCPeerConnection; id?: number; handle?: number;
  candidates: (RTCIceCandidateInit | null)[]; feed: JanusFeed };

/** Same phone controls, with a persistent receive-only WebRTC transport. */
export class JanusPlayback {
  state: PlaybackState = 'ready';
  private wanted = false;
  private suspended = false;
  private disposed = false;
  private session: Session | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval>;
  private keepalive: ReturnType<typeof setInterval> | undefined;
  private attempts = 0;
  private everPlayed = false;
  private progress = new AudioProgress();
  private generation = 0;
  private connecting = false;
  private readonly handlers: Record<string, () => void>;

  constructor(private audio: HTMLAudioElement, private url: string,
    private changed: (state: PlaybackState) => void, private refresh: () => Promise<JanusFeed>) {
    this.handlers = {
      timeupdate: () => this.observe(),
      playing: () => { if (this.wanted && !this.suspended) this.observe(); },
      pause: () => { if (this.wanted && !this.suspended) this.schedule(); },
      error: () => this.schedule(), ended: () => this.schedule(),
    };
    for (const [event, handler] of Object.entries(this.handlers)) audio.addEventListener(event, handler);
    this.progress.reset(audio.currentTime);
    this.watchdog = setInterval(this.check, 2000);
  }
  private setState(state: PlaybackState) {
    if (this.disposed || this.state === state) return;
    this.state = state;
    this.changed(state);
  }
  private valid(session: Session) { return !this.disposed && this.session === session; }
  private async post(session: Session, path: string, payload: object) {
    const response = await fetch(session.feed.server.replace(/\/$/, '') + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, transaction: crypto.randomUUID() }),
      signal: AbortSignal.any([session.abort.signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) throw new Error(`Janus HTTP ${response.status}`);
    const data = await response.json();
    if (data.janus === 'error') throw new Error('Janus signaling failed');
    return data;
  }
  private send(session: Session, payload: object) { return this.post(session, `/${session.id}/${session.handle}`, payload); }
  private teardown() {
    clearInterval(this.keepalive);
    const session = this.session;
    this.session = undefined;
    this.connecting = false;
    if (session) {
      session.abort.abort();
      session.pc.close();
      if (session.id) void fetch(`${session.feed.server.replace(/\/$/, '')}/${session.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ janus: 'destroy', transaction: crypto.randomUUID() }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
    }
    this.audio.srcObject = null;
  }
  private async resume(session: Session) {
    if (!this.valid(session) || !this.wanted || this.suspended) return;
    try { await this.audio.play(); }
    catch (error) {
      if (!this.valid(session) || !this.wanted || this.suspended) return;
      if ((error as { name?: string })?.name === 'NotAllowedError') {
        this.wanted = false;
        clearTimeout(this.retry); this.retry = undefined;
        this.setState('blocked');
      } else this.schedule();
    }
  }
  private async connect(recover: boolean) {
    if (!this.wanted || this.suspended || this.disposed) return;
    clearTimeout(this.retry); this.retry = undefined;
    this.teardown();
    const generation = ++this.generation;
    this.connecting = true;
    this.progress.reset(this.audio.currentTime);
    this.setState(this.everPlayed || recover ? 'reconnecting' : 'connecting');
    try {
      const feed = recover ? await this.refresh() : parseJanusFeed(JSON.parse(this.url));
      if (generation !== this.generation || !this.wanted || this.suspended || this.disposed) return;
      this.url = JSON.stringify(feed);
      const session: Session = { feed, pc: new RTCPeerConnection({ iceServers: feed.iceServers }), abort: new AbortController(), candidates: [] };
      this.session = session;
      const fail = () => { if (this.valid(session)) this.schedule(); };
      session.pc.ontrack = ({ track }) => {
        if (!this.valid(session)) return;
        this.audio.srcObject = new MediaStream([track]);
        track.onended = fail;
        void this.resume(session);
      };
      session.pc.onicecandidate = ({ candidate }) => {
        if (this.valid(session) && session.handle) void this.send(session, {
          janus: 'trickle', candidate: candidate?.toJSON() ?? { completed: true },
        }).catch(fail);
      };
      session.pc.onconnectionstatechange = () => {
        if (!this.valid(session)) return;
        if (session.pc.connectionState === 'failed' || session.pc.connectionState === 'closed') fail();
        // A brief disconnection can heal without losing the playing session.
        else if (session.pc.connectionState === 'disconnected' && this.wanted) this.setState('reconnecting');
      };
      session.id = (await this.post(session, '', { janus: 'create' })).data.id;
      if (!this.valid(session)) return;
      session.handle = (await this.post(session, `/${session.id}`, { janus: 'attach', plugin: 'janus.plugin.streaming' })).data.id;
      if (!this.valid(session)) return;
      this.keepalive = setInterval(() => {
        if (this.valid(session)) void this.post(session, `/${session.id}`, { janus: 'keepalive' }).catch(fail);
      }, 25_000);
      void this.poll(session).catch(fail);
      await this.event(session, await this.send(session, { janus: 'message', body: { request: 'watch', id: feed.mountpoint, pin: feed.pin } }));
    } catch {
      if (generation === this.generation && !this.disposed) { this.connecting = false; this.schedule(); }
    }
  }
  private async event(session: Session, data: any): Promise<void> {
    if (!this.valid(session)) return;
    if (['error', 'timeout', 'destroyed', 'detached', 'hangup'].includes(data.janus) || data.plugindata?.data?.error) {
      throw new Error('Janus session ended');
    }
    if (data.janus === 'trickle') {
      const candidate = data.candidate?.completed ? null : data.candidate;
      if (session.pc.remoteDescription) await session.pc.addIceCandidate(candidate);
      else session.candidates.push(candidate);
    }
    if (data.jsep) {
      await session.pc.setRemoteDescription(data.jsep);
      if (!this.valid(session)) return;
      for (const candidate of session.candidates.splice(0)) await session.pc.addIceCandidate(candidate);
      const answer = await session.pc.createAnswer();
      if (!this.valid(session)) return;
      await session.pc.setLocalDescription(answer);
      if (!this.valid(session)) return;
      await this.send(session, { janus: 'message', body: { request: 'start' }, jsep: answer });
      this.connecting = false;
    }
  }
  private async poll(session: Session) {
    while (this.valid(session)) {
      const response = await fetch(`${session.feed.server.replace(/\/$/, '')}/${session.id}?rid=${Date.now()}&maxev=10`, {
        cache: 'no-store', signal: session.abort.signal,
      });
      if (!response.ok) throw new Error('Janus event stream interrupted');
      const data = await response.json();
      for (const item of Array.isArray(data) ? data : [data]) await this.event(session, item);
    }
  }
  private observe() {
    if (!this.wanted || this.suspended || !this.session || this.audio.paused) return false;
    if (!this.progress.advanced(this.audio.currentTime)) return false;
    this.everPlayed = true;
    this.attempts = 0;
    clearTimeout(this.retry); this.retry = undefined;
    this.setState('playing');
    return true;
  }
  private schedule() {
    if (!this.wanted || this.suspended || this.disposed || this.retry !== undefined) return;
    this.setState('reconnecting');
    this.retry = setTimeout(() => { this.retry = undefined; void this.connect(true); }, Math.min(8000, 500 * 2 ** Math.min(this.attempts++, 4)));
  }
  check = () => {
    if (!this.wanted || this.suspended || this.disposed || this.observe()) return;
    if (this.progress.stalled(this.audio.currentTime, undefined, this.everPlayed ? 5000 : 15000)) this.schedule();
  };
  play = () => {
    if (this.disposed) return;
    this.wanted = true;
    if (this.suspended) return;
    if (this.session && this.session.pc.connectionState !== 'failed' && this.session.pc.connectionState !== 'closed') {
      this.progress.reset(this.audio.currentTime);
      void this.resume(this.session);
    } else if (!this.connecting) void this.connect(this.everPlayed);
  };
  pause = () => {
    this.wanted = false;
    ++this.generation;
    clearTimeout(this.retry); this.retry = undefined;
    this.teardown();
    this.audio.pause();
    this.setState('paused');
  };
  setSuspended(suspended: boolean) {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    if (suspended) {
      ++this.generation;
      clearTimeout(this.retry); this.retry = undefined;
      this.teardown(); this.audio.pause();
    } else if (this.wanted) void this.connect(this.everPlayed);
  }
  setUrl(url: string) {
    if (url === this.url || this.disposed) return;
    this.url = url;
    if (this.wanted && !this.suspended) void this.connect(false);
  }
  foreground = () => {
    if (!this.wanted || this.suspended || this.disposed) return;
    this.progress.reset(this.audio.currentTime);
    if (!this.session || ['failed', 'closed', 'disconnected'].includes(this.session.pc.connectionState)) this.schedule();
    else if (this.audio.paused) void this.resume(this.session);
  };
  online = () => { if (this.wanted && !this.suspended && !this.disposed) this.schedule(); };
  dispose() {
    this.disposed = true; this.wanted = false; ++this.generation;
    clearTimeout(this.retry); clearInterval(this.watchdog);
    for (const [event, handler] of Object.entries(this.handlers)) this.audio.removeEventListener(event, handler);
    this.teardown(); this.audio.pause();
  }
}
