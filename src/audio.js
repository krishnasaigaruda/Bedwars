// Tiny WebAudio synth: every sound effect is generated, no audio files.

let ctx = null, master = null, noiseBuf = null;
let volume = 0.6;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export function unlockAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
}

function noise(dur, freq, q, gain, type = 'bandpass') {
  const c = ensure(); if (!c) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.3, dur + 0.05);
}

function tone(freq, dur, type, gain, slideTo = null, delay = 0) {
  const c = ensure(); if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const SOUNDS = {
  place: () => { noise(0.08, 700, 1.2, 0.5); tone(160, 0.07, 'triangle', 0.15, 90); },
  dig: () => noise(0.05, 1200 + Math.random() * 600, 1.5, 0.18),
  break: () => { noise(0.16, 900, 0.9, 0.6); tone(220, 0.1, 'triangle', 0.12, 110); },
  step: () => noise(0.04, 500 + Math.random() * 300, 2, 0.06),
  land: () => noise(0.09, 300, 1, 0.3),
  click: () => tone(660, 0.05, 'square', 0.06),
  pop: () => { tone(880, 0.06, 'sine', 0.2, 1320); },
  deny: () => { tone(200, 0.12, 'square', 0.06, 150); },
  tick: () => tone(1046, 0.08, 'sine', 0.15),
  go: () => { tone(523, 0.12, 'sine', 0.2); tone(784, 0.25, 'sine', 0.2, null, 0.12); },
  bed: () => {
    tone(440, 0.5, 'sawtooth', 0.12, 220);
    tone(330, 0.6, 'sawtooth', 0.1, 165, 0.1);
    noise(0.4, 400, 0.7, 0.4);
  },
  whoosh: () => noise(0.3, 600, 0.6, 0.2, 'lowpass'),
  hurt: () => { tone(260, 0.12, 'square', 0.08, 140); noise(0.1, 500, 1, 0.25); },
  eat: () => noise(0.07, 1400 + Math.random() * 500, 3, 0.2),
  burp: () => tone(140, 0.25, 'sawtooth', 0.08, 90),
};

export function play(name) {
  if (!ctx) return;
  SOUNDS[name]?.();
}
