// Procedural MIDI soundtrack + sound cues.
//
// Each round gets a song generated from a seed. The song is pure MIDI data
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

const CHORDS = { I: [0, 4, 7], ii: [2, 5, 9], iii: [4, 7, 11], IV: [5, 9, 12], V: [7, 11, 14], vi: [9, 12, 16] };
const PROGRESSIONS = [
  ['I', 'V', 'vi', 'IV'],
  ['vi', 'IV', 'I', 'V'],
  ['I', 'vi', 'IV', 'V'],
  ['I', 'IV', 'vi', 'V'],
  ['vi', 'V', 'IV', 'V'],
  ['I', 'iii', 'IV', 'V'],
];
const ROOTS = [48, 50, 52, 53, 55, 57]; // C3 D3 E3 F3 G3 A3
const PENTA = [0, 2, 4, 7, 9];
const KICKS = [[0, 4, 8, 12], [0, 6, 8, 11], [0, 7, 8, 10]];
const BASSES = [[0, 3, 6, 8, 11, 14], [0, 4, 8, 12], [0, 2, 4, 6, 8, 10, 12, 14], [0, 3, 8, 10, 11]];

export function generateSong(seed) {
  const rnd = mulberry32(seed);
  const choose = (arr) => arr[Math.floor(rnd() * arr.length)];
  const motif = [];
  for (let i = 0; i < 16; i++) motif.push(rnd() < 0.5 ? Math.floor(rnd() * 8) : null);
  motif[0] = 0;
  return {
    seed,
    root: choose(ROOTS),
    prog: choose(PROGRESSIONS).map((n) => CHORDS[n]),
    kick: choose(KICKS),
    bass: choose(BASSES),
    arpRate: rnd() < 0.5 ? 2 : 1, // 8ths or 16ths
    arpUpDown: rnd() < 0.5,
    motif,
  };
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

  // Drums
  if ((section !== 'break' && song.kick.includes(s)) || (section === 'break' && s === 0)) {
    ev.push({ inst: 'kick', note: 36, vel: 115, dur: 1 });
  }
  if (s === 4 || s === 12) ev.push({ inst: 'snare', note: 38, vel: section === 'intro' ? 70 : 100, dur: 1 });
  if (s % 2 === 0) ev.push({ inst: 'hat', note: 42, vel: s % 4 === 2 ? 85 : 55, dur: 1 });
  if (section === 'main' && s === 14) ev.push({ inst: 'ohat', note: 46, vel: 70, dur: 2 });

  // Bass
  if (section !== 'break' && song.bass.includes(s)) {
    const octave = s === 6 || s === 14 ? 12 : 0;
    ev.push({ inst: 'bass', note: root - 12 + chord[0] + octave, vel: 105, dur: 2 });
  }

  // Pad: whole-bar chord
  if (s === 0) for (const n of chord) ev.push({ inst: 'pad', note: root + 12 + n, vel: 55, dur: 16 });

  // Arpeggio
  if (section !== 'intro' && s % song.arpRate === 0) {
    let notes = [...chord, ...chord.map((n) => n + 12)];
    if (song.arpUpDown) notes = [...notes, ...notes.slice(1, -1).reverse()];
    const idx = (s / song.arpRate) % notes.length;
    ev.push({ inst: 'arp', note: root + 24 + notes[idx], vel: 70, dur: 1 });
  }

  // Lead melody in the second half of the main section (2-bar motif of 8th notes).
  if (b >= 8 && b < 12 && s % 2 === 0) {
    const deg = song.motif[((b - 8) % 2) * 8 + s / 2];
    if (deg !== null) {
      const note = root + 24 + PENTA[deg % 5] + 12 * Math.floor(deg / 5);
      ev.push({ inst: 'lead', note, vel: 90, dur: 2 });
    }
  }
  return ev;
}

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
      const on = step * STEP;
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

  startSong({ seed, bpm, startAt }, serverNow) {
    this.unlock();
    this.stopSong(0);
    if (!this.ctx) return;
    this.song = generateSong(seed);
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
      const when = this._toCtx(stepT);
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
        const { g } = this._osc('square', mtof(e.note), t, 0.12, out, 0.12 * v, { filter: 2600 });
        g.connect(this.delaySend);
        break;
      }
      case 'lead': {
        const { g } = this._osc('sawtooth', mtof(e.note), t, e.dur * stepS * 0.9, out, 0.16 * v, { attack: 0.01, filter: 3200 });
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
