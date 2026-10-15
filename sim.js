/*
 * Drift simulation core (top-down 2D).
 * x: downstream (+), y: distance from the angler's bank (+ = toward far bank).
 * Line = chain of nearly massless nodes with Morison-type drag, solved with
 * position-based dynamics (inextensible, can go slack). Lure = rigid body with
 * anisotropic drag and weathervane yaw dynamics.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DriftSim = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RHO = 1000; // water density kg/m^3
  const LINE = {
    pe: { d: 0.165e-3, dens: 970, label: 'PE 1号' },
    fc: { d: 0.330e-3, dens: 1780, label: 'フロロ 4号' },
  };
  const CN = 1.2; // normal drag coefficient of a cylinder (Re ~ 10-100)
  const CT = 0.015; // tangential skin-friction coefficient (on wetted perimeter)
  const ROD_PROJ = 2.4; // 9'6" rod projected on the water plane (m)

  const LURES = {
    minnow: {
      name: 'フローティングミノー 12cm / 18g',
      mass: 0.018, len: 0.12,
      Aa: 2.4e-4, Ca: 0.9, // frontal area incl. lip, axial drag coeff
      Al: 2.6e-3, Cl: 1.1, // side area, lateral drag coeff
      kind: 'float', maxDepth: 0.9, actionMin: 0.2, sink: -0.06,
    },
    sinpen: {
      name: 'シンキングペンシル 9cm / 15g',
      mass: 0.015, len: 0.09,
      Aa: 1.1e-4, Ca: 0.45,
      Al: 1.3e-3, Cl: 1.0,
      kind: 'sink', sink: 0.35, lift: 0.9, actionMin: 0.1,
    },
    vib: {
      name: 'バイブレーション 7cm / 20g',
      mass: 0.020, len: 0.07,
      Aa: 3.0e-4, Ca: 1.0,
      Al: 1.4e-3, Cl: 1.2,
      kind: 'sink', sink: 0.6, lift: 1.1, actionMin: 0.35,
    },
  };

  const DEFAULTS = {
    U: 0.8, // max surface flow speed (m/s)
    width: 40, // river width (m)
    coreFrac: 0.55, // position of the main current across the river (0-1)
    depth: 2.5, // river depth (m)
    castDeg: -35, // 0 = straight across, negative = upstream, positive = downstream
    castDist: 30,
    rodDeg: 0, // rod direction, same convention as castDeg
    slack0: 0.2, // extra line after the cast (fraction of chord)
    slackSide: 'down',
    slackHold: 0.12, // reel picks up slack above this fraction
    reelBase: 0, // constant retrieve speed (m/s)
    reelMax: 1.5,
    takeUp: 0.25, // max speed used only to pick up slack (m/s)
    leaderLen: 1.2,
    lure: 'minnow',
    mends: [], // [{t, dir}] dir: 1 = upstream, -1 = downstream
    autoMend: false,
    bellyMax: 4.0, // m, auto mend threshold
    mendStrength: 0.6, // fraction of the line (from the rod side) that is mended
    tMax: 120,
  };

  function flowAt(c, y) {
    const W = c.width;
    if (y <= 0 || y >= W) return 0;
    const yc = c.coreFrac * W;
    const g = y < yc ? 0.5 * y / yc : 0.5 + 0.5 * (y - yc) / (W - yc);
    return c.U * Math.pow(Math.sin(Math.PI * g), 0.35);
  }

  function wrap(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  function simulate(cfgIn) {
    const c = Object.assign({}, DEFAULTS, cfgIn || {});
    const lure = LURES[c.lure] || LURES.minnow;
    const W = c.width;
    const dt = 1 / 200, ITER = 12, REC = 0.05;

    const rodA = c.rodDeg * Math.PI / 180;
    const tipX = ROD_PROJ * Math.sin(rodA), tipY = ROD_PROJ * Math.cos(rodA);
    const ca = c.castDeg * Math.PI / 180;
    let lx0 = c.castDist * Math.sin(ca), ly0 = c.castDist * Math.cos(ca);
    if (ly0 > W - 1.5) { const k = (W - 1.5) / ly0; lx0 *= k; ly0 *= k; }

    // ---- initial line shape: a sine arc from rod tip to lure, length = chord*(1+slack)
    const cx = lx0 - tipX, cy = ly0 - tipY, C = Math.hypot(cx, cy);
    const L = C * (1 + c.slack0);
    const tX = cx / C, tY = cy / C;
    let nX = -tY, nY = tX;
    if ((c.slackSide === 'down') !== (nX > 0)) { nX = -nX; nY = -nY; }
    const SAMP = 400;
    const arcLen = (h) => {
      let s = 0, px = 0, py = 0;
      for (let k = 1; k <= SAMP; k++) {
        const a = k / SAMP * C, b = h * Math.sin(Math.PI * k / SAMP);
        s += Math.hypot(a - px, b - py); px = a; py = b;
      }
      return s;
    };
    let lo = 0, hi = C;
    for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (arcLen(m) < L) lo = m; else hi = m; }
    const h = lo;
    const pts = [[0, 0]], cum = [0];
    for (let k = 1; k <= SAMP; k++) {
      const a = k / SAMP * C, b = h * Math.sin(Math.PI * k / SAMP);
      pts.push([a, b]);
      cum.push(cum[k - 1] + Math.hypot(a - pts[k - 1][0], b - pts[k - 1][1]));
    }
    const scaleS = cum[SAMP] / L;

    const rest = [], type = [];
    const Lpe = L - c.leaderLen;
    const nPe = Math.max(4, Math.round(Lpe / 0.8));
    for (let i = 0; i < nPe; i++) { rest.push(Lpe / nPe); type.push(0); }
    rest.push(c.leaderLen / 2, c.leaderLen / 2); type.push(1, 1);

    const px = [], py = [], vx = [], vy = [];
    let s = 0, j = 0;
    for (let i = 0; i <= rest.length; i++) {
      const target = s * scaleS;
      while (j < SAMP - 1 && cum[j + 1] < target) j++;
      const f = Math.min(1, Math.max(0, (target - cum[j]) / (cum[j + 1] - cum[j] || 1)));
      const a = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f;
      const b = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f;
      const X = tipX + a * tX + b * nX, Y = tipY + a * tY + b * nY;
      px.push(X); py.push(Y);
      vx.push(flowAt(c, Y)); vy.push(0);
      if (i < rest.length) s += rest[i];
    }
    px[0] = tipX; py[0] = tipY; vx[0] = 0;
    px[px.length - 1] = lx0; py[py.length - 1] = ly0;

    const segLam = (t) => { const L_ = t ? LINE.fc : LINE.pe; return (L_.dens + RHO) * Math.PI * L_.d * L_.d / 4; };
    const segD = (t) => (t ? LINE.fc.d : LINE.pe.d);

    // lure state
    let th = Math.atan2(ly0 - tipY, lx0 - tipX); // lands nose-away from the angler
    let depth = 0, T = 0;
    const mL = lure.mass * 1.5; // incl. added mass
    const ka = 0.5 * RHO * lure.Ca * lure.Aa;
    const kl = 0.5 * RHO * lure.Cl * lure.Al;

    const mends = (c.mends || []).slice().sort((a, b) => a.t - b.t);
    let mendIdx = 0, lastMend = -99;
    const frames = [], events = [{ t: 0, type: 'cast', x: lx0, y: ly0 }];
    let t = 0, nextRec = 0, tautState = false, prevPhi = null, endReason = '時間切れ';
    let bankTime = 0, stillTime = 0, belly = 0;
    const w = [];

    function chordInfo() {
      const N = px.length;
      const ex = px[N - 1] - tipX, ey = py[N - 1] - tipY, el = Math.hypot(ex, ey) || 1e-6;
      return { ex: ex / el, ey: ey / el, len: el };
    }

    function measureBelly() {
      const ch = chordInfo();
      let dnX = -ch.ey, dnY = ch.ex;
      if (dnX < 0) { dnX = -dnX; dnY = -dnY; }
      let mx = 0, mn = 0;
      for (let i = 1; i < px.length - 1; i++) {
        const d = (px[i] - tipX) * dnX + (py[i] - tipY) * dnY;
        if (d > mx) mx = d; if (d < mn) mn = d;
      }
      return mx >= -mn ? mx : mn; // + downstream belly, - upstream belly
    }

    function doMend(dir) {
      const N = px.length;
      const ch = chordInfo();
      let uX = -ch.ey, uY = ch.ex; // normal pointing upstream
      if (uX > 0) { uX = -uX; uY = -uY; }
      const k = Math.max(2, Math.min(N - 4, Math.floor(c.mendStrength * (N - 1))));
      const ak = (px[k] - tipX) * ch.ex + (py[k] - tipY) * ch.ey || 1;
      const minA = Math.min(1.2, 0.04 * ch.len);
      for (let i = 1; i <= k; i++) {
        const rx = px[i] - tipX, ry = py[i] - tipY;
        const a = rx * ch.ex + ry * ch.ey;
        const d = rx * uX + ry * uY;
        const target = dir * Math.max(Math.abs(d), minA * Math.sin(Math.PI * Math.min(1, Math.max(0, a / ak))));
        const taper = i < 0.7 * k ? 1 : Math.max(0, (k - i) / (0.3 * k));
        const nd = d + (target - d) * taper;
        px[i] = tipX + a * ch.ex + nd * uX;
        py[i] = Math.max(0.05, tipY + a * ch.ey + nd * uY);
        vx[i] = flowAt(c, py[i]); vy[i] = 0;
      }
      lastMend = t;
      const N2 = px.length;
      events.push({ t, type: 'mend', dir, x: px[N2 - 1], y: py[N2 - 1] });
    }

    function proj(i) {
      const a = i, b = i + 1;
      const dx = px[b] - px[a], dy = py[b] - py[a];
      const d = Math.hypot(dx, dy);
      if (d <= rest[i]) return;
      const ws = w[a] + w[b];
      if (ws === 0) return;
      const k = (d - rest[i]) / (d * ws);
      px[a] += w[a] * k * dx; py[a] += w[a] * k * dy;
      px[b] -= w[b] * k * dx; py[b] -= w[b] * k * dy;
    }

    while (t < c.tMax) {
      const N = px.length, li = N - 1;

      // ---- scheduled / automatic mends
      while (mendIdx < mends.length && mends[mendIdx].t <= t) { doMend(mends[mendIdx].dir); mendIdx++; }
      if (c.autoMend && belly > c.bellyMax && t - lastMend > 3) doMend(1);

      // ---- reel: take up slack above the hold ratio, plus constant retrieve
      let Ltot = 0; for (let i = 0; i < rest.length; i++) Ltot += rest[i];
      const dist = Math.hypot(px[li] - tipX, py[li] - tipY);
      const slack = Ltot / dist - 1;
      const excess = Ltot - (1 + c.slackHold) * dist;
      let reel = c.reelBase + Math.min(c.takeUp, Math.max(0, excess) * 0.8);
      reel = Math.min(c.reelMax, reel);
      rest[0] -= reel * dt;
      while (rest[0] < 0.05 && type[1] === 0 && rest.length > 3) {
        rest[0] += rest[1]; rest.splice(1, 1); type.splice(1, 1);
        px.splice(1, 1); py.splice(1, 1); vx.splice(1, 1); vy.splice(1, 1);
      }
      if (rest[0] < 0.05) rest[0] = 0.05;
      const n = px.length, L1 = n - 1;

      // ---- line drag (semi-implicit, per node, split normal/tangential)
      w.length = n;
      w[0] = 0;
      for (let i = 1; i < L1; i++) {
        const s0 = rest[i - 1], s1 = rest[i];
        const m = 0.5 * (s0 * segLam(type[i - 1]) + s1 * segLam(type[i]));
        const dl = 0.5 * (s0 * segD(type[i - 1]) + s1 * segD(type[i]));
        const kn = 0.5 * RHO * CN * dl, kt = 0.5 * RHO * CT * Math.PI * dl;
        let tx = px[i + 1] - px[i - 1], ty = py[i + 1] - py[i - 1];
        const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const u = flowAt(c, py[i]);
        const rx = vx[i] - u, ry = vy[i];
        const rt = rx * tx + ry * ty;
        const rnx = rx - rt * tx, rny = ry - rt * ty, rn = Math.hypot(rnx, rny);
        const fn = 1 / (1 + dt * kn * rn / m), ft = 1 / (1 + dt * kt * Math.abs(rt) / m);
        vx[i] = u + rt * ft * tx + rnx * fn;
        vy[i] = rt * ft * ty + rny * fn;
        w[i] = 1 / (m + 2 * kn * Math.max(rn, 0.1) * dt);
      }

      // ---- lure drag in body frame
      {
        const hx = Math.cos(th), hy = Math.sin(th);
        const u = flowAt(c, py[L1]);
        const rx = vx[L1] - u, ry = vy[L1];
        let ra = rx * hx + ry * hy, rl = -rx * hy + ry * hx;
        ra /= 1 + dt * ka * Math.abs(ra) / mL;
        rl /= 1 + dt * kl * Math.abs(rl) / mL;
        vx[L1] = u + ra * hx - rl * hy;
        vy[L1] = ra * hy + rl * hx;
        w[L1] = 1 / (mL + 2 * ka * Math.max(Math.abs(ra), 0.05) * dt);
      }

      // ---- predict
      const ox = px.slice(), oy = py.slice();
      for (let i = 1; i < n; i++) { px[i] += vx[i] * dt; py[i] += vy[i] * dt; }
      const plx = px[L1], ply = py[L1];

      // ---- constraints (inextensible rope that may go slack)
      for (let it = 0; it < ITER; it++) {
        for (let i = 0; i < n - 1; i++) proj(i);
        for (let i = n - 2; i >= 0; i--) proj(i);
        let cumL = 0;
        for (let i = 1; i < n; i++) {
          cumL += rest[i - 1];
          const dx = px[i] - tipX, dy = py[i] - tipY, d = Math.hypot(dx, dy);
          if (d > cumL) { px[i] = tipX + dx * cumL / d; py[i] = tipY + dy * cumL / d; }
        }
        for (let i = 1; i < n; i++) {
          if (py[i] < 0.05) py[i] = 0.05;
          if (py[i] > W - 0.2) py[i] = W - 0.2;
        }
      }

      // tension from the constraint impulse on the lure
      const Tinst = (1 / w[L1]) * Math.hypot(px[L1] - plx, py[L1] - ply) / (dt * dt);
      T += (Tinst - T) * Math.min(1, dt / 0.12);

      for (let i = 1; i < n; i++) { vx[i] = (px[i] - ox[i]) / dt; vy[i] = (py[i] - oy[i]) / dt; }

      // ---- lure yaw: weathervane into the relative flow + torque from the line on the eye
      const uL = flowAt(c, py[L1]);
      const relx = vx[L1] - uL, rely = vy[L1];
      const rel = Math.hypot(relx, rely);
      const lineA = Math.atan2(py[L1 - 1] - py[L1], px[L1 - 1] - px[L1]);
      let om = 0;
      if (rel > 1e-4) om += 4 * rel / lure.len * Math.sin(wrap(Math.atan2(rely, relx) - th));
      om += 50 * T * Math.sin(wrap(lineA - th));
      om = Math.max(-15, Math.min(15, om));
      th = wrap(th + om * dt);

      // swim speed = speed through the water along the body (nose first)
      const swim = relx * Math.cos(th) + rely * Math.sin(th);
      if (lure.kind === 'float') {
        if (swim > lure.actionMin) {
          const target = lure.maxDepth * Math.min(1, (swim - lure.actionMin) / 0.5 + 0.3);
          depth += (target - depth) * Math.min(1, dt / 1.2);
        } else depth += lure.sink * dt;
      } else {
        depth += (lure.sink - lure.lift * Math.max(0, swim) * Math.max(0, swim) * 1.6) * dt;
      }
      depth = Math.max(0, Math.min(c.depth, depth));

      belly = measureBelly();

      // ---- events
      if (!tautState && T > 0.05) { tautState = true; events.push({ t, type: 'taut', x: px[L1], y: py[L1] }); }
      else if (tautState && T < 0.02) { tautState = false; events.push({ t, type: 'slack', x: px[L1], y: py[L1] }); }
      // heading measured from upstream: 0 = nose upstream, +90 = toward angler, ±180 = downstream
      const phiS = Math.atan2(-Math.sin(th), -Math.cos(th)) * 180 / Math.PI;
      if (prevPhi !== null && Math.abs(prevPhi) > 90 && Math.abs(phiS) <= 90 && rel > 0.08) {
        events.push({ t, type: 'turn', x: px[L1], y: py[L1] });
      }
      prevPhi = phiS;

      // ---- record
      if (t >= nextRec) {
        nextRec += REC;
        frames.push({
          t, n,
          x: Float32Array.from(px), y: Float32Array.from(py),
          lx: px[L1], ly: py[L1], th, phi: phiS,
          T, slack, belly, swim, rel, relx, rely,
          u: uL, vx: vx[L1], vy: vy[L1],
          lineA, depth, reel, Lout: Ltot,
        });
      }

      t += dt;

      // ---- end conditions
      let Lpe2 = 0; for (let i = 0; i < rest.length; i++) if (type[i] === 0) Lpe2 += rest[i];
      if (Lpe2 < 3) { endReason = '回収完了'; break; }
      if (py[L1] < 1.0) { bankTime += dt; if (bankTime > 1) { endReason = '手前の岸際に到達'; break; } } else bankTime = 0;
      if (px[L1] > 140) { endReason = '下流へ流れ切った'; break; }
      if (Math.hypot(vx[L1], vy[L1]) < 0.06 && reel < 0.01) { stillTime += dt; if (stillTime > 6) { endReason = '下流で張って静止（ステイ）'; break; } } else stillTime = 0;
    }

    return { cfg: c, lure, frames, events, endReason, tip: { x: tipX, y: tipY }, dt: REC };
  }

  return { simulate, flowAt, LURES, DEFAULTS, LINE, ROD_PROJ };
});
