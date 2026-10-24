// Tiny WebAudio synth: every sound effect and the music are generated, no
// audio files.

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
  if (!c) return;
  if (c.state === 'suspended') c.resume().then(startMusic);
  else startMusic();
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
  hit: () => { noise(0.06, 900, 1.5, 0.35); tone(180, 0.06, 'square', 0.05, 120); },
  ding: () => { tone(1568, 0.15, 'sine', 0.15); tone(2093, 0.2, 'sine', 0.1, null, 0.05); },
  boom: () => { noise(0.6, 180, 0.5, 0.9, 'lowpass'); tone(90, 0.5, 'sine', 0.4, 35); },
  throw: () => noise(0.18, 1400, 0.8, 0.2, 'highpass'),
  bow: () => { noise(0.12, 2200, 2, 0.15); tone(330, 0.08, 'triangle', 0.08, 500); },
  drink: () => { for (let i = 0; i < 3; i++) tone(500 + i * 60, 0.08, 'sine', 0.08, 420, i * 0.12); },
  fuse: () => noise(0.5, 3000, 0.8, 0.12, 'highpass'),
};

export function play(name) {
  if (!ctx) return;
  SOUNDS[name]?.();
}

// ---------------------------------------------------------------- music
// A little chiptune band: soft pad chords, bass, an arpeggio and a seeded
// melody (it repeats every two phrases, so it sounds composed), plus drums in
// game. Notes are scheduled slightly ahead of time so the beat stays steady.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

const TRACKS = {
  // Menu and lobby: relaxed and bouncy. Cmaj7 - Am7 - Fmaj7 - G
  menu: {
    bpm: 96, drums: false, pad: 'triangle',
    chords: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 67]],
    bass: [48, 45, 41, 43], lead: [72, 74, 76, 79, 81, 84],
  },
  // In game: faster, with drums. Am - F - C - G
  game: {
    bpm: 124, drums: true, pad: 'sawtooth',
    chords: [[57, 60, 64, 69], [53, 57, 60, 65], [48, 52, 55, 60], [55, 59, 62, 67]],
    bass: [45, 41, 36, 43], lead: [69, 72, 74, 76, 79, 81],
  },
};

let musicGain = null, musicVolume = 0.5;
let track = null, timer = null, nextTime = 0, step = 0, seed = 1;

function musicOut() {
  if (!musicGain) {
    musicGain = ctx.createGain();
    musicGain.gain.value = musicVolume * 0.5;
    musicGain.connect(ctx.destination);
  }
  return musicGain;
}

function voice(freq, t, dur, type, gain, { attack = 0.01, cutoff = 0 } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    o.connect(f);
    node = f;
  }
  node.connect(g).connect(musicOut());
  o.start(t);
  o.stop(t + dur + 0.05);
}

function drum(kind, t) {
  const out = musicOut();
  if (kind === 'kick') {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.2);
    return;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = kind === 'hat' ? 'highpass' : 'bandpass';
  f.frequency.value = kind === 'hat' ? 7000 : 1800;
  const g = ctx.createGain();
  const [level, len] = kind === 'hat' ? [0.07, 0.04] : [0.22, 0.13];
  g.gain.setValueAtTime(level, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.3, len + 0.02);
}

// Deterministic randomness for the melody (changes every other phrase).
function rnd() {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}

function playStep(T, s, t) {
  const sixteenth = 60 / T.bpm / 4;
  const bar = Math.floor(s / 16) % 4, pos = s % 16;
  const chord = T.chords[bar];
  if (s % 128 === 0) seed = 1 + ((s / 128) % 2) * 777;
  if (pos === 0) for (const n of chord) voice(midi(n), t, sixteenth * 15.5, T.pad, 0.03, { attack: 0.3, cutoff: 1300 });
  if (pos % 8 === 0 || (T.drums && pos === 14)) voice(midi(T.bass[bar]), t, sixteenth * 3, 'triangle', 0.17);
  if (pos % 2 === 0) voice(midi(chord[(pos / 2) % chord.length] + 12), t, sixteenth * 1.5, 'square', 0.02, { cutoff: 2400 });
  if ([0, 3, 6, 8, 11, 14].includes(pos) && rnd() < 0.62) {
    voice(midi(T.lead[Math.floor(rnd() * T.lead.length)]), t, sixteenth * 2.6, 'triangle', 0.055);
  }
  if (T.drums) {
    if (pos % 4 === 0) drum('kick', t);
    if (pos === 4 || pos === 12) drum('snare', t);
    if (pos % 2 === 0) drum('hat', t);
  }
}

function scheduleMusic() {
  const T = TRACKS[track];
  if (!T || !ctx) return;
  const sixteenth = 60 / T.bpm / 4;
  // After a stall (hidden tab), skip ahead instead of playing a burst.
  if (nextTime < ctx.currentTime - 0.2) nextTime = ctx.currentTime + 0.05;
  while (nextTime < ctx.currentTime + 0.15) {
    playStep(T, step, nextTime);
    nextTime += sixteenth;
    step++;
  }
}

function startMusic() {
  if (!track || !ctx || ctx.state !== 'running' || timer || musicVolume <= 0) return;
  step = 0;
  nextTime = ctx.currentTime + 0.1;
  timer = setInterval(scheduleMusic, 30);
}

function stopMusic() {
  if (timer) clearInterval(timer);
  timer = null;
}

// 'menu' | 'game' | null. Safe to call every frame.
export function setMusic(name) {
  if (name === track) return;
  track = name;
  stopMusic();
  startMusic();
}

export function setMusicVolume(v) {
  musicVolume = v;
  if (musicGain) musicGain.gain.value = v * 0.5;
  if (v <= 0) stopMusic(); else startMusic();
}
