const audio = document.querySelector('#audio');
const status = document.querySelector('#status');
const start = document.querySelector('#start');
const stop = document.querySelector('#stop');
let active;

function describe(message) { status.textContent = message; }

async function disconnect() {
  const state = active;
  active = undefined;
  if (state) {
    clearInterval(state.keepalive);
    state.abort.abort();
    state.pc.close();
    if (state.session) {
      // Best effort cleanup; Janus also expires abandoned sessions.
      void fetch(`/janus/${state.session}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ janus: 'destroy', transaction: crypto.randomUUID() }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
    }
  }
  audio.pause();
  audio.srcObject = null;
  start.disabled = false;
  stop.disabled = true;
}

async function connect(pin) {
  await disconnect();
  if (!window.isSecureContext || !window.RTCPeerConnection) {
    describe('Use HTTPS on phones (or localhost on this computer) for this test.');
    return;
  }
  const state = {
    abort: new AbortController(), pc: new RTCPeerConnection({ iceServers: [] }),
    session: null, handle: null, candidates: [], keepalive: null,
  };
  active = state;
  start.disabled = true;
  stop.disabled = false;
  describe('Connecting…');

  const fail = async (error) => {
    if (active !== state) return;
    await disconnect();
    describe(`Disconnected: ${error.message}. Tap Connect to retry.`);
  };
  const request = async (path, payload) => {
    const response = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, transaction: crypto.randomUUID() }),
      signal: AbortSignal.any([state.abort.signal, AbortSignal.timeout(15000)]),
    });
    if (!response.ok) throw new Error(`Signaling HTTP ${response.status}`);
    const data = await response.json();
    if (data.janus === 'error') throw new Error(data.error?.reason || 'Janus error');
    return data;
  };
  const send = (payload) => request(`/janus/${state.session}/${state.handle}`, payload);

  state.pc.ontrack = ({ track }) => {
    if (active !== state) return;
    audio.srcObject = new MediaStream([track]);
    void audio.play().catch(() => {
      if (active === state) describe('Audio ready. Tap Play in the audio controls.');
    });
  };
  state.pc.onicecandidate = ({ candidate }) => {
    if (active === state && state.handle) {
      void send({ janus: 'trickle', candidate: candidate?.toJSON() || { completed: true } }).catch(fail);
    }
  };
  state.pc.onconnectionstatechange = () => {
    if (active !== state) return;
    const value = state.pc.connectionState;
    if (value === 'failed') void fail(new Error('Media connection failed'));
    else if (value === 'connected') describe('Media connected. Confirm that you hear the feed; tap Play if needed.');
    else if (value === 'disconnected') describe('Media interrupted. Waiting for network recovery…');
  };

  const event = async (data) => {
    if (data.janus === 'error') throw new Error(data.error?.reason || 'Janus error');
    if (['timeout', 'destroyed', 'detached', 'hangup'].includes(data.janus)) {
      throw new Error(data.reason || `Janus ${data.janus}`);
    }
    if (data.plugindata?.data?.error) throw new Error(data.plugindata.data.error);
    if (data.janus === 'trickle') {
      const candidate = data.candidate?.completed ? null : data.candidate;
      if (state.pc.remoteDescription) await state.pc.addIceCandidate(candidate);
      else state.candidates.push(candidate);
    }
    if (data.jsep) {
      await state.pc.setRemoteDescription(data.jsep);
      for (const candidate of state.candidates.splice(0)) await state.pc.addIceCandidate(candidate);
      const answer = await state.pc.createAnswer();
      await state.pc.setLocalDescription(answer);
      await send({ janus: 'message', body: { request: 'start' }, jsep: answer });
    }
  };
  const poll = async () => {
    while (active === state) {
      const response = await fetch(`/janus/${state.session}?rid=${Date.now()}&maxev=10`, {
        cache: 'no-store', signal: state.abort.signal,
      });
      if (!response.ok) throw new Error(`Event stream HTTP ${response.status}`);
      const data = await response.json();
      for (const item of Array.isArray(data) ? data : [data]) {
        if (active !== state) return;
        await event(item);
      }
    }
  };
  try {
    const session = await request('/janus', { janus: 'create' });
    state.session = session.data.id;
    const handle = await request(`/janus/${state.session}`, {
      janus: 'attach', plugin: 'janus.plugin.streaming',
    });
    state.handle = handle.data.id;
    state.keepalive = setInterval(() => {
      void request(`/janus/${state.session}`, { janus: 'keepalive' }).catch(fail);
    }, 25000);
    void poll().catch(fail);
    await event(await send({ janus: 'message', body: { request: 'watch', id: 1, pin } }));
  } catch (error) { await fail(error); }
}

document.querySelector('#connect').addEventListener('submit', (event) => {
  event.preventDefault();
  void connect(document.querySelector('#pin').value);
});
stop.addEventListener('click', async () => { await disconnect(); describe('Disconnected'); });
window.addEventListener('pagehide', () => { void disconnect(); });
