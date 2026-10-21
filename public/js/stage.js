// Three.js "note highway": a neon road with 5 lanes. Word notes slide toward
// the hit line at the bottom of the screen.
import * as THREE from 'three';
import { LANES } from '/shared/rules.js';

const LANE_W = 2.1;
const ROAD_W = LANE_W * LANES;
const ROAD_LEN = 30; // shorter road = words stay big and readable for longer
const NOTE_W = LANE_W * 0.98;
const NOTE_H = NOTE_W * 0.5;
export const LANE_COLORS = ['#4ade80', '#f472b6', '#60a5fa', '#facc15', '#c084fc'];
const laneX = (lane) => (lane - (LANES - 1) / 2) * LANE_W;

// Draw order for see-through objects. Three.js sorts transparent objects by
// distance, which let the big road plane paint over words in the far half of
// the highway; explicit layers keep words above the road at every distance.
const LAYER = { road: 0, rails: 1, beams: 2, pads: 3, notes: 10, fx: 20 };

// Colour themes by speed (index matches SPEEDS): calm cool colours for slow
// songs, through to hot colours for fast ones. Each speed has a few variations
// and the round's song seed picks one.
export const THEMES = [
  [ // Chill
    { name: 'Moonlit Lagoon', sky: ['#0b1d4d', '#1e3a8a', '#0e7490', '#2dd4bf'], road: ['#14213d', '#1b2a4a'], rail: '#a5f3fc', glow: '#67e8f9', line: '#99f6e4', streak: '#bae6fd' },
    { name: 'Lavender Dusk', sky: ['#1e1b4b', '#4338ca', '#818cf8', '#c4b5fd'], road: ['#1e1b3a', '#272449'], rail: '#c7d2fe', glow: '#a5b4fc', line: '#ddd6fe', streak: '#e0e7ff' },
    { name: 'Deep Sea', sky: ['#022c43', '#035e7b', '#0891b2', '#67e8f9'], road: ['#0b2230', '#10303f'], rail: '#7dd3fc', glow: '#38bdf8', line: '#a5f3fc', streak: '#cffafe' },
  ],
  [ // Easy
    { name: 'Spring Meadow', sky: ['#14532d', '#15803d', '#65a30d', '#bef264'], road: ['#1a2e22', '#21382a'], rail: '#bbf7d0', glow: '#86efac', line: '#d9f99d', streak: '#ecfccb' },
    { name: 'Morning Sky', sky: ['#1d4ed8', '#3b82f6', '#7dd3fc', '#fde68a'], road: ['#1c2541', '#243056'], rail: '#bfdbfe', glow: '#93c5fd', line: '#fef08a', streak: '#ffffff' },
    { name: 'Mint Bubblegum', sky: ['#0f766e', '#14b8a6', '#5eead4', '#f9a8d4'], road: ['#16302e', '#1d3b38'], rail: '#ccfbf1', glow: '#99f6e4', line: '#fbcfe8', streak: '#fdf2f8' },
  ],
  [ // Groovy
    { name: 'Neon Disco', sky: ['#3b1d8f', '#8b2fc9', '#d946ef', '#f472b6'], road: ['#1c1f2e', '#262a3d'], rail: '#8ee3f5', glow: '#7dd3fc', line: '#5eead4', streak: '#ffffff' },
    { name: 'Grape Soda', sky: ['#2e1065', '#6d28d9', '#a855f7', '#e9d5ff'], road: ['#1f1633', '#2a1f45'], rail: '#e9d5ff', glow: '#c084fc', line: '#f0abfc', streak: '#f5f3ff' },
    { name: 'Retro Wave', sky: ['#1a0b3d', '#5b21b6', '#db2777', '#fb923c'], road: ['#1b1430', '#251b3f'], rail: '#f9a8d4', glow: '#f472b6', line: '#fdba74', streak: '#fce7f3' },
  ],
  [ // Fast
    { name: 'Sunset Drive', sky: ['#7c2d12', '#c2410c', '#f97316', '#fde047'], road: ['#2a1a14', '#35211a'], rail: '#fed7aa', glow: '#fdba74', line: '#fde68a', streak: '#fff7ed' },
    { name: 'Mango Tango', sky: ['#9a3412', '#ea580c', '#f59e0b', '#fef3c7'], road: ['#2b1b10', '#382415'], rail: '#fde68a', glow: '#fbbf24', line: '#fef9c3', streak: '#fffbeb' },
    { name: 'Cherry Pop', sky: ['#831843', '#be185d', '#f43f5e', '#fda4af'], road: ['#2a1420', '#36192a'], rail: '#fecdd3', glow: '#fb7185', line: '#fda4af', streak: '#fff1f2' },
  ],
  [ // Turbo
    { name: 'Red Alert', sky: ['#450a0a', '#991b1b', '#dc2626', '#f97316'], road: ['#1a0f0f', '#241414'], rail: '#fca5a5', glow: '#f87171', line: '#fde047', streak: '#fee2e2' },
    { name: 'Electric Night', sky: ['#020617', '#1e1b4b', '#7e22ce', '#22d3ee'], road: ['#0b0b16', '#12122a'], rail: '#67e8f9', glow: '#22d3ee', line: '#a3e635', streak: '#cffafe' },
    { name: 'Lava Core', sky: ['#1c0a00', '#7c2d12', '#ea580c', '#facc15'], road: ['#160c06', '#22130a'], rail: '#fdba74', glow: '#fb923c', line: '#fef08a', streak: '#fef3c7' },
  ],
];
const STREAK_SPEED = [0.6, 0.8, 1, 1.4, 1.9]; // sky streaks rush past faster on faster songs

/** The colour theme for a speed (index into SPEEDS) and song seed. */
export function themeFor(speed, seed = 0) {
  const set = THEMES[Math.max(0, Math.min(THEMES.length - 1, speed))];
  return { ...set[Math.abs(seed) % set.length], speed };
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export class Stage {
  /**
   * @param {HTMLElement} container
   * @param {{ serverNow: () => number }} opts
   */
  constructor(container, { serverNow }) {
    this.container = container;
    this.serverNow = serverNow;
    this.notes = new Map();
    this.sparks = [];
    this.rings = [];
    this.conductorView = false;
    this.bottomInset = 0;
    this.travelMs = 3400;
    this.laneFlash = new Array(LANES).fill(0);
    this.texCache = new Map();
    this.selectedLane = null;
    this.streakSpeed = 1;

    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
    this._buildBackground();
    this._buildRoad();
    this.setTheme(themeFor(2));

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this._frame());
  }

  // ---------------------------------------------------------------- building

  _buildBackground() {
    // Speed streaks drifting in the sky. (The sky gradient itself comes from the theme.)
    this.streaks = [];
    const streakMat = (this.streakMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }));
    for (let i = 0; i < 28; i++) {
      const len = 4 + Math.random() * 14;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.12 + Math.random() * 0.25), streakMat);
      m.position.set((Math.random() - 0.5) * 160, 2 + Math.random() * 40, -70 - Math.random() * 30);
      m.rotation.z = 0.18;
      m.userData.speed = 10 + Math.random() * 25;
      this.scene.add(m);
      this.streaks.push(m);
    }
  }

  _buildRoad() {
    const s = this.scene;

    // Road surface with lane stripes, fading out into the distance (texture comes from the theme).
    const road = (this.road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_W, ROAD_LEN + 6),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
    ));
    road.rotation.x = -Math.PI / 2;
    road.position.z = -(ROAD_LEN + 6) / 2 + 6;
    road.renderOrder = LAYER.road;
    s.add(road);

    // Rails
    const railMat = (this.railMat = new THREE.MeshBasicMaterial({ color: 0x8ee3f5, transparent: true, opacity: 0.95 }));
    const glowMat = (this.glowMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.25, depthWrite: false }));
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, ROAD_LEN + 6), railMat);
      rail.position.set(side * (ROAD_W / 2 + 0.14), 0.06, road.position.z);
      rail.renderOrder = LAYER.rails;
      s.add(rail);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, ROAD_LEN + 6), glowMat);
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(side * (ROAD_W / 2 + 0.75), 0.01, road.position.z);
      glow.renderOrder = LAYER.rails;
      s.add(glow);
    }

    // Lane glow beams (light up when a lane is pressed).
    const beamTex = canvasTexture(4, 256, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    });
    this.beams = [];
    for (let i = 0; i < LANES; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(LANE_W, 18),
        new THREE.MeshBasicMaterial({
          map: beamTex, color: LANE_COLORS[i], transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(laneX(i), 0.02, -9 + 0.6);
      m.renderOrder = LAYER.beams;
      s.add(m);
      this.beams.push(m);
    }

    // Hit line + target rings + hit pads.
    const line = (this.hitLine = new THREE.Mesh(
      new THREE.BoxGeometry(ROAD_W + 1.2, 0.05, 0.14),
      new THREE.MeshBasicMaterial({ color: 0x5eead4 }),
    ));
    line.position.set(0, 0.05, 0);
    s.add(line);

    const padTex = canvasTexture(256, 96, (g, w, h) => {
      roundRect(g, 8, 8, w - 16, h - 16, 36);
      g.fillStyle = 'rgba(255,255,255,0.92)';
      g.fill();
      g.lineWidth = 8;
      g.strokeStyle = '#ffffff';
      g.stroke();
    });
    this.pads = [];
    for (let i = 0; i < LANES; i++) {
      const pad = new THREE.Mesh(
        new THREE.PlaneGeometry(LANE_W * 0.88, LANE_W * 0.33),
        new THREE.MeshBasicMaterial({ map: padTex, color: LANE_COLORS[i], transparent: true, opacity: 0.18, depthWrite: false }),
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(laneX(i), 0.03, 0);
      pad.renderOrder = LAYER.pads;
      s.add(pad);
      this.pads.push(pad);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.3, 32),
        new THREE.MeshBasicMaterial({ color: 0xccfbf1, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(laneX(i), 0.08, 0);
      s.add(ring);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), new THREE.MeshBasicMaterial({ color: 0x0f766e }));
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(laneX(i), 0.09, 0);
      s.add(dot);
    }

    this.sparkGeo = new THREE.PlaneGeometry(0.16, 0.16);
    this.ringGeo = new THREE.RingGeometry(0.75, 0.95, 40);
  }

  // ---------------------------------------------------------------- theme

  /** Recolour the sky, road and rails. `theme` comes from themeFor(). */
  setTheme(theme) {
    if (this.theme?.name === theme.name) return;
    this.theme = theme;
    const [a, b, c, d] = theme.sky;
    this.scene.background?.dispose();
    this.scene.background = canvasTexture(16, 512, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, a);
      grad.addColorStop(0.45, b);
      grad.addColorStop(0.8, c);
      grad.addColorStop(1, d);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    });
    this.road.material.map?.dispose();
    this.road.material.map = canvasTexture(LANES * 64, 1024, (g, w, h) => {
      for (let i = 0; i < LANES; i++) {
        g.fillStyle = theme.road[i % 2 ? 1 : 0];
        g.fillRect(i * 64, 0, 64, h);
        g.fillStyle = 'rgba(255,255,255,0.06)';
        g.fillRect(i * 64, 0, 2, h);
      }
      // fade far end to transparent
      g.globalCompositeOperation = 'destination-in';
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.18, 'rgba(0,0,0,1)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    });
    this.road.material.needsUpdate = true;
    this.railMat.color.set(theme.rail);
    this.glowMat.color.set(theme.glow);
    this.hitLine.material.color.set(theme.line);
    this.streakMat.color.set(theme.streak);
    this.streakSpeed = STREAK_SPEED[theme.speed] ?? 1;
  }

  // ---------------------------------------------------------------- layout

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    // The road is framed inside the area above any bottom panel (the conductor's
    // controls); the view offset then extends the render down to the full canvas.
    const availH = Math.max(120, h - this.bottomInset);
    const aspect = w / availH;
    this.camera.aspect = aspect;
    this.camera.setViewOffset(w, availH, 0, 0, w, h);

    // Fit the whole road width at the hit line, whatever the screen shape.
    const portrait = Math.max(0, 1.3 - aspect);
    const lookZ = -8 - portrait * 2;
    this.camera.fov = Math.min(80, 52 + portrait * 22);
    this.camera.updateProjectionMatrix();

    // Start close and pull back until the road (with a small margin) just fits:
    // the road fills as much of the screen as possible, so words are as big as possible.
    const target = new THREE.Vector3(0, 0, lookZ);
    const base = new THREE.Vector3(0, 6.4 + portrait * 6, 7.4 + portrait * 7).sub(target);
    const v = new THREE.Vector3();
    const bottomNdc = 1 - 2 * (availH / h) + 0.1; // NDC y of the panel's top edge (plus margin)
    for (let k = 0.4; k < 4; k *= 1.03) {
      this.camera.position.copy(base).multiplyScalar(k).add(target);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      v.set(ROAD_W / 2 + 0.5, 0, 0.8).project(this.camera);
      if (v.z < 1 && v.x > 0 && v.x <= 0.97 && v.y > bottomNdc && v.y < 1) break; // z < 1: in front of the camera
    }
    this.onLayout?.();
  }

  setConductorView(on) {
    this.conductorView = on;
    if (!on) this.selectedLane = null;
  }

  /** Highlight the lane the Conductor is sending to (null = random lanes). */
  setSelectedLane(lane) {
    this.selectedLane = lane;
  }

  /** Pixels at the bottom of the screen covered by UI (the road is framed above them). */
  setBottomInset(px) {
    if (Math.abs(px - this.bottomInset) < 2) return;
    this.bottomInset = px;
    this.resize();
  }

  /** Screen position (px, relative to container) of a point above the hit line in `lane`. */
  laneScreenPos(lane, y = 1.1) {
    const v = new THREE.Vector3(laneX(lane), y, 0).project(this.camera);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
  }

  /** Which lane is under a pointer event (client coordinates)? */
  laneAt(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    let x;
    if (this.raycaster.ray.intersectPlane(this.groundPlane, hit) && hit.z > -ROAD_LEN) {
      x = hit.x;
    } else {
      // Above the horizon: use horizontal position relative to the hit line.
      const left = this.laneScreenPos(0, 0).x;
      const right = this.laneScreenPos(LANES - 1, 0).x;
      const px = clientX - rect.left;
      const lane = Math.round(((px - left) / (right - left)) * (LANES - 1));
      return Math.max(0, Math.min(LANES - 1, lane));
    }
    const lane = Math.floor((x + ROAD_W / 2) / LANE_W);
    return Math.max(0, Math.min(LANES - 1, lane));
  }

  // ---------------------------------------------------------------- notes

  _noteTexture(word, lane, correct) {
    const key = `${word}|${lane}|${this.conductorView ? (correct ? 'c' : 'w') : ''}`;
    if (this.texCache.has(key)) return this.texCache.get(key);
    const col = this.conductorView ? (correct ? '#22c55e' : '#ef4444') : LANE_COLORS[lane];
    const tex = canvasTexture(512, 256, (g, w, h) => {
      const m = 14; // margin for the glow
      g.shadowColor = col;
      g.shadowBlur = 18;
      roundRect(g, m, m, w - 2 * m, h - 2 * m, 56);
      const fill = g.createLinearGradient(0, m, 0, h - m);
      fill.addColorStop(0, '#ffffff');
      fill.addColorStop(1, '#e9e3ff');
      g.fillStyle = fill;
      g.fill();
      g.shadowBlur = 0;
      g.lineWidth = 14;
      g.strokeStyle = col;
      g.stroke();
      // Big, bold text: as large as fits inside the pill. Phrases may wrap onto two lines.
      const maxW = w - (this.conductorView ? 120 : 64);
      const fit = (lines, maxSize) => {
        let size = maxSize;
        for (; size > 40; size -= 4) {
          g.font = `800 ${size}px "Baloo 2", "Nunito", system-ui, sans-serif`;
          if (lines.every((l) => g.measureText(l).width <= maxW)) break;
        }
        return size;
      };
      let lines = [word];
      let size = fit(lines, 150);
      const sp = word.indexOf(' ');
      if (sp > 0 && size < 96) {
        const two = [word.slice(0, sp), word.slice(sp + 1)];
        const size2 = fit(two, 96);
        if (size2 > size) {
          lines = two;
          size = size2;
        }
      }
      g.font = `800 ${size}px "Baloo 2", "Nunito", system-ui, sans-serif`;
      g.fillStyle = '#241452';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const cx = this.conductorView ? w / 2 - 22 : w / 2;
      const lh = size * 0.92;
      lines.forEach((l, i) => g.fillText(l, cx, h / 2 + 10 + (i - (lines.length - 1) / 2) * lh));
      if (this.conductorView) {
        g.font = '900 56px system-ui, sans-serif';
        g.fillStyle = col;
        g.fillText(correct ? '✓' : '✗', w - 62, h / 2 + 4);
      }
    });
    this.texCache.set(key, tex);
    if (this.texCache.size > 300) {
      const first = this.texCache.keys().next().value;
      this.texCache.get(first).dispose();
      this.texCache.delete(first);
    }
    return tex;
  }

  setTravel(ms) {
    this.travelMs = ms;
  }

  addNote(note) {
    if (this.notes.has(note.id)) return;
    const mat = new THREE.MeshBasicMaterial({ map: this._noteTexture(note.word, note.lane, note.correct), transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(NOTE_W, NOTE_H), mat);
    mesh.renderOrder = LAYER.notes;
    mesh.rotation.x = -Math.PI / 2 + 1.15; // stand up toward the camera so words stay readable
    mesh.position.set(laneX(note.lane), NOTE_H * 0.46, -ROAD_LEN);
    mesh.visible = false;
    this.scene.add(mesh);
    this.notes.set(note.id, { ...note, mesh, resolved: false });
  }

  /** Notes in `lane` that are still waiting to be judged. */
  pendingInLane(lane) {
    return [...this.notes.values()].filter((n) => n.lane === lane && !n.resolved);
  }

  allPending() {
    return [...this.notes.values()].filter((n) => !n.resolved);
  }

  /** Mark a note judged. `hit` notes burst and vanish; others keep sliding and fade. */
  resolve(id, { hit, good }) {
    const n = this.notes.get(id);
    if (!n) return;
    n.resolved = true;
    n.hit = hit;
    if (hit) {
      this.burst(n.lane, good ? LANE_COLORS[n.lane] : '#ef4444', good ? 18 : 10);
      this._removeNote(n);
    }
  }

  _removeNote(n) {
    this.scene.remove(n.mesh);
    n.mesh.geometry.dispose();
    n.mesh.material.dispose();
    this.notes.delete(n.id);
  }

  clearNotes() {
    for (const n of [...this.notes.values()]) this._removeNote(n);
  }

  // ---------------------------------------------------------------- effects

  pressLane(lane) {
    this.laneFlash[lane] = 1;
  }

  burst(lane, color, count = 16) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(
        this.sparkGeo,
        new THREE.MeshBasicMaterial({ color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      m.position.set(laneX(lane), 0.4, 0);
      m.renderOrder = LAYER.fx;
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 5;
      m.userData = { vx: Math.cos(a) * sp * 0.6, vy: 3 + Math.random() * 5, vz: Math.sin(a) * sp * 0.4, life: 0.6 };
      this.scene.add(m);
      this.sparks.push(m);
    }
    const ring = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ color: c, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(laneX(lane), 0.1, 0);
    ring.renderOrder = LAYER.fx;
    ring.userData.life = 0.4;
    this.scene.add(ring);
    this.rings.push(ring);
  }

  // ---------------------------------------------------------------- loop

  _frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.serverNow();

    for (const n of [...this.notes.values()]) {
      const p = (n.arriveAt - t) / this.travelMs; // 1 = spawn point, 0 = hit line
      if (p > 1) {
        n.mesh.visible = false;
        continue;
      }
      n.mesh.visible = true;
      n.mesh.position.z = -p * ROAD_LEN;
      n.mesh.scale.setScalar(1 + 0.14 * Math.min(1, Math.max(0, 1 - p))); // swell as it nears the line
      let opacity = Math.min(1, (1 - p) * 8);
      if (p < 0) opacity = Math.max(0, 1 + p * 5); // fade after passing the line
      if (n.resolved && !n.hit) opacity *= 0.55;
      n.mesh.material.opacity = opacity;
      if (p < -0.3) this._removeNote(n);
    }

    for (let i = 0; i < LANES; i++) {
      this.laneFlash[i] = Math.max(0, this.laneFlash[i] - dt * 3.5);
      this.beams[i].material.opacity = this.laneFlash[i] * 0.6;
      const selected = this.selectedLane === i ? 0.45 + 0.15 * Math.sin(t / 160) : 0;
      this.pads[i].material.opacity = Math.min(1, 0.18 + selected + this.laneFlash[i] * 0.8);
    }

    for (const s of this.streaks) {
      s.position.x -= s.userData.speed * this.streakSpeed * dt;
      s.position.y -= s.userData.speed * this.streakSpeed * dt * 0.18;
      if (s.position.x < -90) {
        s.position.x = 90;
        s.position.y = 2 + Math.random() * 40;
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const m = this.sparks[i];
      const u = m.userData;
      u.life -= dt;
      u.vy -= 14 * dt;
      m.position.x += u.vx * dt;
      m.position.y += u.vy * dt;
      m.position.z += u.vz * dt;
      m.material.opacity = Math.max(0, u.life / 0.6);
      m.quaternion.copy(this.camera.quaternion);
      if (u.life <= 0) {
        this.scene.remove(m);
        m.material.dispose();
        this.sparks.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.userData.life -= dt;
      const k = 1 - r.userData.life / 0.4;
      r.scale.setScalar(0.6 + k * 1.4);
      r.material.opacity = Math.max(0, 1 - k);
      if (r.userData.life <= 0) {
        this.scene.remove(r);
        r.material.dispose();
        this.rings.splice(i, 1);
      }
    }

    this.onFrame?.(t);
    this.renderer.render(this.scene, this.camera);
  }
}
