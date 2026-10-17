# 🎵 Word Musicians

A multiplayer Three.js rhythm word game for up to 8 players (Year 3 vocabulary).

Each round has a category, such as **Animals**. Words slide down a 5-lane neon highway. **Word Musicians** hit the words that fit the category and let the **trick words** slide past. One player is the **Conductor**, who picks words live and sends them down the lanes to trip everyone up. The Conductor role rotates every round.

## How to play

| Musicians | Conductor |
|---|---|
| Tap or click a lane, or press <kbd>D</kbd> <kbd>F</kbd> <kbd>J</kbd> <kbd>K</kbd> <kbd>L</kbd> (or <kbd>1</kbd>–<kbd>5</kbd>), when a word reaches the line | Tap words to put them into lane slots, then press **SEND** (<kbd>Space</kbd>). Up to 5 words can be sent at once. |
| ✅ Correct word: PERFECT 300 / GREAT 200 / GOOD 100, plus a combo bonus | +100 for every player who hits a trick word |
| ❌ Trick word hit: −150 and your combo resets | +50 for every player who misses a real word |
| Trick word let through: +50 | Must always send **more real words than trick words**. If they go quiet, the band plays a real word for them. |

## Features

- Start screen with **Host a Game**. Every hosted game appears live on everyone's start screen to join (up to 8 players, Conductor included). Players can also join a game that's already running.
- Host settings: speed (5 tempos), round length, words per round, trick words to choose from, max trick-word %, rounds, and Conductor mode (rotate, host only, or computer Conductor for solo play).
- 16 built-in categories (Animals, Fruit, Vegetables, Colours, Body Parts, Weather, Transport, Clothes, Sports, Shapes, Instruments, Jobs, Ocean Creatures, Minibeasts, Kitchen Things, Feelings). Ambiguous pairs are never used as tricks for each other, e.g. a shark is never a trick word for *Animals*.
- Up to 5 **custom categories** with 3–10 words each. They are saved in the host's browser.
- **Procedural MIDI soundtrack**: every round generates a new song as MIDI note data (drums, bass, pad, arpeggio, lead), synthesised live with Web Audio and synced to the beat for every player. Hit cues play notes from the current chord, and trick hits and misses get their own sounds. The song can be downloaded as a `.mid` file from the host screen or the in-game menu.
- Keyboard, mouse and multi-touch input.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000 in two browser windows to try multiplayer.

## Deploy to Render (via GitHub)

1. Push this folder to a GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Word Musicians"
   git branch -M main
   git remote add origin https://github.com/<you>/word-musicians.git
   git push -u origin main
   ```
2. In Render choose **New → Blueprint**, pick the repository, and Render reads `render.yaml`.
   Alternatively choose **New → Web Service** with:
   - Runtime: **Node**
   - Build command: `npm ci`
   - Start command: `npm start`
   - Health check path: `/healthz`
3. Share the `https://<your-service>.onrender.com` URL with your players.

Notes:
- The server listens on `process.env.PORT`, which Render sets automatically. WebSockets work out of the box on Render.
- Game rooms live in server memory. Run a **single instance**, and expect games to reset when the service restarts or redeploys.
- On Render's free plan the service sleeps after about 15 minutes without traffic. The first visit after that takes 30–60 seconds to wake it.

## Project layout

```
server.js            Express + Socket.io server: lobby, rooms, round timing, scoring
shared/categories.js Word lists and palette (correct + trick words) builder
shared/rules.js      Speeds, timing windows, points, setting limits (used by client and server)
public/index.html    Screens: start, host setup, band room, game HUD, overlays
public/css/style.css Neon UI
public/js/main.js    Client: networking, clock sync, judging, Conductor controls
public/js/stage.js   Three.js highway, word notes, effects, lane hit-testing
public/js/audio.js   MIDI song generator, Web Audio synth, .mid export, sound cues
```

Words land exactly on the beat. The server schedules each word's arrival time on the song's beat grid, and every client syncs its clock to the server. Each player's hits are judged locally against that shared timeline, so lag never makes a hit late.
