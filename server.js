import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

import {
  CATEGORIES, buildPalette, MAX_CUSTOM_CATEGORIES, MAX_CUSTOM_WORDS, MIN_CUSTOM_WORDS,
} from './shared/categories.js';
import {
  LANES, MAX_PLAYERS, COUNT_IN_BEATS, SPEEDS, POINTS, comboBonus, IDLE_AUTOSEND_BEATS,
  sanitizeSettings, maxDistractorsFor,
} from './shared/rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build')));
app.get('/healthz', (_req, res) => res.send('ok'));

const server = http.createServer(app);
const io = new Server(server);

const PLAYER_COLORS = ['#4ade80', '#f472b6', '#60a5fa', '#facc15', '#c084fc', '#fb923c', '#2dd4bf', '#f87171'];
const RESULTS_CORRECT = ['perfect', 'great', 'good', 'miss'];
const RESULTS_WRONG = ['oops', 'dodge'];
const ROUND_BREAK_MS = 8000;

/** @type {Map<string, any>} */
const rooms = new Map();
const now = () => Date.now();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clean = (s, n) => String(s ?? '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

function makeRoomId() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let id;
  do {
    id = Array.from({ length: 4 }, () => pick(letters)).join('');
  } while (rooms.has(id));
  return id;
}

function sanitizeCustom(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const c of list.slice(0, MAX_CUSTOM_CATEGORIES)) {
    const name = clean(c?.name, 24);
    const seen = new Set();
    const words = [];
    for (const w of Array.isArray(c?.words) ? c.words : []) {
      const word = clean(w, 18);
      if (word && !seen.has(word.toLowerCase())) {
        seen.add(word.toLowerCase());
        words.push(word);
      }
    }
    if (name && words.length >= MIN_CUSTOM_WORDS) {
      out.push({ id: `custom${out.length + 1}`, name, emoji: '⭐', custom: true, words: words.slice(0, MAX_CUSTOM_WORDS) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- room views

const playerList = (r) => r.order.map((id) => r.players.get(id)).filter(Boolean);

function roomSummary(r) {
  const host = r.players.get(r.hostId);
  return {
    id: r.id, name: r.name, host: host?.name ?? '?', players: r.players.size, max: MAX_PLAYERS,
    status: r.status, roundNum: r.roundNum, rounds: r.settings.rounds,
  };
}

function roomState(r) {
  return {
    id: r.id, name: r.name, hostId: r.hostId, status: r.status, settings: r.settings,
    custom: r.custom, roundNum: r.roundNum,
    players: playerList(r).map((p) => ({
      id: p.id, name: p.name, color: p.color, score: p.score, isHost: p.id === r.hostId,
    })),
  };
}

const scoreList = (r) => playerList(r).map((p) => ({ id: p.id, score: p.score, combo: p.combo }));
const broadcastRooms = () => io.to('lobby').emit('rooms', [...rooms.values()].map(roomSummary));
const emitRoom = (r) => io.to(r.id).emit('room', roomState(r));

function roundPublic(r) {
  const rd = r.round;
  const cond = rd.conductorId ? r.players.get(rd.conductorId) : null;
  return {
    num: rd.num, total: r.settings.rounds, category: rd.category, conductorId: rd.conductorId,
    conductorName: cond?.name ?? 'Robo-Conductor', bpm: rd.bpm, beatMs: rd.beatMs,
    travelMs: rd.travelMs, startAt: rd.startAt, endAt: rd.endAt, songSeed: rd.songSeed,
    wordsPerRound: r.settings.wordsPerRound, maxDistractors: rd.maxDistractors,
    sent: rd.sent, sentDistractors: rd.sentDistractors,
  };
}

function sendPalette(r) {
  const rd = r.round;
  if (rd.conductorId) io.to(rd.conductorId).emit('palette', rd.palette);
}

// ---------------------------------------------------------------- game flow

function categoryPool(r) {
  const all = [...CATEGORIES, ...r.custom];
  const chosen = all.filter((c) => r.settings.categories.includes(c.id));
  return chosen.length ? chosen : CATEGORIES;
}

function pickCategory(r) {
  const pool = categoryPool(r);
  let fresh = pool.filter((c) => !r.usedCategories.includes(c.id));
  if (!fresh.length) {
    r.usedCategories = [];
    fresh = pool;
  }
  const cat = pick(fresh);
  r.usedCategories.push(cat.id);
  return cat;
}

function chooseConductor(r) {
  const mode = r.settings.conductorMode;
  if (mode === 'bot' || r.players.size < 2) return null;
  if (mode === 'host') return r.hostId;
  const order = r.order.filter((id) => r.players.has(id));
  return order[(r.roundNum - 1) % order.length];
}

function startGame(r) {
  clearTimeout(r.timer);
  for (const p of r.players.values()) Object.assign(p, freshStats());
  r.roundNum = 0;
  r.usedCategories = [];
  startRound(r);
}

function freshStats() {
  return { score: 0, combo: 0, maxCombo: 0, hits: 0, misses: 0, oops: 0, dodges: 0, tripped: 0 };
}

function startRound(r) {
  r.roundNum += 1;
  const cat = pickCategory(r);
  const speed = SPEEDS[r.settings.speed];
  const beatMs = 60000 / speed.bpm;
  const startAt = now() + 1500; // beat 0 of the count-in bar
  const firstBeat = startAt + COUNT_IN_BEATS * beatMs;
  for (const p of r.players.values()) p.combo = 0;

  r.round = {
    num: r.roundNum,
    category: { id: cat.id, name: cat.name, emoji: cat.emoji },
    words: cat.words,
    palette: buildPalette(cat, r.settings.distractors),
    conductorId: chooseConductor(r),
    bpm: speed.bpm,
    beatMs,
    travelMs: speed.travel * 1000,
    startAt,
    endAt: firstBeat + r.settings.roundSeconds * 1000, // last moment a word may land
    maxDistractors: maxDistractorsFor(r.settings),
    songSeed: Math.floor(Math.random() * 1e9),
    sent: 0,
    sentDistractors: 0,
    notes: new Map(),
    laneBeats: new Set(),
    lastBeat: -1,
    lastSendAt: firstBeat,
    lastArrive: 0,
    nextBotAt: firstBeat - speed.travel * 1000,
    seq: 0,
    roundStartScores: new Map([...r.players.values()].map((p) => [p.id, p.score])),
  };
  r.status = 'playing';
  io.to(r.id).emit('roundStart', roundPublic(r));
  sendPalette(r);
  emitRoom(r);
  broadcastRooms();
}

/**
 * Schedule words onto the highway. All words in one call land on the same beat
 * (a "chord"), so the conductor can send up to 5 at once.
 * @returns {string|null} an error message, or null on success
 */
function sendWords(r, items) {
  const rd = r.round;
  if (!rd || r.status !== 'playing') return 'The round is not running.';
  const W = r.settings.wordsPerRound;
  if (rd.sent >= W) return 'No words left to send this round!';

  const lanes = new Set();
  const notes = [];
  for (const it of items.slice(0, LANES)) {
    const lane = Number(it.lane);
    if (!Number.isInteger(lane) || lane < 0 || lane >= LANES || lanes.has(lane)) continue;
    const entry = rd.palette.find((p) => p.word === it.word);
    if (!entry) continue;
    lanes.add(lane);
    notes.push({ word: entry.word, correct: entry.correct, lane });
  }
  if (!notes.length) return 'Pick a word first.';
  if (rd.sent + notes.length > W) return `Only ${W - rd.sent} word(s) left this round.`;
  const wrongCount = notes.filter((n) => !n.correct).length;
  if (rd.sentDistractors + wrongCount > rd.maxDistractors) {
    return `Trick-word limit reached (${rd.maxDistractors} per round).`;
  }
  // House rule: real words must always outnumber trick words.
  const realAfter = rd.sent - rd.sentDistractors + (notes.length - wrongCount);
  if (wrongCount && rd.sentDistractors + wrongCount >= realAfter) {
    return 'Send more real words than trick words! Add a real word first.';
  }

  // Land on the first free beat that is far enough away for the word to travel the highway.
  const t = now();
  const minArrive = Math.max(t + rd.travelMs + 300, rd.startAt + COUNT_IN_BEATS * rd.beatMs);
  let k = Math.max(Math.ceil((minArrive - rd.startAt) / rd.beatMs), rd.lastBeat + 1);
  while (notes.some((n) => rd.laneBeats.has(`${k}:${n.lane}`))) k++;
  const arriveAt = rd.startAt + k * rd.beatMs;
  if (arriveAt > rd.endAt) return 'Time is up for this round!';

  rd.lastBeat = k;
  rd.lastSendAt = t;
  rd.lastArrive = Math.max(rd.lastArrive, arriveAt);
  rd.sent += notes.length;
  rd.sentDistractors += wrongCount;

  const out = notes.map((n) => {
    const note = { id: ++rd.seq, word: n.word, lane: n.lane, correct: n.correct, arriveAt, results: new Map() };
    rd.notes.set(note.id, note);
    rd.laneBeats.add(`${k}:${n.lane}`);
    return publicNote(note);
  });
  io.to(r.id).emit('notes', { notes: out, sent: rd.sent, sentDistractors: rd.sentDistractors });
  return null;
}

const publicNote = (n) => ({ id: n.id, word: n.word, lane: n.lane, correct: n.correct, arriveAt: n.arriveAt });

function randomLanes(count) {
  const lanes = [...Array(LANES).keys()].sort(() => Math.random() - 0.5);
  return lanes.slice(0, count);
}

function autoSend(r, { allowTricks }) {
  const rd = r.round;
  const left = r.settings.wordsPerRound - rd.sent;
  const fast = r.settings.speed >= 3;
  let count = Math.random() < (fast ? 0.15 : 0.3) ? 2 : 1;
  if (allowTricks && Math.random() < 0.08 && !fast) count = 3;
  count = Math.min(count, left);
  const correct = rd.palette.filter((p) => p.correct);
  const wrong = rd.palette.filter((p) => !p.correct);
  const trickChance = r.settings.maxDistractorPct / 100;
  let tricksLeft = rd.maxDistractors - rd.sentDistractors;
  let real = rd.sent - rd.sentDistractors;
  let tricks = rd.sentDistractors;
  const items = randomLanes(count).map((lane) => {
    const useTrick = allowTricks && wrong.length && tricksLeft > 0 && tricks + 1 < real && Math.random() < trickChance;
    if (useTrick) {
      tricksLeft--;
      tricks++;
    } else {
      real++;
    }
    return { lane, word: pick(useTrick ? wrong : correct).word };
  });
  sendWords(r, items);
}

function tick() {
  const t = now();
  for (const r of rooms.values()) {
    const rd = r.round;
    if (r.status !== 'playing' || !rd) continue;
    const canSend = rd.sent < r.settings.wordsPerRound && t + rd.travelMs + 300 < rd.endAt;

    if (canSend) {
      if (!rd.conductorId) {
        if (t >= rd.nextBotAt) {
          autoSend(r, { allowTricks: true });
          // Spread the remaining words evenly over the time left (never faster than 1 per beat).
          const left = r.settings.wordsPerRound - rd.sent;
          const timeLeft = rd.endAt - rd.travelMs - 300 - t;
          const gapBeats = left > 0 ? (timeLeft / left / rd.beatMs) * 1.2 : 1;
          const jitter = 0.6 + Math.random() * 0.8;
          rd.nextBotAt = t + rd.beatMs * Math.max(1, Math.round(gapBeats * jitter));
        }
      } else if (t - rd.lastSendAt > IDLE_AUTOSEND_BEATS * rd.beatMs) {
        autoSend(r, { allowTricks: false });
        io.to(rd.conductorId).emit('toast', 'Keep the music going! The band played a word for you.');
      }
    } else if (t > rd.lastArrive + 1500) {
      // Out of words or out of time, and the last word has cleared the hit line.
      endRound(r);
    }
  }
}
setInterval(tick, 100);

function applyResult(r, p, note, result) {
  const rd = r.round;
  note.results.set(p.id, result);
  const cond = rd.conductorId ? r.players.get(rd.conductorId) : null;
  switch (result) {
    case 'perfect':
    case 'great':
    case 'good':
      p.score += POINTS[result] + comboBonus(p.combo);
      p.combo += 1;
      p.maxCombo = Math.max(p.maxCombo, p.combo);
      p.hits += 1;
      break;
    case 'miss':
      p.combo = 0;
      p.misses += 1;
      if (cond) { cond.score += POINTS.conductorMiss; cond.tripped += 1; }
      break;
    case 'oops':
      p.score = Math.max(0, p.score + POINTS.oops);
      p.combo = 0;
      p.oops += 1;
      if (cond) { cond.score += POINTS.conductorOops; cond.tripped += 1; }
      break;
    case 'dodge':
      p.score += POINTS.dodge;
      p.dodges += 1;
      break;
  }
}

function endRound(r) {
  const rd = r.round;
  if (r.status !== 'playing') return;
  // Anyone who never reported on a note (lag, tab in background) gets the default outcome.
  for (const note of rd.notes.values()) {
    for (const p of r.players.values()) {
      if (p.id === rd.conductorId || note.results.has(p.id)) continue;
      if (note.arriveAt - rd.travelMs < p.joinedAt) continue;
      applyResult(r, p, note, note.correct ? 'miss' : 'dodge');
    }
  }
  r.status = 'roundEnd';
  const lastRound = r.roundNum >= r.settings.rounds;
  const standings = playerList(r)
    .map((p) => ({
      id: p.id, name: p.name, color: p.color, score: p.score,
      roundScore: p.score - (rd.roundStartScores.get(p.id) ?? 0),
      hits: p.hits, misses: p.misses, oops: p.oops, dodges: p.dodges, maxCombo: p.maxCombo,
      tripped: p.tripped, wasConductor: p.id === rd.conductorId,
    }))
    .sort((a, b) => b.score - a.score);

  if (lastRound) {
    r.status = 'lobby';
    io.to(r.id).emit('gameOver', { standings });
  } else {
    io.to(r.id).emit('roundEnd', {
      num: rd.num, total: r.settings.rounds, category: rd.category, standings,
      nextAt: now() + ROUND_BREAK_MS,
    });
    r.timer = setTimeout(() => rooms.has(r.id) && r.status === 'roundEnd' && startRound(r), ROUND_BREAK_MS);
  }
  r.round = null;
  emitRoom(r);
  broadcastRooms();
}

// ---------------------------------------------------------------- membership

function addPlayer(r, socket, name) {
  let finalName = name;
  const names = new Set([...r.players.values()].map((p) => p.name.toLowerCase()));
  for (let i = 2; names.has(finalName.toLowerCase()); i++) finalName = `${name} ${i}`;
  const used = new Set([...r.players.values()].map((p) => p.color));
  const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? pick(PLAYER_COLORS);
  const p = { id: socket.id, name: finalName, color, joinedAt: now(), ...freshStats() };
  r.players.set(socket.id, p);
  r.order.push(socket.id);
  socket.leave('lobby');
  socket.join(r.id);
  socket.data.roomId = r.id;
  return p;
}

function leaveRoom(socket) {
  const r = rooms.get(socket.data.roomId);
  socket.data.roomId = null;
  if (!r) return;
  socket.leave(r.id);
  r.players.delete(socket.id);
  r.order = r.order.filter((id) => id !== socket.id);

  if (r.players.size === 0) {
    clearTimeout(r.timer);
    rooms.delete(r.id);
    broadcastRooms();
    return;
  }
  if (r.hostId === socket.id) {
    r.hostId = r.order[0];
    io.to(r.id).emit('toast', `${r.players.get(r.hostId).name} is now the host.`);
  }
  const rd = r.round;
  if (rd && rd.conductorId === socket.id) {
    rd.conductorId = null; // Robo-Conductor takes over for the rest of the round
    io.to(r.id).emit('conductorChange', { conductorId: null, conductorName: 'Robo-Conductor' });
  }
  // Nobody left to play against the conductor: stop the game.
  if (rd && rd.conductorId && r.players.size < 2) {
    r.status = 'lobby';
    r.round = null;
    io.to(r.id).emit('toast', 'Not enough players - back to the room.');
    io.to(r.id).emit('backToRoom');
  }
  emitRoom(r);
  broadcastRooms();
}

// ---------------------------------------------------------------- sockets

io.on('connection', (socket) => {
  socket.join('lobby');
  socket.emit('rooms', [...rooms.values()].map(roomSummary));

  socket.on('timesync', (_t, cb) => typeof cb === 'function' && cb(now()));

  socket.on('createRoom', (data, cb) => {
    if (typeof cb !== 'function') return;
    if (socket.data.roomId) leaveRoom(socket);
    const name = clean(data?.playerName, 16);
    if (!name) return cb({ error: 'Please enter your name.' });
    const r = {
      id: makeRoomId(),
      name: clean(data?.roomName, 28) || `${name}'s Band`,
      hostId: socket.id,
      status: 'lobby',
      settings: sanitizeSettings(data?.settings),
      custom: sanitizeCustom(data?.custom),
      players: new Map(),
      order: [],
      roundNum: 0,
      usedCategories: [],
      round: null,
      timer: null,
    };
    rooms.set(r.id, r);
    addPlayer(r, socket, name);
    cb({ ok: true, roomId: r.id, me: socket.id });
    emitRoom(r);
    broadcastRooms();
  });

  socket.on('joinRoom', (data, cb) => {
    if (typeof cb !== 'function') return;
    const r = rooms.get(String(data?.roomId || '').toUpperCase());
    const name = clean(data?.playerName, 16);
    if (!name) return cb({ error: 'Please enter your name.' });
    if (!r) return cb({ error: 'That game no longer exists.' });
    if (r.players.size >= MAX_PLAYERS) return cb({ error: 'That game is full (8 players).' });
    if (socket.data.roomId) leaveRoom(socket);
    addPlayer(r, socket, name);
    cb({ ok: true, roomId: r.id, me: socket.id });
    emitRoom(r);
    broadcastRooms();
    // Late joiners jump straight into the current round.
    if (r.status === 'playing' && r.round) {
      socket.emit('roundStart', roundPublic(r));
      const future = [...r.round.notes.values()].filter((n) => n.arriveAt > now()).map(publicNote);
      if (future.length) socket.emit('notes', { notes: future, sent: r.round.sent, sentDistractors: r.round.sentDistractors });
    }
  });

  socket.on('leaveRoom', () => {
    leaveRoom(socket);
    socket.join('lobby');
    socket.emit('rooms', [...rooms.values()].map(roomSummary));
  });

  socket.on('updateSettings', (data) => {
    const r = rooms.get(socket.data.roomId);
    if (!r || r.hostId !== socket.id || r.status !== 'lobby') return;
    r.settings = sanitizeSettings(data?.settings);
    r.custom = sanitizeCustom(data?.custom);
    if (data?.roomName) r.name = clean(data.roomName, 28) || r.name;
    emitRoom(r);
    broadcastRooms();
  });

  socket.on('startGame', () => {
    const r = rooms.get(socket.data.roomId);
    if (!r || r.hostId !== socket.id || r.status !== 'lobby') return;
    startGame(r);
  });

  socket.on('sendWords', (items, cb) => {
    const r = rooms.get(socket.data.roomId);
    const reply = typeof cb === 'function' ? cb : () => {};
    if (!r?.round || r.round.conductorId !== socket.id || !Array.isArray(items)) return reply({ error: 'You are not the Conductor.' });
    const err = sendWords(r, items);
    reply(err ? { error: err } : { ok: true });
  });

  socket.on('hit', (data) => {
    const r = rooms.get(socket.data.roomId);
    const rd = r?.round;
    if (!rd || r.status !== 'playing' || rd.conductorId === socket.id) return;
    const p = r.players.get(socket.id);
    const note = rd.notes.get(Number(data?.noteId));
    if (!p || !note || note.results.has(p.id)) return;
    const allowed = note.correct ? RESULTS_CORRECT : RESULTS_WRONG;
    if (!allowed.includes(data?.result)) return;
    applyResult(r, p, note, data.result);
    io.to(r.id).emit('result', {
      pid: p.id, name: p.name, color: p.color, word: note.word, result: data.result, scores: scoreList(r),
    });
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

server.listen(PORT, () => console.log(`Word Musicians listening on http://localhost:${PORT}`));
