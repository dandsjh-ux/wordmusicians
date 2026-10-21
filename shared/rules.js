// Game rules shared by server and client.

export const LANES = 5;
export const MAX_PLAYERS = 8; // including the conductor
export const COUNT_IN_BEATS = 4; // one bar of count-in before notes can land

// Speed presets: tempo of the music and how long a word takes to travel down the highway.
export const SPEEDS = [
  { label: 'Chill', bpm: 88, travel: 4.6 },
  { label: 'Easy', bpm: 96, travel: 4.0 },
  { label: 'Groovy', bpm: 108, travel: 3.4 },
  { label: 'Fast', bpm: 120, travel: 2.8 },
  { label: 'Turbo', bpm: 136, travel: 2.3 },
];

// Timing windows in ms either side of the beat (generous: this is for kids).
export const JUDGE = { perfect: 75, great: 140, good: 210 };

export const POINTS = {
  perfect: 300,
  great: 200,
  good: 100,
  oops: -150, // hit a distractor
  dodge: 50, // let a distractor pass
  conductorOops: 100, // conductor bonus per player who hits a distractor
  conductorMiss: 50, // conductor bonus per player who misses a correct word
};

export const comboBonus = (combo) => Math.min(combo, 40) * 5;

// Conductor must keep the beat going: after this many idle beats the band
// auto-plays a (correct) word for them, which only helps the players.
export const IDLE_AUTOSEND_BEATS = 6;

// Tap-to-send: each tap sends one word straight away. Taps close together land
// on the same beat as a chord of up to MAX_CHORD words, and the Conductor can't
// get more than MAX_AHEAD_BEATS ahead of the earliest beat a word could land on.
export const MAX_CHORD = 3;
export const MAX_AHEAD_BEATS = 6;

export const SETTING_LIMITS = {
  speed: [0, SPEEDS.length - 1, 2],
  roundSeconds: [30, 180, 60],
  wordsPerRound: [10, 80, 30],
  distractors: [0, 12, 6],
  maxDistractorPct: [0, 45, 30], // always below half: real words must outnumber tricks
  rounds: [1, 10, 4],
};

export const CONDUCTOR_MODES = {
  rotate: 'Rotate each round',
  host: 'Host is always Conductor',
  bot: 'Computer Conductor (everyone plays)',
};

export function sanitizeSettings(s = {}) {
  const out = {};
  for (const [k, [min, max, def]] of Object.entries(SETTING_LIMITS)) {
    const v = parseInt(s[k], 10);
    out[k] = Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : def;
  }
  out.conductorMode = Object.hasOwn(CONDUCTOR_MODES, s.conductorMode) ? s.conductorMode : 'rotate';
  out.categories = Array.isArray(s.categories)
    ? s.categories.filter((c) => typeof c === 'string').slice(0, 40)
    : [];
  return out;
}

export const maxDistractorsFor = (settings) =>
  Math.floor((settings.wordsPerRound * settings.maxDistractorPct) / 100);
