(function () {
  'use strict';
  const S = window.DriftSim;
  const css = getComputedStyle(document.documentElement);
  const C = {};
  ['bg', 'panel', 'rule', 'text', 'muted', 'faint', 'water-slow', 'water-fast', 'bank', 'bank-edge', 'flow', 'rel', 'pe', 'leader', 'tension', 'turn', 'mend', 'drift', 'swim', 'hard']
    .forEach((k) => { C[k] = css.getPropertyValue('--' + k).trim(); });
  const NUM = '500 11px "IBM Plex Mono", ui-monospace, monospace';
  const UI = '12px "Zen Kaku Gothic New", "Hiragino Sans", system-ui, sans-serif';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const cfg = Object.assign({}, S.DEFAULTS, { mends: [] });
  let result = null, ghost = null, playT = 0, playing = true, speed = 2;
  let bounds = null, waterCache = null;

  // ---------------------------------------------------------------- controls
  const deg = (v, a, b) => (v < 0 ? `${a} ${-v}°` : v > 0 ? `${b} ${v}°` : '真正面');
  const GROUPS = [
    { title: '川の流れ', items: [
      { key: 'U', label: '流速（流芯の表層）', min: 0.2, max: 2.0, step: 0.05, fmt: (v) => `${v.toFixed(2)} m/s`, hint: (v) => `時速 ${(v * 3.6).toFixed(1)} km。岸際はこの3〜5割まで落ちます。` },
      { key: 'width', label: '川幅', min: 20, max: 80, step: 1, fmt: (v) => `${v} m` },
      { key: 'coreFrac', label: '流芯の位置', min: 0.2, max: 0.8, step: 0.05, fmt: (v) => `岸から ${(v * cfg.width).toFixed(0)} m` },
    ] },
    { title: 'キャスト', items: [
      { key: 'castDeg', label: 'キャスト方向', min: -70, max: 70, step: 5, fmt: (v) => deg(v, 'アップ', 'ダウン') },
      { key: 'castDist', label: '飛距離', min: 10, max: 60, step: 1, fmt: (v) => `${v} m` },
      { key: 'rodDeg', label: 'ロッドの向き', min: -60, max: 60, step: 5, fmt: (v) => deg(v, '上流側', '下流側') },
    ] },
    { title: 'スラッグと巻き', items: [
      { key: 'slack0', label: '着水時のスラッグ', min: 0, max: 0.4, step: 0.01, fmt: (v) => `${Math.round(v * 100)} %`, hint: () => `直線距離より ${extraLen().toFixed(1)} m 多く糸が出た状態で着水` },
      { key: 'slackSide', type: 'seg', label: '糸ふけが膨らむ側', options: [['down', '下流側'], ['up', '上流側']] },
      { key: 'slackHold', label: '残すスラッグ', min: 0, max: 0.4, step: 0.01, fmt: (v) => `${Math.round(v * 100)} %`, hint: () => 'これを超えた糸ふけだけを巻き取ります（最大0.25 m/s）' },
      { key: 'reelBase', label: '一定の巻き速度', min: 0, max: 1.0, step: 0.05, fmt: (v) => `${v.toFixed(2)} m/s`, hint: (v) => (v > 0 ? `ハンドル約 ${(v / 0.9).toFixed(1)} 回転/秒（1回転0.9 m）` : '0 なら糸ふけを取るだけ') },
    ] },
    { title: 'メンディング', items: [
      { key: 'autoMend', type: 'toggle', label: '下流側のベリーが膨らんだら自動で上流へメンド' },
      { key: 'bellyMax', label: '自動メンドのしきい値', min: 1, max: 10, step: 0.5, fmt: (v) => `ベリー ${v} m` },
      { key: 'mendStrength', label: 'メンドで返すライン', min: 0.3, max: 0.9, step: 0.05, fmt: (v) => `竿側 ${Math.round(v * 100)} %` },
      { type: 'mends' },
    ] },
    { title: '橋と明暗', items: [
      { key: 'bridge', type: 'toggle', label: '橋を架ける' },
      { key: 'bridgeX', label: '橋の位置', min: -20, max: 60, step: 1, fmt: (v) => (v >= 0 ? `下流 ${v} m` : `上流 ${-v} m`), show: () => cfg.bridge },
      { key: 'bridgeW', label: '橋の幅（流れ方向）', min: 4, max: 24, step: 1, fmt: (v) => `${v} m`, show: () => cfg.bridge },
      { key: 'piers', type: 'seg', label: '水中の橋脚', options: [[0, 'なし'], [1, '1本'], [2, '2本'], [3, '3本']], show: () => cfg.bridge },
      { key: 'pierD', label: '橋脚の太さ', min: 0.8, max: 4, step: 0.2, fmt: (v) => `φ ${v.toFixed(1)} m`, show: () => cfg.bridge && cfg.piers > 0, hint: () => '橋脚の前で流れが止まり、横で速まり、後ろに遅い流れ（反転流）の帯ができます' },
      { key: 'shade', type: 'seg', label: '明暗', options: [['none', 'なし'], ['bridge', '橋の影'], ['lamp', '常夜灯']] },
      { key: 'litSide', type: 'seg', label: '照明で明るい側', options: [['up', '上流側'], ['down', '下流側'], ['both', '両側']], show: () => cfg.shade === 'bridge' },
      { key: 'lampX', label: '常夜灯の位置（手前の岸）', min: -20, max: 60, step: 1, fmt: (v) => (v >= 0 ? `下流 ${v} m` : `上流 ${-v} m`), show: () => cfg.shade === 'lamp' },
      { key: 'lampR', label: '照らす範囲', min: 6, max: 35, step: 1, fmt: (v) => `半径 ${v} m`, show: () => cfg.shade === 'lamp' },
    ] },
    { title: 'ルアー', items: [{ key: 'lure', type: 'select' }] },
  ];
  const outputs = {}, hints = {};
  function extraLen() {
    const a = cfg.castDeg * Math.PI / 180, r = cfg.rodDeg * Math.PI / 180;
    let lx = cfg.castDist * Math.sin(a), ly = cfg.castDist * Math.cos(a);
    if (ly > cfg.width - 1.5) { const k = (cfg.width - 1.5) / ly; lx *= k; ly *= k; }
    return Math.hypot(lx - S.ROD_PROJ * Math.sin(r), ly - S.ROD_PROJ * Math.cos(r)) * cfg.slack0;
  }

  const rail = document.getElementById('rail');
  const segButtons = {}, toggles = {}, shows = [];
  let mendChips;
  GROUPS.forEach((g) => {
    const box = document.createElement('div');
    box.className = 'group';
    box.innerHTML = `<h2>${g.title}</h2>`;
    g.items.forEach((it) => {
      const el = document.createElement('div');
      el.className = 'ctl';
      if (it.type === 'seg') {
        el.innerHTML = `<label>${it.label}</label><div class="seg" role="group"></div>`;
        const seg = el.querySelector('.seg');
        segButtons[it.key] = it.options.map(([v, l]) => {
          const b = document.createElement('button');
          b.type = 'button'; b.textContent = l; b.dataset.v = String(v);
          b.addEventListener('click', () => {
            cfg[it.key] = v;
            if (it.key === 'shade' && v === 'bridge') cfg.bridge = true;
            syncControls(); recompute();
          });
          seg.appendChild(b); return b;
        });
      } else if (it.type === 'toggle') {
        el.innerHTML = `<label class="toggle"><input type="checkbox" id="c-${it.key}"><span>${it.label}</span></label>`;
        toggles[it.key] = el.querySelector('input');
        toggles[it.key].addEventListener('change', (e) => {
          cfg[it.key] = e.target.checked;
          if (it.key === 'bridge' && !cfg.bridge && cfg.shade === 'bridge') cfg.shade = 'none';
          syncControls(); recompute();
        });
      } else if (it.type === 'select') {
        const opts = Object.entries(S.LURES).map(([k, l]) => `<option value="${k}">${l.name}</option>`).join('');
        el.innerHTML = `<select id="c-lure" aria-label="ルアー">${opts}</select><div class="hint" id="h-lure"></div>`;
        el.querySelector('select').addEventListener('change', (e) => { cfg.lure = e.target.value; syncControls(); recompute(); });
        hints.lure = el.querySelector('.hint');
      } else if (it.type === 'mends') {
        el.innerHTML = `<label>時刻を指定してメンド</label>
          <div class="hint">再生を止めて、返したい瞬間でボタンを押すとその時刻にメンドを入れて計算し直します。</div>
          <div class="btnrow"><button class="btn mend" type="button" id="mendUp">↺ 上流へメンド</button><button class="btn mend" type="button" id="mendDown">↻ 下流へメンド</button></div>
          <div class="chips" id="mendChips"></div>`;
        mendChips = el.querySelector('#mendChips');
        el.querySelector('#mendUp').addEventListener('click', () => addMend(1));
        el.querySelector('#mendDown').addEventListener('click', () => addMend(-1));
      } else {
        el.innerHTML = `<div class="row"><label for="c-${it.key}">${it.label}</label><output id="o-${it.key}"></output></div>
          <input type="range" id="c-${it.key}" min="${it.min}" max="${it.max}" step="${it.step}">
          ${it.hint ? '<div class="hint"></div>' : ''}`;
        const inp = el.querySelector('input');
        inp.addEventListener('input', () => { cfg[it.key] = parseFloat(inp.value); syncControls(); recompute(); });
        outputs[it.key] = { el: el.querySelector('output'), it, inp };
        if (it.hint) hints[it.key] = { el: el.querySelector('.hint'), it };
      }
      if (it.show) shows.push([el, it.show]);
      box.appendChild(el);
    });
    rail.appendChild(box);
  });

  function syncControls() {
    Object.values(outputs).forEach(({ el, it, inp }) => { inp.value = cfg[it.key]; el.textContent = it.fmt(cfg[it.key]); });
    Object.entries(hints).forEach(([k, h]) => { if (k !== 'lure') h.el.textContent = h.it.hint(cfg[k]); });
    Object.entries(segButtons).forEach(([k, bs]) => bs.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(cfg[k])))));
    Object.entries(toggles).forEach(([k, inp]) => { inp.checked = !!cfg[k]; });
    shows.forEach(([el, fn]) => { el.hidden = !fn(); });
    document.getElementById('c-lure').value = cfg.lure;
    const L = S.LURES[cfg.lure];
    hints.lure.textContent = L.kind === 'float'
      ? `浮力あり。対水速度 ${L.actionMin} m/s 以上で潜って泳ぎ、止まると浮く。`
      : `沈む。対水速度 ${L.actionMin} m/s 以上で泳ぎ、速く引くほど浮き上がる。`;
    mendChips.innerHTML = '';
    cfg.mends.forEach((m, i) => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.innerHTML = `${m.dir > 0 ? '上流' : '下流'} ${m.t.toFixed(1)}s <button type="button" aria-label="削除">×</button>`;
      c.querySelector('button').addEventListener('click', () => { cfg.mends.splice(i, 1); syncControls(); recompute(true); });
      mendChips.appendChild(c);
    });
  }
  function addMend(dir) {
    const t = Math.round(playT * 10) / 10;
    cfg.mends = cfg.mends.filter((m) => Math.abs(m.t - t) > 0.05).concat([{ t, dir }]).sort((a, b) => a.t - b.t);
    syncControls();
    recompute(true);
  }

  // ---------------------------------------------------------------- presets
  const PRESETS = [
    { name: 'アップクロス＋スラッグ多め', set: { castDeg: -35, castDist: 30, slack0: 0.25, slackSide: 'down', slackHold: 0.15, reelBase: 0, autoMend: false, mends: [] } },
    { name: 'アップクロス＋上流メンド', set: { castDeg: -35, castDist: 30, slack0: 0.2, slackSide: 'down', slackHold: 0.15, reelBase: 0, autoMend: false, mends: [{ t: 1.0, dir: 1 }, { t: 8.0, dir: 1 }] } },
    { name: 'クロス・張り気味でスイング', set: { castDeg: 0, castDist: 30, slack0: 0.05, slackSide: 'down', slackHold: 0.03, reelBase: 0.1, autoMend: false, mends: [] } },
    { name: '橋の明暗へ流し込む', set: { castDeg: -30, castDist: 30, slack0: 0.2, slackSide: 'up', slackHold: 0.15, reelBase: 0, autoMend: false, mends: [{ t: 1.0, dir: 1 }], bridge: true, bridgeX: 15, bridgeW: 10, piers: 2, pierD: 2, shade: 'bridge', litSide: 'up' } },
    { name: 'ダウンクロス・ただ巻き', set: { castDeg: 40, castDist: 30, slack0: 0.05, slackSide: 'down', slackHold: 0, reelBase: 0.3, autoMend: false, mends: [] } },
  ];
  const presetBox = document.getElementById('presets');
  PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'preset'; b.type = 'button'; b.textContent = p.name;
    b.addEventListener('click', () => { Object.assign(cfg, JSON.parse(JSON.stringify(p.set))); syncControls(); recompute(); });
    presetBox.appendChild(b);
  });

  // ---------------------------------------------------------------- compute (worker with sync fallback)
  let worker = null, reqId = 0, timer = null;
  try {
    worker = new Worker('worker.js');
    worker.onmessage = (e) => { if (e.data.id === reqId) onResult(e.data.r, pendingKeep); };
    worker.onerror = () => { worker = null; };
  } catch (e) { worker = null; }
  let pendingKeep = false;
  const busy = document.getElementById('busy');
  function recompute(keepTime) {
    pendingKeep = !!keepTime;
    clearTimeout(timer);
    timer = setTimeout(() => {
      busy.hidden = false;
      const c = JSON.parse(JSON.stringify(cfg));
      if (worker) { reqId++; worker.postMessage({ id: reqId, cfg: c }); }
      else setTimeout(() => onResult(S.simulate(c), pendingKeep), 0);
    }, 120);
  }
  function onResult(r, keepTime) {
    busy.hidden = true;
    result = r;
    const end = r.frames[r.frames.length - 1].t;
    scrub.max = end.toFixed(2);
    if (!keepTime) playT = 0;
    playT = Math.min(playT, end);
    playing = true;
    computeBounds();
    renderSummary();
    renderDragTable();
  }

  // ---------------------------------------------------------------- geometry
  const river = document.getElementById('river'), rctx = river.getContext('2d');
  const charts = document.getElementById('charts'), cctx = charts.getContext('2d');
  const lens = document.getElementById('lens'), lctx = lens.getContext('2d');
  let RW = 0, RH = 0, CW = 0, CH = 0, DPR = 1;

  function computeBounds() {
    const rc = result.cfg;
    let xmin = Math.min(-8, result.tip.x - 4), xmax = 25;
    const scan = (fr) => { for (const f of fr) { if (f.lx < xmin) xmin = f.lx; if (f.lx > xmax) xmax = f.lx; } };
    scan(result.frames);
    if (ghost) for (let i = 0; i < ghost.lx.length; i++) { xmin = Math.min(xmin, ghost.lx[i]); xmax = Math.max(xmax, ghost.lx[i]); }
    for (const f of [result.frames[0]]) for (let i = 0; i < f.x.length; i++) { xmin = Math.min(xmin, f.x[i]); xmax = Math.max(xmax, f.x[i]); }
    if (rc.bridge) { xmin = Math.min(xmin, rc.bridgeX - rc.bridgeW / 2 - 4); xmax = Math.max(xmax, rc.bridgeX + rc.bridgeW / 2 + 4); }
    if (rc.shade === 'lamp') { xmin = Math.min(xmin, rc.lampX - rc.lampR); xmax = Math.max(xmax, rc.lampX + rc.lampR); }
    bounds = { xmin: xmin - 5, xmax: xmax + 6, ymin: -4, ymax: rc.width + 3 };
    layout();
  }
  function layout() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    RW = river.clientWidth;
    const pad = 26;
    RH = bounds ? Math.round(Math.max(280, Math.min(620, (RW - pad * 2) * (bounds.ymax - bounds.ymin) / (bounds.xmax - bounds.xmin) + pad * 2))) : 320;
    river.style.height = RH + 'px';
    river.width = RW * DPR; river.height = RH * DPR;
    CW = charts.clientWidth;
    CH = 360;
    charts.style.height = CH + 'px';
    charts.width = CW * DPR; charts.height = CH * DPR;
    lens.width = 212 * DPR; lens.height = 212 * DPR;
    if (!bounds) return;
    const sx = (RW - pad * 2) / (bounds.xmax - bounds.xmin), sy = (RH - pad * 2) / (bounds.ymax - bounds.ymin);
    const s = Math.min(sx, sy);
    if (sx > sy) { // fill the width with more river up/downstream
      const extra = (RW - pad * 2) / s - (bounds.xmax - bounds.xmin);
      bounds.xmin -= extra * 0.4; bounds.xmax += extra * 0.6;
    }
    bounds.s = s;
    bounds.ox = (RW - s * (bounds.xmax - bounds.xmin)) / 2;
    bounds.oy = (RH - s * (bounds.ymax - bounds.ymin)) / 2;
    buildWater();
    seedParticles();
  }
  const X = (x) => bounds.ox + (x - bounds.xmin) * bounds.s;
  const Y = (y) => bounds.oy + (bounds.ymax - y) * bounds.s;

  function buildWater() {
    const rc = result.cfg;
    waterCache = document.createElement('canvas');
    waterCache.width = RW * DPR; waterCache.height = RH * DPR;
    const g = waterCache.getContext('2d');
    g.scale(DPR, DPR);
    g.fillStyle = C.bank; g.fillRect(0, 0, RW, RH);
    const W = rc.width;
    const x0 = X(bounds.xmin), x1 = X(bounds.xmax);
    const mix = (a, b, t) => {
      const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16)), pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
      return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
    };
    const hasPiers = result.piers.length > 0, shading = shadeOn(rc);
    if (!hasPiers && !shading) {
      const step = 0.25;
      for (let y = 0; y < W; y += step) {
        g.fillStyle = mix(C['water-slow'], C['water-fast'], S.flowAt(rc, y + step / 2) / Math.max(rc.U, 0.01));
        g.fillRect(x0, Y(y + step), x1 - x0, Math.ceil(step * bounds.s) + 1);
      }
    } else {
      // cell-by-cell: speed of the 2D flow, then night light level on top
      const cell = Math.max(0.4, 2 / bounds.s), fo = { x: 0, y: 0 };
      const a = C['water-slow'].match(/\w\w/g).map((h) => parseInt(h, 16)), b = C['water-fast'].match(/\w\w/g).map((h) => parseInt(h, 16));
      const px = Math.ceil(cell * bounds.s) + 1;
      for (let x = bounds.xmin; x < bounds.xmax; x += cell) {
        for (let y = 0; y < W; y += cell) {
          const cx = x + cell / 2, cy = y + cell / 2;
          S.flowXY(rc, cx, cy, result.piers, fo);
          const t = Math.min(1.3, Math.hypot(fo.x, fo.y) / Math.max(rc.U, 0.01));
          let r = a[0] + (b[0] - a[0]) * t, gg = a[1] + (b[1] - a[1]) * t, bb = a[2] + (b[2] - a[2]) * t;
          if (shading) {
            const L = S.lightAt(rc, cx, cy), k = 0.42 + 0.7 * L;
            r = r * k + 70 * L; gg = gg * k + 52 * L; bb = bb * k + 18 * L;
          }
          g.fillStyle = `rgb(${Math.min(255, r) | 0},${Math.min(255, gg) | 0},${Math.min(255, bb) | 0})`;
          g.fillRect(X(x), Y(y + cell), px, px);
        }
      }
    }
    drawStructures(g, rc);
    // banks
    g.strokeStyle = C['bank-edge']; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x0, Y(0)); g.lineTo(x1, Y(0)); g.moveTo(x0, Y(W)); g.lineTo(x1, Y(W)); g.stroke();
    // grid every 10 m
    g.strokeStyle = 'rgba(227,235,232,0.07)'; g.lineWidth = 1;
    g.font = NUM; g.fillStyle = C.faint; g.textBaseline = 'top'; g.textAlign = 'center';
    for (let x = Math.ceil(bounds.xmin / 10) * 10; x <= bounds.xmax; x += 10) {
      g.beginPath(); g.moveTo(X(x), Y(W)); g.lineTo(X(x), Y(0)); g.stroke();
      if (x !== 0) g.fillText(x > 0 ? `下流 ${x}` : `上流 ${-x}`, X(x), Y(0) + 6);
    }
    g.textAlign = 'left'; g.textBaseline = 'middle';
    for (let y = 10; y < W; y += 10) {
      g.beginPath(); g.moveTo(x0, Y(y)); g.lineTo(x1, Y(y)); g.stroke();
      g.fillText(`${y} m`, x0 + 4, Y(y) - 7);
    }
    // flow profile arrows at the left edge
    const ax = x0 + 46;
    g.strokeStyle = C.flow; g.fillStyle = C.flow; g.lineWidth = 1.4;
    const n = Math.max(5, Math.round(W / 5));
    for (let k = 1; k < n; k++) {
      const y = W * k / n, u = S.flowAt(rc, y), len = u * 34;
      if (len < 2) continue;
      g.globalAlpha = 0.75;
      g.beginPath(); g.moveTo(ax, Y(y)); g.lineTo(ax + len, Y(y)); g.stroke();
      g.beginPath(); g.moveTo(ax + len + 4, Y(y)); g.lineTo(ax + len - 2, Y(y) - 3); g.lineTo(ax + len - 2, Y(y) + 3); g.fill();
    }
    g.globalAlpha = 1;
    g.font = UI; g.fillStyle = C.flow; g.textBaseline = 'bottom';
    g.fillText(`流れ →  流芯 ${rc.U.toFixed(2)} m/s`, ax, Y(W) - 4 > 12 ? Y(W) - 4 : 14);
    g.fillStyle = C.muted; g.textBaseline = 'top';
    g.fillText('立ち位置の岸', x0 + 6, Y(0) + 20 < RH - 14 ? Y(0) + 20 : RH - 14);
  }
  function shadeOn(rc) { return rc.shade === 'lamp' || (rc.shade === 'bridge' && rc.bridge); }
  function drawStructures(g, rc) {
    const W = rc.width;
    g.save();
    g.beginPath(); g.rect(X(bounds.xmin), Y(W + 3), X(bounds.xmax) - X(bounds.xmin), Y(-4) - Y(W + 3)); g.clip();
    if (rc.bridge) {
      const bx0 = rc.bridgeX - rc.bridgeW / 2, bx1 = rc.bridgeX + rc.bridgeW / 2;
      // piers first (seen through the translucent deck)
      for (const p of result.piers) {
        g.fillStyle = '#4b4f47'; g.strokeStyle = '#7d8174'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(X(p.x), Y(p.y), Math.max(3, p.r * bounds.s), 0, Math.PI * 2); g.fill(); g.stroke();
      }
      g.fillStyle = 'rgba(205,208,196,0.13)';
      g.fillRect(X(bx0), Y(W + 3), X(bx1) - X(bx0), Y(-4) - Y(W + 3));
      g.strokeStyle = 'rgba(215,218,205,0.55)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(X(bx0), Y(W + 3)); g.lineTo(X(bx0), Y(-4)); g.moveTo(X(bx1), Y(W + 3)); g.lineTo(X(bx1), Y(-4)); g.stroke();
      g.strokeStyle = 'rgba(215,218,205,0.25)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(X(bx0 + 0.6), Y(W + 3)); g.lineTo(X(bx0 + 0.6), Y(-4)); g.moveTo(X(bx1 - 0.6), Y(W + 3)); g.lineTo(X(bx1 - 0.6), Y(-4)); g.stroke();
      g.font = UI; g.fillStyle = 'rgba(227,235,232,0.75)'; g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillText('橋', X(rc.bridgeX), Y(W + 2.6));
      if (rc.shade === 'bridge') {
        const edges = [];
        if (rc.litSide !== 'down') edges.push(bx0);
        if (rc.litSide !== 'up') edges.push(bx1);
        for (const ex of edges) {
          for (let y = 3; y < W; y += 9) {
            const gr = g.createRadialGradient(X(ex), Y(y), 0, X(ex), Y(y), 10);
            gr.addColorStop(0, 'rgba(255,214,140,0.95)'); gr.addColorStop(1, 'rgba(255,214,140,0)');
            g.fillStyle = gr; g.beginPath(); g.arc(X(ex), Y(y), 10, 0, Math.PI * 2); g.fill();
          }
          g.setLineDash([6, 5]); g.strokeStyle = 'rgba(255,214,140,0.85)'; g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(X(ex), Y(W)); g.lineTo(X(ex), Y(0)); g.stroke(); g.setLineDash([]);
          g.fillStyle = 'rgba(255,214,140,0.95)'; g.textAlign = ex === bx0 ? 'right' : 'left'; g.textBaseline = 'bottom';
          g.fillText('明暗', X(ex) + (ex === bx0 ? -5 : 5), Y(1.2));
        }
      }
    }
    if (rc.shade === 'lamp') {
      const R = rc.lampR * Math.pow(1.25, 1 / 6);
      g.setLineDash([6, 5]); g.strokeStyle = 'rgba(255,214,140,0.85)'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(X(rc.lampX), Y(-1), R * bounds.s, Math.PI, 2 * Math.PI); g.stroke(); g.setLineDash([]);
      const gr = g.createRadialGradient(X(rc.lampX), Y(-1), 0, X(rc.lampX), Y(-1), 12);
      gr.addColorStop(0, 'rgba(255,214,140,1)'); gr.addColorStop(1, 'rgba(255,214,140,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(X(rc.lampX), Y(-1), 12, 0, Math.PI * 2); g.fill();
      g.font = UI; g.fillStyle = 'rgba(255,214,140,0.95)'; g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillText('常夜灯', X(rc.lampX), Y(-1) + 8);
    }
    g.restore();
  }

  // ambient flow streaks (true current speed)
  let parts = [];
  const pfo = { x: 0, y: 0 };
  function seedParticles() {
    const rc = result.cfg;
    parts = [];
    const n = reduceMotion ? 0 : Math.round(Math.min(260, (bounds.xmax - bounds.xmin) * rc.width / 14));
    for (let i = 0; i < n; i++) parts.push({ x: bounds.xmin + Math.random() * (bounds.xmax - bounds.xmin), y: 0.3 + Math.random() * (rc.width - 0.6), age: Math.random() * 30 });
  }

  // ---------------------------------------------------------------- drawing helpers
  function swimColor(s, actionMin) {
    if (s < actionMin * 0.6) return C.drift;
    if (s < actionMin + 0.5) return C.swim;
    return C.hard;
  }
  function drawLure(g, x, y, th, len, opts) {
    const o = opts || {};
    g.save();
    g.translate(x, y);
    g.rotate(-th + (o.wobble || 0));
    const w = len * 0.26;
    g.beginPath();
    g.moveTo(len * 0.5, 0);
    g.bezierCurveTo(len * 0.42, -w, -len * 0.2, -w * 0.9, -len * 0.42, -w * 0.25);
    g.lineTo(-len * 0.5, -w * 0.55);
    g.lineTo(-len * 0.47, 0);
    g.lineTo(-len * 0.5, w * 0.55);
    g.lineTo(-len * 0.42, w * 0.25);
    g.bezierCurveTo(-len * 0.2, w * 0.9, len * 0.42, w, len * 0.5, 0);
    g.closePath();
    g.fillStyle = o.fill || C.text;
    g.globalAlpha = o.alpha == null ? 1 : o.alpha;
    g.fill();
    if (o.stroke) { g.strokeStyle = o.stroke; g.lineWidth = 1; g.stroke(); }
    if (o.eye) { g.fillStyle = C.bg; g.beginPath(); g.arc(len * 0.3, 0, Math.max(1, len * 0.05), 0, Math.PI * 2); g.fill(); }
    g.restore();
  }
  function arrow(g, x0, y0, x1, y1, color, width) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 3) return;
    const ux = dx / L, uy = dy / L, hs = Math.min(9, 4 + width * 2);
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = width; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1 - ux * hs * 0.8, y1 - uy * hs * 0.8); g.stroke();
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - ux * hs - uy * hs * 0.55, y1 - uy * hs + ux * hs * 0.55); g.lineTo(x1 - ux * hs + uy * hs * 0.55, y1 - uy * hs - ux * hs * 0.55); g.closePath(); g.fill();
  }
  const EVN = { cast: '着水', taut: '張る', slack: '緩む', turn: 'ターン', mend: 'メンド' };

  // ---------------------------------------------------------------- river view
  function frameAt(t) {
    const f = result.frames;
    return f[Math.max(0, Math.min(f.length - 1, Math.round(t / result.dt)))];
  }
  function drawRiver(realDt) {
    const rc = result.cfg;
    const g = rctx;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.drawImage(waterCache, 0, 0, RW, RH);
    // particles
    if (parts.length) {
      const adv = realDt * (playing ? speed : 1);
      g.lineWidth = 1; g.lineCap = 'round';
      for (const p of parts) {
        S.flowXY(rc, p.x, p.y, result.piers, pfo);
        const u = pfo.x, uy = pfo.y, sp = Math.hypot(u, uy);
        p.x += u * adv; p.y += uy * adv;
        p.age += adv;
        if (p.x > bounds.xmax || p.x < bounds.xmin || p.y < 0.2 || p.y > rc.width - 0.2 || p.age > 40 || sp < 0.01) {
          p.x = bounds.xmin + Math.random() * (bounds.xmax - bounds.xmin) * (Math.random() < 0.7 ? 0.15 : 1);
          p.y = 0.3 + Math.random() * (rc.width - 0.6); p.age = 0;
        }
        g.strokeStyle = `rgba(108,196,214,${0.08 + 0.22 * Math.min(1, sp / Math.max(rc.U, 0.01))})`;
        g.beginPath(); g.moveTo(X(p.x - u * 1.2), Y(p.y - uy * 1.2)); g.lineTo(X(p.x), Y(p.y)); g.stroke();
      }
    }
    const fr = result.frames, lm = result.lure.actionMin;
    const idx = Math.max(0, Math.min(fr.length - 1, Math.round(playT / result.dt)));

    // ghost trail
    if (ghost) {
      g.setLineDash([4, 4]); g.strokeStyle = 'rgba(227,235,232,0.35)'; g.lineWidth = 1.5;
      g.beginPath();
      for (let i = 0; i < ghost.lx.length; i++) { const x = X(ghost.lx[i]), y = Y(ghost.ly[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke(); g.setLineDash([]);
      if (ghost.turn) {
        g.strokeStyle = 'rgba(255,107,142,0.6)'; g.lineWidth = 1.5;
        const x = X(ghost.turn.x), y = Y(ghost.turn.y);
        g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 6, y); g.lineTo(x, y + 6); g.lineTo(x - 6, y); g.closePath(); g.stroke();
      }
    }
    // future path (faint), then past path colored by swim speed
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(227,235,232,0.18)';
    g.beginPath();
    for (let i = idx; i < fr.length; i++) { const x = X(fr[i].lx), y = Y(fr[i].ly); i === idx ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.stroke();
    g.lineWidth = 3; g.lineCap = 'round';
    for (let i = 1; i <= idx; i++) {
      g.strokeStyle = swimColor(fr[i].swim, lm);
      g.beginPath(); g.moveTo(X(fr[i - 1].lx), Y(fr[i - 1].ly)); g.lineTo(X(fr[i].lx), Y(fr[i].ly)); g.stroke();
    }
    // heading stamps every 1 s (full run; future faint)
    let lastX = -1e9, lastY = -1e9;
    const per = Math.round(1 / result.dt);
    for (let i = 0; i < fr.length; i += per) {
      const x = X(fr[i].lx), y = Y(fr[i].ly);
      if (Math.hypot(x - lastX, y - lastY) < 16) continue;
      lastX = x; lastY = y;
      drawLure(g, x, y, fr[i].th, 15, { fill: i <= idx ? C.text : C.muted, alpha: i <= idx ? 0.85 : 0.35 });
    }
    // events
    g.font = UI; g.textBaseline = 'bottom'; g.textAlign = 'left';
    for (const e of result.events) {
      const x = X(e.x), y = Y(e.y), past = e.t <= playT;
      g.globalAlpha = past ? 1 : 0.45;
      if (e.type === 'turn') {
        g.fillStyle = C.turn;
        g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 7, y); g.lineTo(x, y + 7); g.lineTo(x - 7, y); g.closePath(); g.fill();
        g.fillText(`ターン ${e.t.toFixed(1)}s`, x + 9, y - 6);
      } else if (e.type === 'mend') {
        g.strokeStyle = C.mend; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, 7, Math.PI * 0.2, Math.PI * 1.8); g.stroke();
        g.fillStyle = C.mend; g.fillText(e.dir > 0 ? '↺' : '↻', x - 4, y - 8);
      } else if (e.type === 'taut') {
        g.fillStyle = C.tension; g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill();
      } else if (e.type === 'shadeIn') {
        g.fillStyle = '#05090b'; g.strokeStyle = 'rgba(255,214,140,0.95)'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = 'rgba(255,214,140,0.95)'; g.beginPath(); g.arc(x, y, 6, Math.PI / 2, Math.PI * 1.5); g.fill();
        g.fillText(`暗部へ ${e.t.toFixed(1)}s`, x + 9, y + 14);
      } else if (e.type === 'pier') {
        g.strokeStyle = C.tension; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x - 5, y - 5); g.lineTo(x + 5, y + 5); g.moveTo(x + 5, y - 5); g.lineTo(x - 5, y + 5); g.stroke();
        g.fillStyle = C.tension; g.fillText('ラインが橋脚に接触', x + 9, y - 4);
      } else if (e.type === 'load') {
        g.fillStyle = C.swim; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 5, y + 4); g.lineTo(x - 5, y + 4); g.closePath(); g.fill();
        g.fillText('泳ぎ出し', x + 8, y + 12);
      } else if (e.type === 'cast') {
        g.strokeStyle = C.text; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.stroke();
        g.fillStyle = C.muted; g.fillText('着水', x + 8, y - 4);
      }
    }
    g.globalAlpha = 1;

    const f = fr[idx];
    const n = f.x.length;
    // chord (belly reference)
    g.setLineDash([2, 5]); g.strokeStyle = 'rgba(227,235,232,0.3)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(X(f.x[0]), Y(f.y[0])); g.lineTo(X(f.x[n - 1]), Y(f.y[n - 1])); g.stroke(); g.setLineDash([]);
    // angler + rod
    const ax = X(0), ay = Y(-1.2);
    g.strokeStyle = '#a58c62'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(X(f.x[0]), Y(f.y[0])); g.stroke();
    g.fillStyle = C.text; g.beginPath(); g.arc(ax, ay, 5, 0, Math.PI * 2); g.fill();
    // PE line
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = C.pe; g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(X(f.x[0]), Y(f.y[0]));
    for (let i = 1; i <= n - 3; i++) g.lineTo(X(f.x[i]), Y(f.y[i]));
    g.stroke();
    g.strokeStyle = C.leader; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(X(f.x[n - 3]), Y(f.y[n - 3])); g.lineTo(X(f.x[n - 2]), Y(f.y[n - 2])); g.lineTo(X(f.x[n - 1]), Y(f.y[n - 1])); g.stroke();
    // lure with wobble ∝ swim speed
    const amp = Math.min(0.35, Math.max(0, f.swim - lm * 0.5) * 0.45);
    const wob = amp * Math.sin(performance.now() / 1000 * (6 + f.swim * 14));
    drawLure(g, X(f.lx), Y(f.ly), f.th, 24, { fill: swimColor(f.swim, lm), stroke: C.bg, eye: true, wobble: reduceMotion ? 0 : wob });
  }

  // ---------------------------------------------------------------- lens (close-up vectors)
  function drawLens() {
    const g = lctx, S2 = 212;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, S2, S2);
    g.fillStyle = C['water-slow']; g.beginPath(); g.arc(S2 / 2, S2 / 2, S2 / 2 - 2, 0, Math.PI * 2); g.fill();
    if (shadeOn(result.cfg)) {
      const L0 = frameAt(playT).light;
      g.fillStyle = L0 < 0.5 ? `rgba(0,0,0,${0.5 - L0 * 0.6})` : `rgba(255,214,140,${L0 * 0.16})`;
      g.fill();
    }
    g.strokeStyle = C.rule; g.lineWidth = 1; g.stroke();
    const f = frameAt(playT), cx = S2 / 2, cy = S2 / 2, k = 62; // px per m/s
    g.font = NUM; g.fillStyle = C.faint; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText('上流 ← → 下流', cx, 10);
    // line tension direction
    const tl = Math.min(80, Math.sqrt(f.T / 0.1) * 46);
    if (f.T > 0.004) arrow(g, cx, cy, cx + Math.cos(f.lineA) * tl, cy - Math.sin(f.lineA) * tl, C.tension, 3);
    // water velocity
    arrow(g, cx, cy, cx + f.u * k, cy, C.flow, 2);
    // ground velocity
    arrow(g, cx, cy, cx + f.vx * k, cy - f.vy * k, C.text, 1.5);
    // relative flow felt by the lure: comes at the lure from -rel direction
    const rx = -f.relx, ry = -f.rely;
    if (f.rel > 0.03) arrow(g, cx - rx * k, cy + ry * k, cx, cy, C.rel, 2.5);
    const lm = result.lure.actionMin;
    const amp = Math.min(0.35, Math.max(0, f.swim - lm * 0.5) * 0.45);
    const wob = reduceMotion ? 0 : amp * Math.sin(performance.now() / 1000 * (6 + f.swim * 14));
    drawLure(g, cx, cy, f.th, 58, { fill: swimColor(f.swim, lm), stroke: C.bg, eye: true, wobble: wob });
  }

  // ---------------------------------------------------------------- readouts
  const readout = document.getElementById('readout'), stateEl = document.getElementById('state');
  const RO = [
    ['head', '頭の向き'], ['swim', '対水速度'], ['T', 'ライン張力'], ['ground', '対地 / 水流'],
    ['slack', 'スラッグ'], ['belly', 'ベリー'], ['Lout', 'ライン出量'], ['depth', '泳層（目安）'], ['light', '明暗'],
  ];
  readout.innerHTML = RO.map(([k, l]) => `<div><span>${l}</span><b id="r-${k}"></b></div>`).join('');
  const R = Object.fromEntries(RO.map(([k]) => [k, document.getElementById('r-' + k)]));
  function headText(phi) {
    const a = Math.abs(phi), side = phi > 0 ? '手前' : '沖';
    if (a < 20) return '上流';
    if (a < 70) return `上流・${side}寄り`;
    if (a < 110) return `${side}向き（横）`;
    if (a < 160) return `下流・${side}寄り`;
    return '下流';
  }
  function stateOf(f) {
    const lm = result.lure.actionMin, ground = Math.hypot(f.vx, f.vy);
    if (f.rel < 0.1) return ['ナチュラルドリフト', '流れと同じ速さで流下。頭の向きを決める力がほぼ無い'];
    if (f.swim >= lm && ground < 0.12) return ['ステイ（定位）', '流れを正面から受けてその場で泳ぐ'];
    if (f.swim >= lm && Math.abs(f.phi) <= 90) return ['流れを受けて泳ぐ', '頭が上流側。ドリフトからスイングへ'];
    if (f.swim >= lm) return ['下流へ引かれて泳ぐ', 'ベリーや巻きで流れより速く下流へ走る'];
    return ['弱い抵抗', '泳ぎ出す手前。姿勢が不安定'];
  }
  const em = (s) => `<em>${s}</em>`;
  function renderReadout() {
    const f = frameAt(playT);
    R.head.innerHTML = `${f.phi >= 0 ? '+' : ''}${f.phi.toFixed(0)}°${em(headText(f.phi))}`;
    R.swim.innerHTML = `${f.swim.toFixed(2)}${em('m/s')}`;
    R.T.innerHTML = `${(f.T * 101.97).toFixed(1)}${em('gf')}`;
    R.ground.innerHTML = `${Math.hypot(f.vx, f.vy).toFixed(2)}${em('/')}${f.u.toFixed(2)}`;
    R.slack.innerHTML = `${(f.slack * 100).toFixed(0)}${em('%')}`;
    R.belly.innerHTML = `${Math.abs(f.belly).toFixed(1)}${em(f.belly >= 0 ? 'm 下流側' : 'm 上流側')}`;
    R.Lout.innerHTML = `${f.Lout.toFixed(1)}${em('m')}`;
    R.depth.innerHTML = `${f.depth.toFixed(2)}${em('m')}`;
    R.light.innerHTML = shadeOn(result.cfg) ? `${f.light < 0.5 ? '暗' : '明'}${em(`光量 ${Math.round(f.light * 100)}%`)}` : `—${em('設定なし')}`;
    const [s, d] = stateOf(f);
    stateEl.innerHTML = `${s}<small>${d}</small>`;
  }

  // ---------------------------------------------------------------- summary
  const summaryEl = document.getElementById('summary');
  function summarize(r) {
    const ev = r.events, fr = r.frames;
    const taut = ev.find((e) => e.type === 'taut'), turn = ev.find((e) => e.type === 'turn');
    let nat = 0, swim = 0;
    for (const f of fr) { if (f.rel < 0.1) nat += r.dt; if (f.swim >= r.lure.actionMin) swim += r.dt; }
    const load = ev.find((e) => e.type === 'load'), shadeIn = ev.find((e) => e.type === 'shadeIn');
    let dark = 0;
    if (shadeOn(r.cfg)) for (const f of fr) if (f.light < 0.5) dark += r.dt;
    return {
      taut, turn, load, shadeIn, nat, swim, dark, shading: shadeOn(r.cfg), hasPiers: r.piers.length > 0,
      pier: ev.filter((e) => e.type === 'pier').length,
      dur: fr[fr.length - 1].t, end: r.endReason, mends: ev.filter((e) => e.type === 'mend').length,
    };
  }
  function entryText(e) {
    if (!e) return '入らない';
    const how = e.rel < 0.1 ? '流れに乗って' : e.swim >= result.lure.actionMin ? '泳ぎながら' : '弱く引かれて';
    return `${e.t.toFixed(1)} s・頭は${headText(e.phi)}・${how}`;
  }
  function renderSummary() {
    const s = summarize(result), gs = ghost && ghost.sum;
    const pos = (e) => (e ? `${e.x >= 0 ? '下流' : '上流'} ${Math.abs(e.x).toFixed(0)} m・岸から ${e.y.toFixed(0)} m` : '—');
    const cell = (label, v, gv, cls) => `<div><span>${label}</span><b class="${cls || ''}">${v}</b>${gs ? `<span class="ghostv">比較: ${gv}</span>` : ''}</div>`;
    summaryEl.innerHTML =
      cell('最初のターン', s.turn ? `${s.turn.t.toFixed(1)} s` : 'なし', gs ? (gs.turn ? `${gs.turn.t.toFixed(1)} s` : 'なし') : '', 'turn') +
      cell('ターン位置', pos(s.turn), gs ? pos(gs.turn) : '') +
      cell('ナチュラルドリフト', `${s.nat.toFixed(1)} s`, gs ? `${gs.nat.toFixed(1)} s` : '') +
      cell('泳いでいる時間', `${s.swim.toFixed(1)} s`, gs ? `${gs.swim.toFixed(1)} s` : '') +
      cell('泳ぎ出し', s.load ? `${s.load.t.toFixed(1)} s` : '—', gs ? (gs.load ? `${gs.load.t.toFixed(1)} s` : '—') : '') +
      (s.shading ? cell('暗部へ入った時', entryText(s.shadeIn), gs ? entryText(gs.shadeIn) : '', 'shade') +
        cell('暗部にいた時間', `${s.dark.toFixed(1)} s`, gs ? `${(gs.dark || 0).toFixed(1)} s` : '') : '') +
      (s.hasPiers ? cell('ラインの橋脚接触', s.pier ? `${s.pier} 回` : 'なし', gs ? (gs.pier ? `${gs.pier} 回` : 'なし') : '') : '') +
      cell('終了', `${s.dur.toFixed(0)} s・${s.end}`, gs ? `${gs.dur.toFixed(0)} s` : '');
  }

  // drag comparison table (current settings)
  function renderDragTable() {
    const f0 = result.frames[0];
    const Lpe = f0.Lout - cfg.leaderLen, U = cfg.U, lure = result.lure;
    const q = 0.5 * 1000 * U * U;
    const gf = (n) => (n * 101.97).toFixed(1);
    const pe = q * 1.2 * S.LINE.pe.d * Lpe, fc = q * 1.2 * S.LINE.fc.d * cfg.leaderLen, side = q * lure.Cl * lure.Al;
    document.getElementById('dragtable').innerHTML =
      `<tr><th>流速 ${U.toFixed(2)} m/s を真横から受けた時</th><th style="text-align:right">投影面積</th><th style="text-align:right">抵抗</th></tr>` +
      `<tr><td>PE 1号 × ${Lpe.toFixed(0)} m</td><td class="n">${(S.LINE.pe.d * Lpe * 1e4).toFixed(0)} cm²</td><td class="n">${gf(pe)} gf</td></tr>` +
      `<tr><td>フロロ 4号 × ${cfg.leaderLen} m</td><td class="n">${(S.LINE.fc.d * cfg.leaderLen * 1e4).toFixed(1)} cm²</td><td class="n">${gf(fc)} gf</td></tr>` +
      `<tr><td>${lure.name}（側面）</td><td class="n">${(lure.Al * 1e4).toFixed(0)} cm²</td><td class="n">${gf(side)} gf</td></tr>`;
  }

  // ---------------------------------------------------------------- charts
  function lanes() {
    const lm = result.lure.actionMin;
    let maxSwim = 1, maxT = 20, maxSl = 30, maxD = 1;
    for (const f of result.frames) { maxSwim = Math.max(maxSwim, f.swim); maxT = Math.max(maxT, f.T * 101.97); maxSl = Math.max(maxSl, f.slack * 100); maxD = Math.max(maxD, f.depth); }
    return [
      { label: '頭の向き', get: (f) => f.phi, min: -180, max: 180, ticks: [[180, '下流'], [90, '手前'], [0, '上流'], [-90, '沖'], [-180, '下流']], color: C.text, band: [-90, 90], wrap: true, h: 1.5 },
      { label: '対水速度 m/s', get: (f) => f.swim, min: Math.min(0, -0.1), max: Math.ceil(maxSwim * 5) / 5, ref: lm, refLabel: '泳ぎ出し', color: C.swim, h: 1 },
      { label: '張力 gf', get: (f) => f.T * 101.97, min: 0, max: Math.ceil(maxT / 10) * 10, color: C.tension, h: 1 },
      { label: 'スラッグ %', get: (f) => f.slack * 100, min: 0, max: Math.ceil(maxSl / 10) * 10, color: C.pe, h: 0.8 },
      { label: '泳層 m', get: (f) => f.depth, min: 0, max: Math.ceil(maxD * 2) / 2, color: C.rel, invert: true, h: 0.8 },
    ].concat(shadeOn(result.cfg) ? [{ label: '明暗', get: (f) => f.light, min: 0, max: 1, strip: true, h: 0.28 }] : []);
  }
  let chartGeom = null;
  function drawCharts() {
    const g = cctx;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, CW, CH);
    const L = lanes(), left = 74, right = 12, top = 18, bottom = 22, gap = 16;
    const tot = L.reduce((a, l) => a + l.h, 0);
    const avail = CH - top - bottom - gap * (L.length - 1);
    const fr = result.frames, end = fr[fr.length - 1].t;
    const tx = (t) => left + (CW - left - right) * t / Math.max(end, 1);
    chartGeom = { left, right, end };
    let y0 = top;
    g.font = NUM;
    for (const l of L) {
      const h = avail * l.h / tot;
      const ty = (v) => (l.invert ? y0 + h * (v - l.min) / (l.max - l.min) : y0 + h - h * (v - l.min) / (l.max - l.min));
      if (l.strip) {
        const wpx = (CW - left - right) / fr.length + 0.6;
        for (const f of fr) {
          const L0 = f.light;
          g.fillStyle = L0 < 0.5 ? `rgba(0,0,0,${0.85 - L0})` : `rgba(255,214,140,${0.25 + 0.6 * L0})`;
          g.fillRect(tx(f.t), y0, wpx, h);
        }
        g.fillStyle = C.muted; g.textAlign = 'right'; g.textBaseline = 'middle'; g.font = UI;
        g.fillText('明暗', left - 6, y0 + h / 2); g.font = NUM;
        y0 += h + gap;
        continue;
      }
      g.fillStyle = 'rgba(227,235,232,0.03)'; g.fillRect(left, y0, CW - left - right, h);
      if (l.band) { g.fillStyle = 'rgba(159,230,198,0.07)'; g.fillRect(left, ty(l.band[1]), CW - left - right, ty(l.band[0]) - ty(l.band[1])); }
      g.strokeStyle = 'rgba(227,235,232,0.08)'; g.lineWidth = 1;
      g.fillStyle = C.muted; g.textAlign = 'right'; g.textBaseline = 'middle';
      const ticks = l.ticks || [[l.min, String(+l.min.toFixed(2))], [l.max, String(+l.max.toFixed(2))]];
      for (const [v, s] of ticks) {
        g.beginPath(); g.moveTo(left, ty(v)); g.lineTo(CW - right, ty(v)); g.stroke();
        const yy = ty(v);
        g.textBaseline = Math.abs(yy - y0) < 2 ? 'top' : Math.abs(yy - (y0 + h)) < 2 ? 'bottom' : 'middle';
        g.fillText(s, left - 6, yy);
      }
      g.textAlign = 'left'; g.fillStyle = C.text; g.font = UI; g.textBaseline = 'top';
      g.fillText(l.label, left + 6, y0 + 3); g.font = NUM;
      if (l.ref != null) {
        g.setLineDash([3, 4]); g.strokeStyle = C.muted;
        g.beginPath(); g.moveTo(left, ty(l.ref)); g.lineTo(CW - right, ty(l.ref)); g.stroke(); g.setLineDash([]);
        g.fillStyle = C.muted; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText(l.refLabel, CW - right - 4, ty(l.ref) - 2);
      }
      // ghost series
      if (ghost && ghost.series) {
        const gsr = ghost.series[l.label];
        if (gsr) {
          g.strokeStyle = 'rgba(227,235,232,0.28)'; g.lineWidth = 1; g.setLineDash([3, 3]);
          g.beginPath(); let pv = null;
          for (let i = 0; i < gsr.length; i++) {
            const t = i * result.dt; if (t > end) break;
            const v = Math.max(l.min, Math.min(l.max, gsr[i]));
            if (pv === null || (l.wrap && Math.abs(gsr[i] - pv) > 180)) g.moveTo(tx(t), ty(v)); else g.lineTo(tx(t), ty(v));
            pv = gsr[i];
          }
          g.stroke(); g.setLineDash([]);
        }
      }
      // series
      g.strokeStyle = l.color; g.lineWidth = 1.6; g.beginPath();
      let pv = null;
      for (const f of fr) {
        const raw = l.get(f), v = Math.max(l.min, Math.min(l.max, raw));
        if (pv === null || (l.wrap && Math.abs(raw - pv) > 180)) g.moveTo(tx(f.t), ty(v)); else g.lineTo(tx(f.t), ty(v));
        pv = raw;
      }
      g.stroke();
      y0 += h + gap;
    }
    // events
    g.textBaseline = 'top'; g.textAlign = 'center'; g.font = UI;
    for (const e of result.events) {
      const sty = { turn: [C.turn, 'ターン'], mend: [C.mend, e.dir > 0 ? '↺' : '↻'], shadeIn: ['#ffd68c', '暗部へ'], pier: [C.tension, '✕'] }[e.type];
      if (!sty) continue;
      const x = tx(e.t);
      g.strokeStyle = sty[0]; g.lineWidth = 1; g.globalAlpha = 0.7;
      g.beginPath(); g.moveTo(x, top); g.lineTo(x, CH - bottom); g.stroke(); g.globalAlpha = 1;
      g.fillStyle = sty[0]; g.fillText(sty[1], x, 1);
    }
    // time axis
    g.fillStyle = C.muted; g.font = NUM; g.textBaseline = 'top';
    const stepT = end > 80 ? 20 : end > 40 ? 10 : 5;
    for (let t = 0; t <= end + 1e-6; t += stepT) g.fillText(`${t}s`, tx(t), CH - bottom + 6);
    // playhead
    g.strokeStyle = C.text; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(tx(playT), top); g.lineTo(tx(playT), CH - bottom); g.stroke();
  }
  function chartScrub(ev) {
    if (!chartGeom) return;
    const r = charts.getBoundingClientRect();
    const x = ev.clientX - r.left;
    playT = Math.max(0, Math.min(chartGeom.end, (x - chartGeom.left) / (r.width - chartGeom.left - chartGeom.right) * chartGeom.end));
    playing = false;
  }
  let dragging = false;
  charts.addEventListener('pointerdown', (e) => { dragging = true; charts.setPointerCapture(e.pointerId); chartScrub(e); });
  charts.addEventListener('pointermove', (e) => { if (dragging) chartScrub(e); });
  charts.addEventListener('pointerup', () => { dragging = false; });

  // ---------------------------------------------------------------- transport
  const playBtn = document.getElementById('play'), scrub = document.getElementById('scrub'), tlabel = document.getElementById('tlabel');
  playBtn.addEventListener('click', () => {
    if (!result) return;
    const end = result.frames[result.frames.length - 1].t;
    if (!playing && playT >= end - 0.01) playT = 0;
    playing = !playing;
  });
  scrub.addEventListener('input', () => { playT = parseFloat(scrub.value); playing = false; });
  const speedBox = document.getElementById('speed');
  const speedBtns = [0.5, 1, 2, 4, 8].map((v) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = `×${v}`;
    b.addEventListener('click', () => { speed = v; speedBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
    b.setAttribute('aria-pressed', String(v === speed));
    speedBox.appendChild(b); return b;
  });
  document.getElementById('ghostBtn').addEventListener('click', () => {
    if (!result) return;
    const fr = result.frames, L = lanes(), series = {};
    for (const l of L) series[l.label] = Float32Array.from(fr, l.get);
    ghost = {
      lx: Float32Array.from(fr, (f) => f.lx), ly: Float32Array.from(fr, (f) => f.ly),
      turn: result.events.find((e) => e.type === 'turn'), sum: summarize(result), series,
    };
    renderSummary();
  });

  // ---------------------------------------------------------------- loop
  let last = performance.now();
  function tick(now) {
    const realDt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    if (result && bounds) {
      const end = result.frames[result.frames.length - 1].t;
      if (playing) { playT += realDt * speed; if (playT >= end) { playT = end; playing = false; } }
      playBtn.textContent = playing ? '❚❚' : '▶';
      tlabel.textContent = `${playT.toFixed(1)} / ${end.toFixed(0)} s`;
      if (document.activeElement !== scrub) scrub.value = playT;
      drawRiver(realDt);
      drawLens();
      drawCharts();
      renderReadout();
    }
    requestAnimationFrame(tick);
  }
  let rsTimer = null;
  window.addEventListener('resize', () => { clearTimeout(rsTimer); rsTimer = setTimeout(() => { if (bounds) layout(); }, 100); });

  if (location.hash === '#bridge') { const pb = PRESETS.find((p) => p.set.bridge); if (pb) Object.assign(cfg, JSON.parse(JSON.stringify(pb.set))); }
  syncControls();
  layout();
  onResult(S.simulate(JSON.parse(JSON.stringify(cfg))), false);
  requestAnimationFrame(tick);
})();
