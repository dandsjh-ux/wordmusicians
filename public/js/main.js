import { Stage, LANE_COLORS } from './stage.js';
import { AudioEngine, downloadMidi, generateSong } from './audio.js';
import {
  CATEGORIES, MAX_CUSTOM_CATEGORIES, MAX_CUSTOM_WORDS, MIN_CUSTOM_WORDS,
} from '/shared/categories.js';
import {
  LANES, SPEEDS, JUDGE, POINTS, comboBonus, SETTING_LIMITS, CONDUCTOR_MODES, COUNT_IN_BEATS,
  MAX_PLAYERS, sanitizeSettings, maxDistractorsFor,
} from '/shared/rules.js';

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
};
const LANE_KEYS = ['D', 'F', 'J', 'K', 'L'];
const KEY_TO_LANE = { d: 0, f: 1, j: 2, k: 3, l: 4, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 };
const JUDGE_TEXT = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS', oops: 'OOPS!', dodge: 'DODGED' };

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
}

// ================================================================ clock sync

const socket = io({ transports: ['websocket', 'polling'] });
const audio = new AudioEngine();
let clockOffset = 0;
const localNow = () => performance.timeOrigin + performance.now();
const serverNow = () => localNow() + clockOffset;

async function syncClock() {
  const samples = [];
  for (let i = 0; i < 6; i++) {
    const t0 = localNow();
    const st = await new Promise((res) => socket.timeout(2000).emit('timesync', t0, (err, s) => res(err ? null : s)));
    const t1 = localNow();
    if (st) samples.push({ rtt: t1 - t0, off: st - (t0 + t1) / 2 });
    await new Promise((r) => setTimeout(r, 100));
  }
  if (samples.length) {
    samples.sort((a, b) => a.rtt - b.rtt);
    clockOffset = samples[0].off;
  }
}
setInterval(() => socket.connected && syncClock(), 30000);

// ================================================================ state

const state = {
  me: null,
  room: null,
  round: null,
  role: 'none', // 'player' | 'conductor' | 'none'
  scores: [],
  combo: 0,
  stats: { hits: 0, total: 0 },
  hostMode: 'create', // 'create' | 'edit'
  lastCountdown: null,
  inGame: false,
};

const stage = new Stage($('#stage'), { serverNow });
let attract = true;

// ================================================================ screens

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${id}`));
  state.screen = id;
  state.inGame = id === 'game';
  attract = !state.inGame;
  if (attract) {
    stage.setConductorView(false);
    stage.setTravel(3400);
  }
  document.body.classList.toggle('conducting', state.inGame && state.role === 'conductor');
}

function overlay(id, on) {
  $(`#${id}`).classList.toggle('hidden', !on);
}

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function myName() {
  return $('#name-input').value.trim();
}

function requireName() {
  const n = myName();
  if (!n) {
    toast('Type your name first!');
    $('#name-input').focus();
    return null;
  }
  store('wm.name', n);
  return n;
}

// ================================================================ home

$('#name-input').value = store('wm.name') || '';

socket.on('connect', () => {
  const s = $('#conn-status');
  s.textContent = 'online';
  s.className = 'pill ok';
  syncClock();
  if (state.room) {
    // Our old socket's seat is gone after a reconnect.
    state.room = null;
    leaveToHome('You were disconnected. Please re-join the game.');
  }
});
socket.on('disconnect', () => {
  const s = $('#conn-status');
  s.textContent = 'offline';
  s.className = 'pill bad';
  if (state.room) toast('Connection lost… reconnecting', 4000);
});

socket.on('rooms', (rooms) => {
  const list = $('#room-list');
  list.replaceChildren();
  if (!rooms.length) {
    list.append(el('li', { className: 'empty', textContent: 'No games yet. Host one!' }));
    return;
  }
  for (const r of rooms) {
    const status = r.status === 'lobby' ? 'Waiting to start' : `Playing round ${r.roundNum}/${r.rounds}`;
    const full = r.players >= r.max;
    const btn = el('button', { className: 'btn primary small', textContent: full ? 'Full' : 'Join', disabled: full });
    btn.onclick = () => joinRoom(r.id);
    list.append(el('li', {},
      el('div', { className: 'info' },
        el('b', { textContent: r.name }),
        el('small', { textContent: `Host: ${r.host} · ${r.players}/${r.max} players · ${status}` })),
      btn));
  }
});

function joinRoom(roomId) {
  audio.unlock();
  const playerName = requireName();
  if (!playerName) return;
  socket.emit('joinRoom', { roomId, playerName }, (res) => {
    if (res.error) return toast(res.error);
    state.me = res.me;
    show('room');
  });
}

$('#btn-host').onclick = () => {
  audio.unlock();
  if (!requireName()) return;
  openHostSetup('create');
};

// ================================================================ host setup

const settingIds = Object.keys(SETTING_LIMITS);
const settingLabel = {
  speed: (v) => `${SPEEDS[v].label} (${SPEEDS[v].bpm} bpm)`,
  roundSeconds: (v) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`,
  wordsPerRound: (v) => v,
  distractors: (v) => v,
  maxDistractorPct: (v) => `${v}%`,
  rounds: (v) => v,
};

for (const id of settingIds) {
  const input = $(`#set-${id}`);
  const [min, max, def] = SETTING_LIMITS[id];
  input.min = min;
  input.max = max;
  input.value = def;
  input.oninput = () => ($(`#val-${id}`).textContent = settingLabel[id](+input.value));
}
const modeSel = $('#set-conductorMode');
for (const [k, v] of Object.entries(CONDUCTOR_MODES)) modeSel.append(el('option', { value: k, textContent: v }));

const catGrid = $('#cat-grid');
for (const c of CATEGORIES) {
  catGrid.append(el('label', { className: 'cat-chip' },
    el('input', { type: 'checkbox', value: c.id, checked: true }),
    el('span', { className: 'emo', textContent: c.emoji }),
    el('span', { textContent: c.name })));
}
$('#cat-all').onclick = () => catGrid.querySelectorAll('input').forEach((i) => (i.checked = true));
$('#cat-none').onclick = () => catGrid.querySelectorAll('input').forEach((i) => (i.checked = false));

const splitWords = (text) => text.split(/[,\n;]/).map((w) => w.trim()).filter(Boolean);

function addCustomCard(data = { name: '', words: [] }) {
  const list = $('#custom-list');
  if (list.children.length >= MAX_CUSTOM_CATEGORIES) return toast(`You can have up to ${MAX_CUSTOM_CATEGORIES} custom categories.`);
  const name = el('input', { maxLength: 24, placeholder: 'Category name, e.g. Pets', value: data.name });
  const words = el('textarea', { placeholder: 'Up to 10 words, separated by commas or new lines', value: data.words.join(', ') });
  const count = el('div', { className: 'count' });
  const del = el('button', { className: 'btn tiny danger del', textContent: '✕', title: 'Remove' });
  const card = el('div', { className: 'custom-card' }, name, del, words, count);
  const update = () => {
    const n = splitWords(words.value).length;
    count.textContent = `${n}/${MAX_CUSTOM_WORDS} words${n && n < MIN_CUSTOM_WORDS ? ` (need at least ${MIN_CUSTOM_WORDS})` : ''}`;
    count.classList.toggle('bad', n > MAX_CUSTOM_WORDS || (n > 0 && n < MIN_CUSTOM_WORDS));
  };
  words.oninput = update;
  del.onclick = () => card.remove();
  update();
  list.append(card);
}
$('#btn-add-custom').onclick = () => addCustomCard();

function readCustom() {
  const out = [];
  const problems = [];
  $('#custom-list').querySelectorAll('.custom-card').forEach((card, i) => {
    const name = card.querySelector('input').value.trim();
    const words = [...new Set(splitWords(card.querySelector('textarea').value))];
    if (!name && !words.length) return;
    if (!name) problems.push(`Custom category ${i + 1} needs a name.`);
    else if (words.length < MIN_CUSTOM_WORDS) problems.push(`"${name}" needs at least ${MIN_CUSTOM_WORDS} words.`);
    else if (words.length > MAX_CUSTOM_WORDS) problems.push(`"${name}" has more than ${MAX_CUSTOM_WORDS} words.`);
    else out.push({ name, words });
  });
  return { custom: out, problems };
}

function readSettingsForm() {
  const s = { conductorMode: modeSel.value };
  for (const id of settingIds) s[id] = +$(`#set-${id}`).value;
  const { custom, problems } = readCustom();
  s.categories = [
    ...[...catGrid.querySelectorAll('input:checked')].map((i) => i.value),
    ...custom.map((_, i) => `custom${i + 1}`), // server numbers valid custom categories in order
  ];
  return { settings: s, custom, problems };
}

function fillSettingsForm(settings, custom) {
  const s = sanitizeSettings(settings || {});
  for (const id of settingIds) $(`#set-${id}`).value = s[id];
  modeSel.value = s.conductorMode;
  const chosen = settings?.categories;
  catGrid.querySelectorAll('input').forEach((i) => (i.checked = !chosen?.length || chosen.includes(i.value)));
  $('#custom-list').replaceChildren();
  (custom || []).forEach((c) => addCustomCard(c));
  settingIds.forEach((id) => $(`#set-${id}`).oninput());
}

function openHostSetup(mode) {
  state.hostMode = mode;
  $('#host-error').textContent = '';
  if (mode === 'edit' && state.room) {
    $('#host-title').textContent = 'Game Settings';
    $('#btn-host-go').textContent = 'Save ✓';
    $('#room-name').value = state.room.name;
    fillSettingsForm(state.room.settings, state.room.custom);
  } else {
    const saved = store('wm.host') || {};
    $('#host-title').textContent = 'Host a Game';
    $('#btn-host-go').textContent = 'Create Game ▶';
    $('#room-name').value = saved.roomName || `${myName()}'s Band`;
    fillSettingsForm(saved.settings, saved.custom);
  }
  show('host');
}

$('#btn-host-back').onclick = () => show(state.hostMode === 'edit' ? 'room' : 'home');

$('#btn-host-go').onclick = () => {
  const { settings, custom, problems } = readSettingsForm();
  if (problems.length) {
    $('#host-error').textContent = problems.join(' ');
    return;
  }
  const builtIn = catGrid.querySelectorAll('input:checked').length;
  if (!builtIn && !custom.length) {
    $('#host-error').textContent = 'Pick at least one category (or add a custom one).';
    return;
  }
  const roomName = $('#room-name').value.trim();
  store('wm.host', { roomName, settings, custom });
  if (state.hostMode === 'edit') {
    socket.emit('updateSettings', { settings, custom, roomName });
    show('room');
    return;
  }
  socket.emit('createRoom', { playerName: myName(), roomName, settings, custom }, (res) => {
    if (res.error) return toast(res.error);
    state.me = res.me;
    show('room');
  });
};

$('#btn-midi').onclick = () => {
  const speed = SPEEDS[+$('#set-speed').value];
  downloadMidi(generateSong(Math.floor(Math.random() * 1e9)), speed.bpm, `word-musicians-${speed.label.toLowerCase()}.mid`);
};

// ================================================================ room

socket.on('room', (room) => {
  state.room = room;
  renderRoom();
  if (state.inGame) {
    renderScoreboard();
    updateHud();
  }
});

function renderRoom() {
  const r = state.room;
  if (!r) return;
  const isHost = r.hostId === state.me;
  $('#room-title').textContent = r.name;
  $('#room-code').textContent = r.id;
  $('#player-count').textContent = `Players (${r.players.length}/${MAX_PLAYERS})`;
  $('#player-list').replaceChildren(...r.players.map((p) => el('li', { className: p.id === state.me ? 'me' : '' },
    el('i', { className: 'dot', style: `background:${p.color};color:${p.color}` }),
    el('span', { textContent: `${p.isHost ? '👑 ' : ''}${p.name}${p.id === state.me ? ' (you)' : ''}` }))));

  const s = r.settings;
  const cats = [...CATEGORIES, ...r.custom.map((c, i) => ({ ...c, id: `custom${i + 1}` }))];
  const chosen = cats.filter((c) => s.categories.includes(c.id));
  const catText = chosen.length === 0 || chosen.length === cats.length ? 'All categories' : chosen.map((c) => c.emoji + ' ' + c.name).join(', ');
  const pills = [
    `⚡ ${SPEEDS[s.speed].label}`, `⏱ ${settingLabel.roundSeconds(s.roundSeconds)} per round`,
    `🎵 ${s.wordsPerRound} words`, `🃏 ${s.distractors} tricks (max ${maxDistractorsFor(s)} sent)`,
    `🔁 ${s.rounds} rounds`, `🎼 ${CONDUCTOR_MODES[s.conductorMode]}`, `📚 ${catText}`,
  ];
  $('#room-settings').replaceChildren(...pills.map((t) => el('span', { className: 'pill', textContent: t })));

  $('#btn-start').classList.toggle('hidden', !isHost);
  $('#btn-edit-settings').classList.toggle('hidden', !isHost);
  $('#btn-start').disabled = r.status !== 'lobby';
  let hint;
  if (r.status !== 'lobby') hint = 'A round is in progress. You will join in a moment…';
  else if (!isHost) hint = 'Waiting for the host to start the game…';
  else if (r.players.length < 2 || s.conductorMode === 'bot') hint = 'The Robo-Conductor will send the words. Invite friends to take turns conducting!';
  else hint = 'Everyone gets a turn as Conductor. Press Start when your band is ready!';
  $('#room-hint').textContent = hint;
}

$('#btn-start').onclick = () => {
  audio.unlock();
  socket.emit('startGame');
};
$('#btn-edit-settings').onclick = () => openHostSetup('edit');
$('#btn-leave').onclick = () => leaveToHome();

function leaveToHome(msg) {
  socket.emit('leaveRoom');
  audio.stopSong(0.3);
  state.room = null;
  state.round = null;
  state.role = 'none';
  stage.clearNotes();
  ['overlay-results', 'overlay-final', 'menu'].forEach((o) => overlay(o, false));
  $('#conductor-panel').classList.add('hidden');
  show('home');
  syncInset();
  if (msg) toast(msg, 4000);
}

socket.on('toast', (m) => toast(m));
socket.on('backToRoom', () => {
  audio.stopSong();
  state.round = null;
  stage.clearNotes();
  ['overlay-results', 'overlay-final'].forEach((o) => overlay(o, false));
  show('room');
});

// ================================================================ rounds

socket.on('roundStart', (rd) => {
  state.round = rd;
  state.role = rd.conductorId === state.me ? 'conductor' : 'player';
  state.stats = { hits: 0, total: 0 };
  state.scores = [];
  state.combo = 0;
  state.lastCountdown = null;
  ['overlay-results', 'overlay-final'].forEach((o) => overlay(o, false));
  show('game');
  stage.clearNotes();
  stage.setTravel(rd.travelMs);
  stage.setConductorView(state.role === 'conductor');
  $('#conductor-panel').classList.toggle('hidden', state.role !== 'conductor');
  syncInset();
  $('#combo-box').classList.toggle('hidden', state.role === 'conductor');
  $('#lane-keys').classList.toggle('hidden', state.role === 'conductor');
  $('#cat-emoji').textContent = rd.category.emoji;
  $('#cat-name').textContent = rd.category.name;
  updateRoleBanner();
  const big = $('#big-category');
  big.innerHTML = '';
  big.append(
    el('small', { className: 'txt', textContent: `Round ${rd.num} of ${rd.total}` }),
    el('span', { textContent: `${rd.category.emoji} ` }),
    el('span', { className: 'txt', textContent: rd.category.name.toUpperCase() }),
  );
  big.classList.remove('show');
  void big.offsetWidth;
  big.classList.add('show');
  if (state.role === 'conductor') resetConductor();
  renderScoreboard();
  updateHud();
  audio.startSong({ seed: rd.songSeed, bpm: rd.bpm, startAt: rd.startAt }, serverNow);
});

function updateRoleBanner() {
  const rd = state.round;
  const b = $('#role-banner');
  if (state.role === 'conductor') b.textContent = 'Trip them up with trick words!';
  else b.textContent = `Only hit ${rd.category.name}! Conductor: ${rd.conductorName}`;
}

socket.on('conductorChange', ({ conductorId, conductorName }) => {
  if (!state.round) return;
  state.round.conductorId = conductorId;
  state.round.conductorName = conductorName;
  toast(`${conductorName} has taken over the baton!`);
  updateRoleBanner();
  renderScoreboard();
});

socket.on('notes', ({ notes, sent, sentDistractors }) => {
  if (!state.round) return;
  state.round.sent = sent;
  state.round.sentDistractors = sentDistractors;
  for (const n of notes) stage.addNote(n);
  if (state.role === 'conductor') renderBudget();
});

socket.on('result', ({ pid, name, word, result, scores }) => {
  state.scores = scores;
  renderScoreboard();
  if (pid === state.me) {
    const mine = scores.find((s) => s.id === state.me);
    if (mine) state.combo = mine.combo;
    updateHud();
    return;
  }
  // Feed: everyone sees trick hits; the conductor also sees misses (their points!).
  if (result === 'oops') feed(`${name} fell for "${word}"!`, 'oops');
  else if (result === 'miss' && state.role === 'conductor') feed(`${name} missed "${word}"`, 'miss');
});

function feed(text, cls) {
  const f = $('#feed');
  f.append(el('div', { className: cls, textContent: text }));
  while (f.children.length > 5) f.firstChild.remove();
  setTimeout(() => f.firstChild && f.firstChild.textContent === text && f.firstChild.remove(), 4200);
}

socket.on('roundEnd', ({ num, total, category, standings, nextAt }) => {
  audio.stopSong();
  state.round = null;
  $('#conductor-panel').classList.add('hidden');
  $('#res-title').textContent = `Round ${num} of ${total} complete! ${category.emoji} ${category.name}`;
  $('#res-body').replaceChildren(...standings.map((p, i) => el('tr', { className: p.id === state.me ? 'me' : '' },
    el('td', { className: 'num', textContent: i + 1 }),
    el('td', { textContent: `${p.wasConductor ? '🎼 ' : ''}${p.name}` }),
    el('td', { className: 'plus', textContent: `+${p.roundScore}` }),
    el('td', { className: 'num', textContent: p.score }))));
  overlay('overlay-results', true);
  const tick = () => {
    const s = Math.max(0, Math.ceil((nextAt - serverNow()) / 1000));
    $('#res-next').textContent = `Next round in ${s}… the baton passes on!`;
    if (s > 0 && !$('#overlay-results').classList.contains('hidden')) setTimeout(tick, 250);
  };
  tick();
});

socket.on('gameOver', ({ standings }) => {
  audio.stopSong();
  state.round = null;
  $('#conductor-panel').classList.add('hidden');
  audio.cue('fanfare');
  const medals = ['🥇', '🥈', '🥉'];
  const order = [1, 0, 2].filter((i) => standings[i]);
  $('#podium').replaceChildren(...order.map((i) => el('div', { className: `step p${i + 1}` },
    el('span', { className: 'medal', textContent: medals[i] }),
    el('span', { className: 'nm', textContent: standings[i].name }),
    el('span', { textContent: standings[i].score }))));
  $('#final-body').replaceChildren(...standings.map((p, i) => el('tr', { className: p.id === state.me ? 'me' : '' },
    el('td', { className: 'num', textContent: i + 1 }),
    el('td', { textContent: p.name }),
    el('td', { textContent: p.hits }),
    el('td', { textContent: p.tripped ? `${p.oops} (tricked ${p.tripped} as 🎼)` : p.oops }),
    el('td', { textContent: p.maxCombo }),
    el('td', { className: 'num', textContent: p.score }))));
  overlay('overlay-results', false);
  overlay('overlay-final', true);
});

$('#btn-final-room').onclick = () => {
  overlay('overlay-final', false);
  stage.clearNotes();
  show('room');
  renderRoom();
};

// ================================================================ HUD

// Keep the 3D road framed above the conductor panel.
const panel = $('#conductor-panel');
function syncInset() {
  stage.setBottomInset(state.inGame && !panel.classList.contains('hidden') ? panel.offsetHeight : 0);
}
new ResizeObserver(syncInset).observe(panel);
window.addEventListener('resize', syncInset);

function renderScoreboard() {
  const r = state.room;
  if (!r) return;
  const byId = new Map(state.scores.map((s) => [s.id, s]));
  const rows = r.players
    .map((p) => ({ ...p, score: byId.get(p.id)?.score ?? p.score }))
    .sort((a, b) => b.score - a.score);
  $('#scoreboard').replaceChildren(...rows.map((p) => el('li', { className: p.id === state.me ? 'me' : '' },
    el('i', { className: 'dot', style: `background:${p.color};color:${p.color}` }),
    el('span', { className: 'n', textContent: `${state.round?.conductorId === p.id ? '🎼 ' : ''}${p.name}` }),
    el('span', { className: 's', textContent: p.score }))));
}

function myScore() {
  const s = state.scores.find((x) => x.id === state.me);
  return s ? s.score : state.room?.players.find((p) => p.id === state.me)?.score ?? 0;
}

function updateHud() {
  $('#score').textContent = String(Math.max(0, myScore())).padStart(7, '0');
  const c = $('#combo-box');
  $('#combo').textContent = state.combo;
  c.classList.toggle('zero', state.combo === 0);
  const { hits, total } = state.stats;
  const acc = total ? hits / total : 1;
  $('#grade').textContent = state.role === 'conductor' ? '🎼' : !total ? '-' : acc >= 0.95 ? 'S' : acc >= 0.85 ? 'A' : acc >= 0.7 ? 'B' : 'C';
}

function showJudgement(lane, result) {
  const j = judgeEls[lane];
  j.textContent = JUDGE_TEXT[result];
  j.className = `judge ${result}`;
  void j.offsetWidth;
  j.classList.add('show');
}

const judgeEls = [];
const keyEls = [];
for (let i = 0; i < LANES; i++) {
  judgeEls.push($('#judgements').appendChild(el('div', { className: 'judge' })));
  keyEls.push($('#lane-keys').appendChild(el('div', { className: 'lane-key', textContent: LANE_KEYS[i] })));
}
stage.onLayout = () => {
  for (let i = 0; i < LANES; i++) {
    const p = stage.laneScreenPos(i, 1.5);
    judgeEls[i].style.left = `${p.x}px`;
    judgeEls[i].style.top = `${p.y}px`;
    const k = stage.laneScreenPos(i, -0.0);
    keyEls[i].style.left = `${k.x}px`;
    keyEls[i].style.top = `${k.y + 14}px`;
  }
};
stage.onLayout();

function flashRed() {
  const f = $('#flash');
  f.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
}

// ================================================================ playing

function judgeResult(note, result) {
  socket.emit('hit', { noteId: note.id, result });
  const lane = note.lane;
  showJudgement(lane, result);
  audio.cue(result, lane);
  if (result === 'perfect' || result === 'great' || result === 'good') {
    state.combo += 1;
    state.stats.hits += 1;
    state.stats.total += 1;
    const box = $('#combo-box');
    box.classList.add('bump');
    setTimeout(() => box.classList.remove('bump'), 90);
  } else if (result === 'miss' || result === 'oops') {
    state.combo = 0;
    state.stats.total += 1;
    if (result === 'oops') {
      flashRed();
      toast(`"${note.word}" isn't ${state.round?.category.name ?? 'in the category'}!`, 1500);
    }
  }
  updateHud();
}

function pressLane(lane) {
  if (attract) return;
  stage.pressLane(lane);
  if (state.role === 'conductor') {
    selectSlot(lane);
    return;
  }
  if (state.role !== 'player' || !state.round) return;
  const t = serverNow();
  let best = null;
  let bd = Infinity;
  for (const n of stage.pendingInLane(lane)) {
    const d = Math.abs(n.arriveAt - t);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  if (!best || bd > JUDGE.good) {
    audio.cue('tap');
    return;
  }
  const result = !best.correct ? 'oops' : bd <= JUDGE.perfect ? 'perfect' : bd <= JUDGE.great ? 'great' : 'good';
  stage.resolve(best.id, { hit: true, good: best.correct });
  judgeResult(best, result);
}

// Per-frame: countdown, timer, auto-judging notes that slid past, attract mode.
stage.onFrame = (t) => {
  if (attract) return attractFrame(t);
  const rd = state.round;
  if (!rd) return;

  const beat = Math.floor((t - rd.startAt) / rd.beatMs);
  const cd = $('#countdown');
  const label = beat < 0 ? '' : beat === 0 ? 'READY?' : beat < COUNT_IN_BEATS ? String(COUNT_IN_BEATS - beat) : beat === COUNT_IN_BEATS ? 'GO!' : '';
  if (label !== state.lastCountdown) {
    state.lastCountdown = label;
    cd.textContent = label;
    cd.classList.remove('pop');
    void cd.offsetWidth;
    if (label) cd.classList.add('pop');
  }

  const first = rd.startAt + COUNT_IN_BEATS * rd.beatMs;
  const left = Math.max(0, rd.endAt - Math.max(t, first));
  $('#timer-fill').style.transform = `scaleX(${left / (rd.endAt - first)})`;
  const secs = Math.ceil(left / 1000);
  const wordsLeft = rd.wordsPerRound - rd.sent;
  $('#timer-text').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} · ${wordsLeft} words left`;

  if (state.role === 'player') {
    for (const n of stage.allPending()) {
      if (t - n.arriveAt > JUDGE.good) {
        stage.resolve(n.id, { hit: false });
        judgeResult(n, n.correct ? 'miss' : 'dodge');
      }
    }
  } else {
    for (const n of stage.allPending()) if (t - n.arriveAt > JUDGE.good) stage.resolve(n.id, { hit: false });
  }
  if (state.role === 'conductor') {
    $('#cp-send').classList.toggle('cooling', t < cp.cooldownUntil);
  }
};

// Home-screen eye candy: words fly down and get "played" automatically.
let attractNext = 0;
let attractId = -1;
function attractFrame(t) {
  if (t > attractNext) {
    attractNext = t + 430 + Math.random() * 500;
    const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    const word = cat.words[Math.floor(Math.random() * cat.words.length)];
    stage.addNote({ id: attractId--, word, lane: Math.floor(Math.random() * LANES), correct: true, arriveAt: t + 3400 });
  }
  for (const n of stage.allPending()) {
    if (t >= n.arriveAt) {
      stage.pressLane(n.lane);
      stage.resolve(n.id, { hit: true, good: true });
    }
  }
}

// ================================================================ input

const isTyping = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state.inGame) toggleMenu();
    return;
  }
  if (isTyping(e) || e.repeat || !state.inGame || !$('#menu').classList.contains('hidden')) return;
  const lane = KEY_TO_LANE[e.key.toLowerCase()];
  if (lane !== undefined) {
    e.preventDefault();
    pressLane(lane);
    return;
  }
  if (state.role === 'conductor') {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      conductorSend();
    } else if (e.key === 'Backspace') {
      clearSlots();
    }
  }
});

// Mouse + touch: tap anywhere in a lane (multi-touch friendly).
$('#screen-game').addEventListener('pointerdown', (e) => {
  if (e.target.closest('button, .conductor-panel, .overlay')) return;
  if (e.pointerType === 'touch') document.body.classList.add('touch');
  e.preventDefault();
  audio.unlock();
  pressLane(stage.laneAt(e.clientX, e.clientY));
});
document.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });
document.addEventListener('pointerdown', () => audio.unlock(), { passive: true });

// ================================================================ menu

function toggleMenu(force) {
  const m = $('#menu');
  const open = force ?? m.classList.contains('hidden');
  m.classList.toggle('hidden', !open);
}
$('#btn-esc').onclick = () => toggleMenu(true);
$('#menu-resume').onclick = () => toggleMenu(false);
$('#menu-leave').onclick = () => leaveToHome();
$('#menu-midi').onclick = () => {
  const song = audio.song ?? generateSong(Math.floor(Math.random() * 1e9));
  downloadMidi(song, audio.bpm ?? 108, `word-musicians-round.mid`);
};
$('#vol-music').value = audio.musicVolume;
$('#vol-sfx').value = audio.sfxVolume;
$('#vol-music').oninput = (e) => audio.setMusicVolume(+e.target.value);
$('#vol-sfx').oninput = (e) => audio.setSfxVolume(+e.target.value);

// ================================================================ conductor

const cp = { slots: new Array(LANES).fill(null), active: 0, palette: [], cooldownUntil: 0 };

function resetConductor() {
  cp.slots.fill(null);
  cp.active = 0;
  cp.palette = [];
  cp.cooldownUntil = 0;
  renderPalette();
  renderSlots();
  renderBudget();
}

socket.on('palette', (palette) => {
  cp.palette = palette;
  renderPalette();
});

/** How many more trick words may be staged right now. */
function tricksLeft() {
  const rd = state.round;
  if (!rd) return 0;
  const stagedTricks = cp.slots.filter((w) => w && !isCorrect(w)).length;
  const stagedReal = cp.slots.filter((w) => w && isCorrect(w)).length;
  const tricks = rd.sentDistractors + stagedTricks;
  const real = rd.sent - rd.sentDistractors + stagedReal;
  // Limit per round, and real words must always outnumber trick words.
  return Math.min(rd.maxDistractors - tricks, real - tricks - 1);
}
const isCorrect = (word) => cp.palette.find((p) => p.word === word)?.correct;

function renderPalette() {
  const wrap = $('#cp-palette');
  const noTricks = tricksLeft() <= 0;
  wrap.replaceChildren(...cp.palette.map((p) => {
    const b = el('button', { className: `chip ${p.correct ? 'good' : 'bad'}`, textContent: p.word });
    b.disabled = !p.correct && noTricks;
    if (b.disabled) b.title = 'Real words must outnumber trick words';
    b.onclick = () => placeWord(p.word);
    b.ondblclick = () => conductorSend();
    return b;
  }));
}

function renderSlots() {
  $('#cp-slots').replaceChildren(...cp.slots.map((w, i) => {
    const b = el('button', {
      className: `slot${w ? ' filled' : ''}${w && !isCorrect(w) ? ' trick' : ''}${cp.active === i ? ' active' : ''}`,
      style: `--lane:${LANE_COLORS[i]}`,
    }, el('small', { textContent: `${i + 1} · ${LANE_KEYS[i]}` }), w || '—');
    b.onclick = () => {
      if (cp.active === i && cp.slots[i]) cp.slots[i] = null;
      cp.active = i;
      renderSlots();
      renderPalette();
    };
    return b;
  }));
}

function renderBudget() {
  const rd = state.round;
  if (!rd) return;
  const real = rd.sent - rd.sentDistractors;
  $('#cp-budget').textContent = `Words ${rd.sent}/${rd.wordsPerRound} · Real ${real} · Tricks ${rd.sentDistractors}/${rd.maxDistractors}`;
  $('#cp-budget').title = 'You must always send more real words than trick words.';
  renderPalette();
}

function placeWord(word) {
  if (!isCorrect(word) && tricksLeft() <= 0) {
    const rd = state.round;
    return toast(rd && rd.sentDistractors >= rd.maxDistractors
      ? 'No trick words left this round!'
      : 'Send more real words first: real words must outnumber trick words.');
  }
  cp.slots[cp.active] = word;
  audio.cue('click');
  // advance to the next empty slot
  for (let k = 1; k <= LANES; k++) {
    const j = (cp.active + k) % LANES;
    if (!cp.slots[j]) {
      cp.active = j;
      break;
    }
  }
  renderSlots();
  renderPalette();
}

function selectSlot(lane) {
  cp.active = lane;
  renderSlots();
}

function clearSlots() {
  cp.slots.fill(null);
  cp.active = 0;
  renderSlots();
  renderPalette();
}

function conductorSend() {
  const rd = state.round;
  if (!rd || state.role !== 'conductor') return;
  const items = cp.slots.map((word, lane) => (word ? { word, lane } : null)).filter(Boolean);
  if (!items.length) return toast('Tap a word to put it in a lane first.');
  if (serverNow() < cp.cooldownUntil) return;
  cp.cooldownUntil = serverNow() + rd.beatMs;
  socket.emit('sendWords', items, (res) => {
    if (res?.error) {
      toast(res.error);
      return;
    }
    audio.cue('send');
    clearSlots();
  });
}

function randomPlace(correct) {
  const options = cp.palette.filter((p) => p.correct === correct);
  if (!options.length) return toast(correct ? 'No words available.' : 'No trick words this round.');
  placeWord(options[Math.floor(Math.random() * options.length)].word);
}

$('#cp-send').onclick = conductorSend;
$('#cp-clear').onclick = clearSlots;
$('#cp-rand-good').onclick = () => randomPlace(true);
$('#cp-rand-trick').onclick = () => randomPlace(false);

// Make sure word textures use the game font once it has loaded.
document.fonts?.ready.then(() => stage.texCache.clear());

// Expose a few hooks for debugging in the console.
window.wm = { state, stage, audio, socket, serverNow, POINTS, comboBonus };
