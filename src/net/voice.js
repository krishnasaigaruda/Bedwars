// Voice chat for online games. Players only have a connection to the host,
// so the host is the hub: a player who joins calls the host with their
// microphone, and the host answers with one stream of everyone else's voices
// mixed together (Web Audio). The host also tells everyone who is in the
// group, who is muted and who is talking.
//
// Client -> host: a PeerJS call (metadata { voice, muted }), vmute
// Host -> everyone: voice { members: [[id, muted]], talking: [id] }

const MIC = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const TALK_LEVEL = 0.012;   // loudness (RMS) that counts as talking
const TALK_HOLD = 450;      // ms a speaker stays lit after going quiet

// Your microphone, or a reason there isn't one.
async function openMic() {
  if (!navigator.mediaDevices?.getUserMedia) return { stream: null, why: window.isSecureContext ? 'nomic' : 'insecure' };
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: MIC, video: false }), why: null };
  } catch (e) {
    return { stream: null, why: e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'blocked' : 'nomic' };
  }
}

// Sound comes out through an <audio> element: the browser's echo cancelling
// only knows about sound played that way.
function speaker(stream, volume) {
  const a = new Audio();
  a.autoplay = true;
  a.srcObject = stream;
  a.volume = volume;
  a.play().catch(() => {});
  return a;
}

// ---------------------------------------------------------------- host

export class VoiceHub {
  constructor(session) {
    this.session = session;
    this.ctx = null;
    this.members = new Map();   // id -> { id, muted, call, out, src, input, analyser, keep, talkAt }
    this.talking = new Set();
    this.joined = false;
    this.muted = false;
    this.listenOnly = false;
    this.volume = 1;
    this.buf = new Float32Array(512);
  }

  audio() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.timer = setInterval(() => this.levels(), 120);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  // A player joining: answer with a mix of everyone else.
  answer(call) {
    const id = call.peer;
    if (!this.session.links.has(id)) { call.close(); return; }
    this.drop(id, true);   // joining again replaces the old call
    const m = { id, muted: !!call.metadata?.muted, call, out: this.audio().createMediaStreamDestination() };
    this.add(m);
    call.answer(m.out.stream);
    call.on('stream', (stream) => this.setInput(m, stream));
    const gone = () => { if (this.members.get(id) === m) this.drop(id); };
    call.on('close', gone);
    call.on('error', gone);
  }

  add(m) {
    this.members.set(m.id, m);
    for (const o of this.members.values()) if (o !== m && o.input) o.input.connect(m.out);
    this.changed();
  }

  setInput(m, stream) {
    if (m.input || this.members.get(m.id) !== m) return;   // PeerJS can report the same stream twice
    const ctx = this.audio();
    if (m.call) {
      // Chrome only lets Web Audio hear a call's sound while it's also playing somewhere.
      m.keep = new Audio();
      m.keep.muted = true;
      m.keep.srcObject = stream;
      m.keep.play().catch(() => {});
    }
    m.src = ctx.createMediaStreamSource(stream);
    m.input = ctx.createGain();
    m.analyser = ctx.createAnalyser();
    m.analyser.fftSize = this.buf.length;
    m.src.connect(m.input);
    m.input.connect(m.analyser);
    for (const o of this.members.values()) if (o !== m) m.input.connect(o.out);
  }

  drop(id, quiet = false) {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    this.talking.delete(id);
    try { m.src?.disconnect(); m.input?.disconnect(); } catch { /* already gone */ }
    if (m.keep) m.keep.srcObject = null;
    try { m.call?.close(); } catch { /* already closed */ }
    if (!quiet) this.changed();
  }

  // The host joining the group themselves.
  async join() {
    if (this.joined) return { why: null };
    const ctx = this.audio();
    const { stream, why } = await openMic();
    this.mic = stream;
    this.listenOnly = !stream;
    if (this.listenOnly) this.muted = true;
    const m = { id: this.session.myId, muted: this.muted, call: null, out: ctx.createMediaStreamDestination() };
    this.speaker = speaker(m.out.stream, this.volume);
    this.joined = true;
    this.add(m);
    if (stream) { this.setInput(m, stream); this.setMuted(this.muted); }
    return { why };
  }

  leave() {
    if (!this.joined) return;
    this.joined = false;
    this.drop(this.session.myId);
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    if (this.speaker) this.speaker.srcObject = null;
    this.speaker = null;
  }

  setMuted(on) {
    this.muted = on || this.listenOnly;
    this.mic?.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
    this.setMemberMuted(this.session.myId, this.muted);
  }

  setMemberMuted(id, on) {
    const m = this.members.get(id);
    if (!m || m.muted === !!on) return;
    m.muted = !!on;
    this.changed();
  }

  setVolume(v) {
    this.volume = v;
    if (this.speaker) this.speaker.volume = v;
  }

  // Who's talking, from how loud each voice is.
  levels() {
    const now = performance.now();
    let changed = false;
    for (const m of this.members.values()) {
      if (!m.analyser) continue;
      m.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (const x of this.buf) sum += x * x;
      if (!m.muted && Math.sqrt(sum / this.buf.length) > TALK_LEVEL) m.talkAt = now;
      const talking = now - (m.talkAt ?? -1e9) < TALK_HOLD;
      if (talking !== this.talking.has(m.id)) {
        if (talking) this.talking.add(m.id); else this.talking.delete(m.id);
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  changed() {
    const msg = { t: 'voice', members: [...this.members.values()].map((m) => [m.id, m.muted ? 1 : 0]), talking: [...this.talking] };
    this.session.broadcast(msg);
    this.session.onMessage(msg);
  }

  close() {
    this.leave();
    for (const id of [...this.members.keys()]) this.drop(id, true);
    clearInterval(this.timer);
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

// ---------------------------------------------------------------- player

export class VoiceCall {
  constructor(session) {
    this.session = session;
    this.joined = false;
    this.muted = false;
    this.listenOnly = false;
    this.volume = 1;
  }

  async join() {
    if (this.joined) return { why: null };
    const { stream, why } = await openMic();
    this.listenOnly = !stream;
    if (this.listenOnly) {
      // No microphone: call with silence so you can still listen.
      this.silence = new AudioContext();
      this.mic = this.silence.createMediaStreamDestination().stream;
      this.muted = true;
    } else this.mic = stream;
    this.mic.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
    const call = this.session.peer.call(this.session.link.id, this.mic, { metadata: { voice: 1, muted: this.muted } });
    if (!call) { this.stop(); return { why: 'failed' }; }
    this.call = call;
    this.joined = true;
    call.on('stream', (remote) => {
      if (this.call !== call) return;
      if (this.speaker) this.speaker.srcObject = remote;
      else this.speaker = speaker(remote, this.volume);
    });
    const gone = () => { if (this.call === call) { this.stop(); this.session.onMessage({ t: 'voiceLost' }); } };
    call.on('close', gone);
    call.on('error', gone);
    return { why };
  }

  leave() {
    if (!this.joined) return;
    const call = this.call;
    this.stop();
    try { call?.close(); } catch { /* already closed */ }
  }

  stop() {
    this.joined = false;
    this.call = null;
    if (!this.listenOnly) this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.silence?.close().catch(() => {});
    this.silence = null;
    if (this.speaker) this.speaker.srcObject = null;
    this.speaker = null;
  }

  setMuted(on) {
    this.muted = on || this.listenOnly;
    this.mic?.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
    this.session.link.send({ t: 'vmute', muted: this.muted });
  }

  setVolume(v) {
    this.volume = v;
    if (this.speaker) this.speaker.volume = v;
  }

  close() { this.leave(); }
}
