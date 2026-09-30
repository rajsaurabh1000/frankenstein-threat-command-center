/**
 * 3D attack globe: dot-matrix Earth (Natural Earth land mask) with live attack arcs from each
 * event's origin to the protected region. Canvas 2D + orthographic projection, no libraries.
 *
 *   const globe = new AttackGlobe(canvas, { targets: [{ region, city, lat, lon }] });
 *   globe.addAttack({ lat, lon, level: "CRITICAL", region: "us-west-2" }); // arc origin -> region
 *   globe.addInternal("HIGH", "us-east-1");                                 // insider activity: pulse
 *   globe.setContained(true);                            // shield ring, arcs fade
 */

const LEVEL_COLORS = {
  LOW: [61, 214, 140],
  ELEVATED: [255, 176, 32],
  HIGH: [250, 88, 45],
  CRITICAL: [255, 77, 77],
};
const ORANGE = [250, 88, 45];
const DEG = Math.PI / 180;
const ARC_FLIGHT_MS = 1700;
const ARC_LINGER_MS = 5200;
const MAX_ARCS = 60;
const HOME = { lon: 175, lat: 26 }; // first view: APAC origins + the US west coast
const SPIN_DEG_PER_S = 4; // idle rotation: every protected region comes into view (~90 s / turn)
const FOCUS_MS = 9000; // on a CRITICAL arc, swing to face it for this long, then resume spinning

function unit(lat, lon) {
  const p = lat * DEG;
  const l = lon * DEG;
  return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
}

function slerp(a, b, t) {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-6) return a.slice();
  const s = Math.sin(omega);
  const k1 = Math.sin((1 - t) * omega) / s;
  const k2 = Math.sin(t * omega) / s;
  return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
}

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export class AttackGlobe {
  constructor(canvas, { targets = [{ region: "us-west-2", city: "Oregon (us-west-2)", lat: 45.84, lon: -119.7 }], reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.reducedMotion = reducedMotion;
    this.setTargets(targets);
    this.focus = null; // { lon, lat, until }
    this._lastTick = performance.now();
    this.lon0 = HOME.lon;
    this.lat0 = HOME.lat;
    this.dragging = false;
    this.lastInteraction = 0;
    this.land = []; // [cosLat, sinLat, lonRad]
    this.arcs = [];
    this.launched = 0;
    this.contained = false;
    this.containedAt = 0;
    this.visible = true;
    this._raf = 0;
    this._t0 = performance.now();

    this._resize = this._resize.bind(this);
    this._frame = this._frame.bind(this);
    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onVisibility = () => this._start(); // guarded: never a second render loop

    this._ro = new ResizeObserver(this._resize);
    this._ro.observe(canvas);
    this._io = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      if (this.visible) this._start();
    });
    this._io.observe(canvas);
    document.addEventListener("visibilitychange", this._onVisibility);
    canvas.addEventListener("pointerdown", this._onDown);
    window.addEventListener("pointermove", this._onMove);
    window.addEventListener("pointerup", this._onUp);

    this._resize();
    this._loadLand();
    this._start();
  }

  async _loadLand() {
    try {
      const res = await fetch("/static/assets/geo/land-dots.json");
      const { points } = await res.json();
      const land = [];
      for (let i = 0; i < points.length; i += 2) {
        const lat = (points[i] / 10) * DEG;
        land.push([Math.cos(lat), Math.sin(lat), (points[i + 1] / 10) * DEG]);
      }
      this.land = land;
    } catch {
      this.land = []; // globe still renders (sphere, arcs) without the land mask
    }
  }

  setTargets(targets) {
    const list = (targets && targets.length ? targets : [{ region: "us-west-2", city: "Oregon (us-west-2)", lat: 45.84, lon: -119.7 }]);
    this.targets = list.map((t) => ({ ...t, v: unit(t.lat, t.lon), impacts: [] }));
  }

  _targetFor(region) {
    return this.targets.find((t) => t.region === region) || this.targets[0];
  }

  setContained(on) {
    if (on && !this.contained) this.containedAt = performance.now();
    this.contained = on;
  }

  addAttack({ lat, lon, level = "HIGH", region }) {
    const now = performance.now();
    const target = this._targetFor(region);
    this.arcs.push({ from: unit(lat, lon), to: target.v, target, color: LEVEL_COLORS[level] || ORANGE, born: now, level });
    if (level === "CRITICAL" && !this.dragging && (!this.focus || now > this.focus.until - FOCUS_MS / 2)) {
      // face the midpoint of the arc so the audience sees it land
      const mid = slerp(unit(lat, lon), target.v, 0.5);
      this.focus = {
        lon: Math.atan2(mid[0], mid[2]) / DEG,
        lat: Math.max(-30, Math.min(55, Math.asin(Math.max(-1, Math.min(1, mid[1]))) / DEG)),
        until: now + FOCUS_MS,
      };
    }
    if (this.arcs.length > MAX_ARCS) this.arcs.splice(0, this.arcs.length - MAX_ARCS);
    this.launched += 1;
    this.canvas.dataset.arcs = String(this.launched);
    this._start();
  }

  addInternal(level = "HIGH", region) {
    this._targetFor(region).impacts.push({ born: performance.now(), color: LEVEL_COLORS[level] || ORANGE, internal: true });
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this._io.disconnect();
    document.removeEventListener("visibilitychange", this._onVisibility);
    this.canvas.removeEventListener("pointerdown", this._onDown);
    window.removeEventListener("pointermove", this._onMove);
    window.removeEventListener("pointerup", this._onUp);
  }

  // --- interaction ---------------------------------------------------------------------
  _onDown(e) {
    this.dragging = { x: e.clientX, y: e.clientY };
    this.lastInteraction = performance.now();
    this.canvas.setPointerCapture?.(e.pointerId);
  }

  _onMove(e) {
    if (!this.dragging) return;
    const dx = e.clientX - this.dragging.x;
    const dy = e.clientY - this.dragging.y;
    this.dragging = { x: e.clientX, y: e.clientY };
    this.lon0 -= dx * 0.35;
    this.lat0 = Math.max(-60, Math.min(70, this.lat0 + dy * 0.25));
    this.lastInteraction = performance.now();
  }

  _onUp() {
    this.dragging = false;
    this.lastInteraction = performance.now();
  }

  // --- rendering ------------------------------------------------------------------------
  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { width, height } = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, width);
    this.h = Math.max(1, height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.R = Math.min(this.w, this.h) * 0.4;
    this.cx = this.w / 2;
    this.cy = this.h / 2;
  }

  _start() {
    if (!this._raf) this._raf = requestAnimationFrame(this._frame);
  }

  _frame() {
    this._raf = 0;
    if (!this.visible || document.hidden) return; // paused off-screen / in background tabs
    this._update(performance.now());
    this._draw(performance.now());
    this._raf = requestAnimationFrame(this._frame);
  }

  _update(now) {
    const dt = Math.min(0.1, (now - this._lastTick) / 1000);
    this._lastTick = now;
    if (this.dragging || this.reducedMotion) return;
    if (now - this.lastInteraction < 3500) return; // hold where the user left it for a moment
    if (this.focus && now < this.focus.until) {
      const dLon = ((this.focus.lon - this.lon0 + 540) % 360) - 180;
      this.lon0 += dLon * Math.min(1, dt * 2.2);
      this.lat0 += (this.focus.lat - this.lat0) * Math.min(1, dt * 2.2);
      return;
    }
    this.focus = null;
    this.lon0 += SPIN_DEG_PER_S * dt; // continuous rotation
    this.lat0 += (HOME.lat - this.lat0) * Math.min(1, dt * 0.8);
  }

  _project(v) {
    const cl = Math.cos(this.lon0 * DEG);
    const sl = Math.sin(this.lon0 * DEG);
    const x1 = v[0] * cl - v[2] * sl;
    const z1 = v[0] * sl + v[2] * cl;
    const ct = Math.cos(this.lat0 * DEG);
    const st = Math.sin(this.lat0 * DEG);
    const y2 = v[1] * ct - z1 * st;
    const z2 = v[1] * st + z1 * ct;
    return [this.cx + x1 * this.R, this.cy - y2 * this.R, z2];
  }

  _hidden(p, scale = 1) {
    // behind the sphere: back hemisphere and inside the disc (elevated arc points can peek out)
    if (p[2] >= 0) return false;
    const dx = p[0] - this.cx;
    const dy = p[1] - this.cy;
    return Math.hypot(dx, dy) < this.R * Math.min(1, scale);
  }

  _draw(now) {
    const { ctx, cx, cy, R } = this;
    ctx.clearRect(0, 0, this.w, this.h);

    // atmosphere + sphere
    const glow = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.22);
    glow.addColorStop(0, "rgba(250,88,45,0.20)");
    glow.addColorStop(0.45, "rgba(56,189,248,0.08)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.22, 0, Math.PI * 2);
    ctx.fill();
    const sphere = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    sphere.addColorStop(0, "#132033");
    sphere.addColorStop(1, "#05080e");
    ctx.fillStyle = sphere;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(125,211,252,0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();

    this._drawGraticule();

    // land dots with limb darkening
    const cl = Math.cos(this.lon0 * DEG);
    const sl = Math.sin(this.lon0 * DEG);
    const ct = Math.cos(this.lat0 * DEG);
    const st = Math.sin(this.lat0 * DEG);
    const dot = Math.max(1.4, R / 125);
    for (const [cosLat, sinLat, lon] of this.land) {
      const vx = cosLat * Math.sin(lon);
      const vz = cosLat * Math.cos(lon);
      const x1 = vx * cl - vz * sl;
      const z1 = vx * sl + vz * cl;
      const z2 = sinLat * st + z1 * ct;
      if (z2 <= 0.02) continue;
      const y2 = sinLat * ct - z1 * st;
      ctx.fillStyle = `rgba(255,${Math.round(96 + z2 * 50)},${Math.round(56 + z2 * 30)},${(0.32 + z2 * 0.62).toFixed(3)})`;
      ctx.fillRect(cx + x1 * R - dot / 2, cy - y2 * R - dot / 2, dot, dot);
    }

    // arcs
    this.arcs = this.arcs.filter((a) => now - a.born < ARC_FLIGHT_MS + ARC_LINGER_MS);
    for (const arc of this.arcs) this._drawArc(arc, now);

    for (const t of this.targets) this._drawTarget(t, now);
  }

  _drawGraticule() {
    const { ctx } = this;
    ctx.strokeStyle = "rgba(148,163,184,0.07)";
    ctx.lineWidth = 0.8;
    for (let lat = -60; lat <= 60; lat += 30) this._polyline([...Array(73)].map((_, i) => unit(lat, -180 + i * 5)));
    for (let lon = -180; lon < 180; lon += 30) this._polyline([...Array(37)].map((_, i) => unit(-90 + i * 5, lon)));
  }

  _polyline(vecs) {
    const { ctx } = this;
    ctx.beginPath();
    let pen = false;
    for (const v of vecs) {
      const p = this._project(v);
      if (p[2] <= 0) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(p[0], p[1]);
      else ctx.moveTo(p[0], p[1]);
      pen = true;
    }
    ctx.stroke();
  }

  _arcPoints(arc, steps = 56) {
    const dot = arc.from[0] * arc.to[0] + arc.from[1] * arc.to[1] + arc.from[2] * arc.to[2];
    const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
    const height = 0.06 + 0.32 * (angle / Math.PI);
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const v = slerp(arc.from, arc.to, t);
      const lift = 1 + height * Math.sin(Math.PI * t);
      pts.push(this._project([v[0] * lift, v[1] * lift, v[2] * lift]));
    }
    return pts;
  }

  _drawArc(arc, now) {
    const { ctx } = this;
    const age = now - arc.born;
    const pts = this._arcPoints(arc);
    const n = pts.length - 1;
    const progress = Math.min(1, age / ARC_FLIGHT_MS);
    const head = Math.floor(progress * n);
    const fade = age > ARC_FLIGHT_MS ? Math.max(0, 1 - (age - ARC_FLIGHT_MS) / ARC_LINGER_MS) : 1;
    const containedFade = this.contained && arc.born < this.containedAt ? Math.max(0, 1 - (now - this.containedAt) / 1200) : 1;
    const alpha = fade * containedFade;
    if (alpha <= 0.01) return;

    // faint full path once launched, bright trail behind the head while in flight
    ctx.lineCap = "round";
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = rgba(arc.color, 0.22 * alpha);
    this._strokeSegment(pts, 0, head);
    if (progress < 1) {
      const tail = Math.max(0, head - Math.round(n * 0.28));
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = rgba(arc.color, 0.95 * alpha);
      this._strokeSegment(pts, tail, head);
      const p = pts[head];
      if (!this._hidden(p, 1.05)) {
        ctx.fillStyle = rgba([255, 255, 255], 0.95 * alpha);
        ctx.beginPath();
        ctx.arc(p[0], p[1], 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(arc.color, 0.35 * alpha);
        ctx.beginPath();
        ctx.arc(p[0], p[1], 7, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (!arc.landed) {
      arc.landed = true;
      arc.target.impacts.push({ born: now, color: arc.color });
    }

    // origin pulse
    const o = pts[0];
    if (!this._hidden(o) && o[2] > 0) {
      const pulse = (age % 1400) / 1400;
      ctx.strokeStyle = rgba(arc.color, (1 - pulse) * 0.7 * alpha);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(o[0], o[1], 2 + pulse * 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = rgba(arc.color, 0.9 * alpha);
      ctx.beginPath();
      ctx.arc(o[0], o[1], 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _strokeSegment(pts, from, to) {
    const { ctx } = this;
    ctx.beginPath();
    let pen = false;
    for (let i = from; i <= to; i++) {
      const p = pts[i];
      if (this._hidden(p, 1.02)) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(p[0], p[1]);
      else ctx.moveTo(p[0], p[1]);
      pen = true;
    }
    ctx.stroke();
  }

  _drawTarget(target, now) {
    const { ctx } = this;
    const p = this._project(target.v);
    target.impacts = target.impacts.filter((im) => now - im.born < 1600);
    if (p[2] <= 0) return;

    for (const im of target.impacts) {
      const k = (now - im.born) / 1600;
      ctx.strokeStyle = rgba(im.color, (1 - k) * (im.internal ? 0.5 : 0.85));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 4 + k * 26, 0, Math.PI * 2);
      ctx.stroke();
    }

    const beat = (Math.sin(now / 260) + 1) / 2;
    ctx.fillStyle = rgba(ORANGE, 0.25 + beat * 0.2);
    ctx.beginPath();
    ctx.arc(p[0], p[1], 9 + beat * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(p[0], p[1], 3.4, 0, Math.PI * 2);
    ctx.fill();

    // label: protected region
    const label = `PROTECTED · ${target.city}`.toUpperCase();
    ctx.font = "700 10px Inter, system-ui, sans-serif";
    const tw = ctx.measureText(label).width;
    let lx = p[0] + 16;
    if (lx + tw + 12 > this.w) lx = Math.max(6, p[0] - 16 - tw); // flip left near the right edge
    const ly = Math.max(14, p[1] - 16);
    ctx.fillStyle = "rgba(5,8,14,0.78)";
    ctx.strokeStyle = "rgba(250,88,45,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect?.(lx - 6, ly - 11, tw + 12, 17, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fed7aa";
    ctx.fillText(label, lx, ly + 1);

    if (this.contained) {
      const k = Math.min(1, (now - this.containedAt) / 700);
      ctx.strokeStyle = `rgba(61,214,140,${0.85 * k})`;
      ctx.lineWidth = 2.2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(p[0], p[1], 18 + (1 - k) * 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
