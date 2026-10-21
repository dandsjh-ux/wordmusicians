// Procedural MIDI soundtrack + sound cues.
//
// Each round gets a song generated from a seed, in a style that matches the
// round's speed (see STYLES). The song is pure MIDI data
// (note numbers, velocities, durations in 16th-note steps) produced by
// `stepEvents()`. The same data is either played live through a small Web
// Audio synth or written out as a Standard MIDI File by `buildMidiFile()`.

// ------------------------------------------------------------------ song data

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CHORDS = {
  I: [0, 4, 7], ii: [2, 5, 9], iii: [4, 7, 11], IV: [5, 9, 12], V: [7, 11, 14], vi: [9, 12, 16],
  Imaj7: [0, 4, 7, 11], ii7: [2, 5, 9, 12], iii7: [4, 7, 11, 14], IVmaj7: [5, 9, 12, 16], V7: [7, 11, 14, 17], vi7: [9, 12, 16, 19],
  Isus: [0, 5, 7], Vsus: [7, 12, 14],
};
const ROOTS = [48, 50, 52, 53, 55, 57]; // C3 D3 E3 F3 G3 A3
const PENTA = [0, 2, 4, 7, 9];

// Song styles by difficulty (index matches SPEEDS in shared/rules.js). Each
// style lists a few variations of every part, and a round's seed picks one of
// each, so every speed has its own feel and lots of different songs.
//
// Patterns are 16 steps (one bar of 16th notes):
//   drums: 'X' accent, 'x' normal, 'o' ghost note, '.' rest
//   bass:  'r' chord root, 'o' root an octave up, 'f' fifth, 't' third, '.' rest
//          (each bass note rings until the next one, up to a beat)
export const STYLES = [
  {
    name: 'Lo-fi Chill',
    progressions: [
      ['Imaj7', 'vi7', 'ii7', 'V7'],
      ['IVmaj7', 'iii7', 'vi7', 'Imaj7'],
      ['ii7', 'V7', 'Imaj7', 'vi7'],
      ['Imaj7', 'IVmaj7', 'iii7', 'vi7'],
    ],
    kicks: ['x......x..x.....', 'x.........x.....', 'x......x.x......', 'x..x......x.....'],
    snares: ['....x.......x...', '....x..o....x...', '....x.......x..o'],
    hats: ['x.x.x.x.x.x.x.x.', 'x...x...x...x...', 'x.ox..x.x.ox..x.'],
    ohats: ['................'],
    basses: ['r......r..f.....', 'r.....o...r.....', 'r...f...r...t...'],
    arpRates: [2, 4], arpModes: ['up', 'updown', 'pulse'],
    leadRates: [4, 2], leadDensity: 0.45,
    swing: [0.18, 0.28], arpWaves: ['triangle', 'sine'], leadWaves: ['triangle', 'sine'],
  },
  {
    name: 'Sunny Pop',
    progressions: [
      ['I', 'V', 'vi', 'IV'],
      ['I', 'IV', 'vi', 'V'],
      ['IV', 'I', 'V', 'vi'],
      ['I', 'vi', 'IV', 'V'],
    ],
    kicks: ['x...x...x...x...', 'x.....x.x.......', 'x.......x.x.....'],
    snares: ['....x.......x...', '....x.......x.x.'],
    hats: ['x.x.x.x.x.x.x.x.', 'x.xxx.x.x.xxx.x.'],
    ohats: ['................', '..............x.'],
    basses: ['r.r.r.r.r.r.r.r.', 'r...r...f...r...', 'r..r..r.r..r..o.'],
    arpRates: [2], arpModes: ['up', 'updown'],
    leadRates: [2, 4], leadDensity: 0.55,
    swing: [0, 0.08], arpWaves: ['square', 'triangle'], leadWaves: ['square', 'triangle'],
  },
  {
    name: 'Funky Groove',
    progressions: [
      ['vi', 'IV', 'I', 'V'],
      ['ii7', 'V7', 'iii7', 'vi7'],
      ['I', 'iii', 'IV', 'V'],
      ['vi7', 'ii7', 'V7', 'Imaj7'],
    ],
    kicks: ['x...x...x...x...', 'x..x..x.x.......', 'x.....x...x..x..', 'x..x....x.x.....'],
    snares: ['....X.......X...', '....X..o....X.o.', '.o..X..o.o..X...'],
    hats: ['xxxxxxxxxxxxxxxx', 'x.x.x.x.x.x.x.x.', 'xoxxxoxxxoxxxoxx'],
    ohats: ['..............x.', '..x...x...x...x.'],
    basses: ['r..o.r.or..o.ro.', 'r.r...o.r.f...o.', 'r..r..o...r.t.f.'],
    arpRates: [2, 1], arpModes: ['up', 'updown', 'random'],
    leadRates: [2], leadDensity: 0.55,
    swing: [0.05, 0.12], arpWaves: ['square'], leadWaves: ['sawtooth', 'square'],
  },
  {
    name: 'Dance Floor',
    progressions: [
      ['vi', 'IV', 'I', 'V'],
      ['vi', 'V', 'IV', 'V'],
      ['I', 'V', 'vi', 'IV'],
      ['ii', 'vi', 'IV', 'Vsus'],
    ],
    kicks: ['X...x...X...x...', 'X...x...X...x..x'],
    snares: ['....x.......x...', '....x.......x.xx', '....x..o....x...'],
    hats: ['..x...x...x...x.', 'xxxxxxxxxxxxxxxx', 'x.x.x.x.x.x.x.x.'],
    ohats: ['..x...x...x...x.', '................'],
    basses: ['..r...r...r...r.', '..o.r.o...o.r.o.', 'r.o.r.o.r.o.r.o.'],
    arpRates: [1, 2], arpModes: ['up', 'updown', 'pulse', 'random'],
    leadRates: [2, 1], leadDensity: 0.6,
    swing: [0], arpWaves: ['square', 'sawtooth'], leadWaves: ['sawtooth', 'square'],
  },
  {
    name: 'Turbo Breakbeat',
    progressions: [
      ['vi', 'IV', 'V', 'V'],
      ['vi', 'V', 'IV', 'iii'],
      ['I', 'V', 'IV', 'IV'],
      ['vi', 'ii', 'V', 'Isus'],
    ],
    kicks: ['x.........x.....', 'x.x.......x.....', 'x.........xx....', 'x......x..x.....'],
    snares: ['....X.......X...', '....X..o.o..X...', '....X.......X.oo'],
    hats: ['xxxxxxxxxxxxxxxx', 'xoxxxoxxxoxxxoxx'],
    ohats: ['................', '......x.......x.'],
    basses: ['r.....r.r.......', 'r.......o.....f.', 'r..r....r..r..o.'],
    arpRates: [1], arpModes: ['up', 'updown', 'random', 'pulse'],
    leadRates: [1, 2], leadDensity: 0.5,
    swing: [0], arpWaves: ['square', 'sawtooth'], leadWaves: ['sawtooth', 'square'],
  },
];

export function generateSong(seed, speed = 2) {
  const rnd = mulberry32(seed);
  const choose = (arr) => arr[Math.floor(rnd() * arr.length)];
  const style = STYLES[Math.max(0, Math.min(STYLES.length - 1, speed))];
  const motif = []; // 2 bars of 16ths; the lead plays every `leadRate`-th entry
  for (let i = 0; i < 32; i++) motif.push(rnd() < style.leadDensity ? Math.floor(rnd() * 8) : null);
  motif[0] = 0;
  const arpOrder = [...Array(8).keys()].sort(() => rnd() - 0.5);
  return {
    seed,
    speed,
    style: style.name,
    root: choose(ROOTS),
    prog: choose(style.progressions).map((n) => CHORDS[n]),
    kick: choose(style.kicks),
    snare: choose(style.snares),
    hat: choose(style.hats),
    ohat: choose(style.ohats),
    bass: choose(style.basses),
    arpRate: choose(style.arpRates),
    arpMode: choose(style.arpModes),
    arpOrder,
    leadRate: choose(style.leadRates),
    swing: choose(style.swing),
    arpWave: choose(style.arpWaves),
    leadWave: choose(style.leadWaves),
    motif,
  };
}

const DRUM_VEL = { X: 1.15, x: 1, o: 0.45 };

function arpNotes(song, chord) {
  const up = [...chord, ...chord.map((n) => n + 12)];
  switch (song.arpMode) {
    case 'updown': return [...up, ...up.slice(1, -1).reverse()];
    case 'pulse': return [chord[0], up[up.length - 1], chord[1], up[up.length - 1], chord[2], up[up.length - 1]];
    case 'random': return song.arpOrder.map((i) => up[i % up.length]);
    default: return up;
  }
}

/** All MIDI events that start on global 16th-step `step` (step 0 = count-in bar). */
export function stepEvents(song, step) {
  const ev = [];
  const bar = Math.floor(step / 16);
  const s = step % 16;

  if (bar === 0) {
    // Count-in: woodblock on every beat, higher on the downbeat.
    if (s % 4 === 0) ev.push({ inst: 'click', note: s === 0 ? 77 : 76, vel: 110, dur: 1 });
    return ev;
  }

  const b = (bar - 1) % 16;
  const section = b < 4 ? 'intro' : b < 12 ? 'main' : 'break';
  const chord = song.prog[(bar - 1) % 4];
  const root = song.root;
  const drum = (pattern, inst, note, vel, dur = 1) => {
    const k = DRUM_VEL[pattern[s]];
    if (k) ev.push({ inst, note, vel: Math.min(127, Math.round(vel * k * (section === 'intro' ? 0.75 : 1))), dur });
  };

  // Drums
  if (section !== 'break') drum(song.kick, 'kick', 36, 110);
  else if (s === 0) ev.push({ inst: 'kick', note: 36, vel: 115, dur: 1 });
  drum(song.snare, 'snare', 38, 95);
  drum(song.hat, 'hat', 42, s % 4 === 2 ? 85 : 60);
  if (section === 'main') drum(song.ohat, 'ohat', 46, 70, 2);

  // Bass: each note rings until the next one in the pattern (at most a beat).
  const bc = song.bass[s];
  if (section !== 'break' && bc !== '.') {
    const offset = { r: chord[0], o: chord[0] + 12, f: chord[0] + 7, t: chord[1] }[bc] ?? chord[0];
    let dur = 1;
    while (dur < 4 && s + dur < 16 && song.bass[s + dur] === '.') dur++;
    ev.push({ inst: 'bass', note: root - 12 + offset, vel: 105, dur });
  }

  // Pad: whole-bar chord
  if (s === 0) for (const n of chord) ev.push({ inst: 'pad', note: root + 12 + n, vel: 55, dur: 16 });

  // Arpeggio
  if (section !== 'intro' && s % song.arpRate === 0) {
    const notes = arpNotes(song, chord);
    const idx = (s / song.arpRate) % notes.length;
    ev.push({ inst: 'arp', note: root + 24 + notes[idx], vel: 70, dur: 1 });
  }

  // Lead melody in the second half of the main section (2-bar motif).
  if (b >= 8 && b < 12 && s % song.leadRate === 0) {
    const deg = song.motif[((b - 8) % 2) * 16 + s];
    if (deg !== null) {
      const note = root + 24 + PENTA[deg % 5] + 12 * Math.floor(deg / 5);
      ev.push({ inst: 'lead', note, vel: 90, dur: song.leadRate });
    }
  }
  return ev;
}

/** Swing: off-beat 16ths are pushed late by this fraction of a step. */
export const swingOffset = (song, step) => (step % 2 ? song.swing ?? 0 : 0);

// ------------------------------------------------------------------ MIDI file

const GM = {
  // inst: [channel, program (0-based GM)]
  bass: [0, 38], // Synth Bass 1
  pad: [1, 89], // Pad 2 (warm)
  arp: [2, 80], // Lead 1 (square)
  lead: [3, 81], // Lead 2 (sawtooth)
  kick: [9], snare: [9], hat: [9], ohat: [9], click: [9],
};

const vlq = (n) => {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
};
const str = (s) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >>> 8) & 255, n & 255];

function trackChunk(events) {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data = [];
  let last = 0;
  for (const e of events) {
    data.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  data.push(0, 0xff, 0x2f, 0);
  return [...str('MTrk'), ...u32(data.length), ...data];
}

/** Build a Standard MIDI File (format 1) for `bars` bars of the song. */
export function buildMidiFile(song, bpm, bars = 33) {
  const TPQ = 480;
  const STEP = TPQ / 4;
  const name = (t) => [...str(t)];
  const tempo = Math.round(60000000 / bpm);
  const meta = [
    { tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(13), ...name('Word Musician')] },
    { tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255] },
    { tick: 0, order: 0, bytes: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
  ];
  const tracks = new Map();
  for (const [inst, [ch, prog]] of Object.entries(GM)) {
    if (!tracks.has(ch)) {
      const evs = [];
      if (prog !== undefined) evs.push({ tick: 0, order: 0, bytes: [0xc0 | ch, prog] });
      tracks.set(ch, evs);
    }
  }
  for (let step = 0; step < bars * 16; step++) {
    for (const e of stepEvents(song, step)) {
      const ch = GM[e.inst][0];
      const evs = tracks.get(ch);
      const on = step * STEP + Math.round(swingOffset(song, step) * STEP);
      const off = on + Math.max(1, e.dur * STEP - 10);
      evs.push({ tick: on, order: 2, bytes: [0x90 | ch, e.note, e.vel] });
      evs.push({ tick: off, order: 1, bytes: [0x80 | ch, e.note, 0] });
    }
  }
  const chunks = [trackChunk(meta), ...[...tracks.values()].map(trackChunk)];
  const header = [...str('MThd'), ...u32(6), ...u16(1), ...u16(chunks.length), ...u16(TPQ)];
  return new Uint8Array([...header, ...chunks.flat()]);
}

export function downloadMidi(song, bpm, filename = 'word-musicians.mid') {
  const blob = new Blob([buildMidiFile(song, bpm)], { type: 'audio/midi' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ------------------------------------------------------------------ live synth

const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

function loadPref(key, def) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : parseFloat(v);
  } catch {
    return def;
  }
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.song = null;
    this.timer = null;
    this.musicVolume = loadPref('wm.music', 0.8);
    this.sfxVolume = loadPref('wm.sfx', 0.9);
  }

  /** Must be called from a user gesture at least once. */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = (this.ctx = new Ctx());
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.connect(ctx.destination);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.musicVolume * 0.55;
      this.musicBus.connect(comp);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.sfxVolume * 0.7;
      this.sfxBus.connect(comp);

      // Echo send for arp/lead.
      this.delay = ctx.createDelay(1);
      const fb = ctx.createGain();
      fb.gain.value = 0.28;
      this.delaySend = ctx.createGain();
      this.delaySend.gain.value = 0.3;
      this.delaySend.connect(this.delay);
      this.delay.connect(fb);
      fb.connect(this.delay);
      this.delay.connect(this.musicBus);

      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    try { localStorage.setItem('wm.music', v); } catch {}
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(v * 0.55, this.ctx.currentTime, 0.05);
  }

  setSfxVolume(v) {
    this.sfxVolume = v;
    try { localStorage.setItem('wm.sfx', v); } catch {}
    if (this.sfxBus) this.sfxBus.gain.setTargetAtTime(v * 0.7, this.ctx.currentTime, 0.05);
  }

  // ---- sequencer

  startSong({ seed, bpm, startAt, speed }, serverNow) {
    this.unlock();
    this.stopSong(0);
    if (!this.ctx) return;
    this.song = generateSong(seed, speed);
    this.bpm = bpm;
    this.stepMs = 60000 / bpm / 4;
    this.startAt = startAt;
    this.serverNow = serverNow;
    this.delay.delayTime.value = (60 / bpm) * 0.75;
    this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicBus.gain.setValueAtTime(this.musicVolume * 0.55, this.ctx.currentTime);
    this.offset = null;
    this.nextStep = Math.max(0, Math.ceil((serverNow() - startAt) / this.stepMs));
    this.timer = setInterval(() => this._schedule(), 25);
    this._schedule();
  }

  stopSong(fade = 1.2) {
    clearInterval(this.timer);
    this.timer = null;
    if (this.ctx && fade > 0) {
      const g = this.musicBus.gain;
      const t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + fade);
    }
  }

  /** Map server time (ms) to AudioContext time (s), smoothing out clock jitter. */
  _toCtx(serverMs) {
    const est = this.serverNow() / 1000 - this.ctx.currentTime;
    if (this.offset === null || Math.abs(est - this.offset) > 0.04) this.offset = est;
    else this.offset += (est - this.offset) * 0.02;
    return serverMs / 1000 - this.offset;
  }

  _schedule() {
    if (!this.ctx || !this.song) return;
    const nowS = this.serverNow();
    for (;;) {
      const stepT = this.startAt + this.nextStep * this.stepMs;
      if (stepT > nowS + 150) break;
      const when = this._toCtx(stepT + swingOffset(this.song, this.nextStep) * this.stepMs);
      if (when >= this.ctx.currentTime - 0.03) {
        for (const e of stepEvents(this.song, this.nextStep)) this._play(e, Math.max(when, this.ctx.currentTime), this.musicBus);
      }
      this.nextStep++;
    }
  }

  /** Chord tones of whatever bar is playing right now (for musical hit cues). */
  currentChord() {
    if (!this.song || !this.serverNow) return [0, 4, 7];
    const bar = Math.max(1, Math.floor((this.serverNow() - this.startAt) / (this.stepMs * 16)));
    return this.song.prog[(bar - 1) % 4];
  }

  // ---- instruments

  _env(gain, t, a, peak, d, sustainLevel = 0.0001) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + a);
    gain.gain.exponentialRampToValueAtTime(Math.max(sustainLevel, 0.0001), t + a + d);
  }

  _osc(type, freq, t, dur, out, peak, { attack = 0.005, detune = 0, filter = null } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    const g = ctx.createGain();
    this._env(g, t, attack, peak, dur);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      o.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    return { o, g };
  }

  _noise(t, dur, out, peak, type, freq) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    this._env(g, t, 0.002, peak, dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  _play(e, t, out) {
    const v = e.vel / 127;
    const stepS = this.stepMs / 1000;
    switch (e.inst) {
      case 'kick': {
        const { o } = this._osc('sine', 150, t, 0.28, out, 0.9 * v);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        break;
      }
      case 'snare':
        this._noise(t, 0.16, out, 0.45 * v, 'bandpass', 1800);
        this._osc('triangle', 190, t, 0.08, out, 0.3 * v);
        break;
      case 'hat':
        this._noise(t, 0.04, out, 0.18 * v, 'highpass', 7500);
        break;
      case 'ohat':
        this._noise(t, 0.22, out, 0.16 * v, 'highpass', 6500);
        break;
      case 'click':
        this._osc('square', mtof(e.note + 12), t, 0.05, out, 0.35 * v, { filter: 3000 });
        break;
      case 'bass':
        this._osc('sawtooth', mtof(e.note), t, e.dur * stepS * 0.9, out, 0.42 * v, { filter: 700 });
        this._osc('sine', mtof(e.note - 12), t, e.dur * stepS * 0.9, out, 0.3 * v);
        break;
      case 'pad':
        for (const det of [-9, 9]) {
          this._osc('sawtooth', mtof(e.note), t, e.dur * stepS, out, 0.07 * v, { attack: 0.25, detune: det, filter: 1400 });
        }
        break;
      case 'arp': {
        const wave = this.song?.arpWave ?? 'square';
        const { g } = this._osc(wave, mtof(e.note), t, 0.12, out, (wave === 'sine' || wave === 'triangle' ? 0.17 : 0.12) * v, { filter: 2600 });
        g.connect(this.delaySend);
        break;
      }
      case 'lead': {
        const wave = this.song?.leadWave ?? 'sawtooth';
        const { g } = this._osc(wave, mtof(e.note), t, e.dur * stepS * 0.9, out, (wave === 'sine' || wave === 'triangle' ? 0.22 : 0.16) * v, { attack: 0.01, filter: 3200 });
        g.connect(this.delaySend);
        break;
      }
    }
  }

  // ---- cues

  cue(type, lane = 2) {
    this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.005;
    const out = this.sfxBus;
    const root = (this.song?.root ?? 48) + 24;
    const chord = this.currentChord();
    switch (type) {
      case 'perfect':
      case 'great':
      case 'good': {
        // A chord tone picked by lane, so hits play along with the song.
        const n = root + chord[lane % 3] + (lane >= 3 ? 12 : 0);
        const peak = type === 'perfect' ? 0.5 : type === 'great' ? 0.4 : 0.3;
        this._osc('triangle', mtof(n), t, 0.35, out, peak);
        this._osc('sine', mtof(n + 12), t, 0.25, out, peak * 0.5);
        if (type === 'perfect') this._osc('sine', mtof(n + 19), t + 0.05, 0.25, out, 0.18);
        break;
      }
      case 'oops': {
        for (const det of [0, 35]) {
          const { o } = this._osc('sawtooth', 220, t, 0.45, out, 0.28, { detune: det, filter: 1600 });
          o.frequency.exponentialRampToValueAtTime(90, t + 0.4);
        }
        this._noise(t, 0.12, out, 0.2, 'lowpass', 900);
        break;
      }
      case 'miss': {
        const { o } = this._osc('sine', 130, t, 0.22, out, 0.4);
        o.frequency.exponentialRampToValueAtTime(65, t + 0.2);
        break;
      }
      case 'dodge':
        this._osc('sine', mtof(root + chord[2] + 12), t, 0.12, out, 0.12);
        this._noise(t, 0.12, out, 0.06, 'highpass', 5000);
        break;
      case 'send': {
        const { o } = this._osc('triangle', 300, t, 0.18, out, 0.18);
        o.frequency.exponentialRampToValueAtTime(900, t + 0.15);
        break;
      }
      case 'tap':
        this._noise(t, 0.03, out, 0.12, 'bandpass', 3000);
        break;
      case 'go':
        this._osc('square', mtof(root + 12), t, 0.3, out, 0.25, { filter: 4000 });
        this._osc('square', mtof(root + 19), t, 0.3, out, 0.2, { filter: 4000 });
        break;
      case 'fanfare': {
        const seq = [0, 4, 7, 12, 7, 12];
        seq.forEach((n, i) => this._osc('square', mtof(root + n), t + i * 0.11, 0.2, out, 0.22, { filter: 3500 }));
        break;
      }
      case 'click':
        this._osc('sine', 1200, t, 0.04, out, 0.15);
        break;
    }
  }
}
