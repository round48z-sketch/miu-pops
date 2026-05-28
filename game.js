(function () {
  "use strict";

  const COLS = 6;
  const ROWS = 12;
  const COLORS = [
    { fill: "#ff3d7a", glow: "#e80055", core: "#ff9ec4", light: "#ffe0ee", deep: "#8a1040", glass: "rgba(255, 80, 150, 0.9)", neon: "#ffc8e0", rim: "#ffb0d0" },
    { fill: "#4d8fff", glow: "#1a50ff", core: "#a8c8ff", light: "#e8f4ff", deep: "#103080", glass: "rgba(90, 150, 255, 0.9)", neon: "#c8e0ff", rim: "#a0c8ff" },
    { fill: "#18e8a0", glow: "#00a868", core: "#90ffd8", light: "#e0fff4", deep: "#087848", glass: "rgba(40, 240, 170, 0.88)", neon: "#b8ffe8", rim: "#80ffcc" },
    { fill: "#ffd020", glow: "#d89800", core: "#fff0a0", light: "#fffce0", deep: "#987008", glass: "rgba(255, 220, 80, 0.9)", neon: "#fff8c0", rim: "#ffe880" },
    { fill: "#ff6830", glow: "#e03800", core: "#ffb090", light: "#ffe8d8", deep: "#902808", glass: "rgba(255, 120, 60, 0.9)", neon: "#ffd8c0", rim: "#ffc0a0" },
    { fill: "#c868ff", glow: "#9820f0", core: "#e8c0ff", light: "#f8e8ff", deep: "#601090", glass: "rgba(200, 120, 255, 0.9)", neon: "#ecd0ff", rim: "#e0b0ff" },
  ];

  const DIFFICULTIES = {
    easy: { label: "EASY", dropMs: 720, scoreMult: 1, colors: 3 },
    normal: { label: "NORMAL", dropMs: 550, scoreMult: 1, colors: 4 },
    hard: { label: "HARD", dropMs: 400, scoreMult: 1.25, colors: 5 },
    fever: { label: "FEVER", dropMs: 280, scoreMult: 1.5, colors: 6 },
  };
  const OFFSETS = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];

  const LOCK_DELAY = 280;
  const POP_MS = 420;
  const GRAVITY_PAUSE_MS = 80;
  const CHAIN_PAUSE_MS = 100;
  const MAX_PARTICLES = 100;
  const CHAIN_BANNER_MS = 1400;

  const $ = (id) => document.getElementById(id);
  const screens = {
    home: $("screen-home"),
    game: $("screen-game"),
    over: $("screen-over"),
  };
  const canvas = $("board");
  const ctx = canvas.getContext("2d");
  const bgCanvas = $("board-bg");
  const bgCtx = bgCanvas.getContext("2d");
  const scoreEl = $("score");
  const finalScoreEl = $("final-score");
  const chainBanner = $("chain-banner");
  const chainBannerText = chainBanner ? chainBanner.querySelector(".chain-banner__text") : null;
  const nextCanvas = $("next-preview");
  const nextCtx = nextCanvas ? nextCanvas.getContext("2d") : null;
  const diffDisplayEl = $("diff-display");
  const diffButtons = document.querySelectorAll(".diff-btn");

  let board, score, pair, nextPair, rot, dropTimer, lockTimer, gameOver, animating;
  let difficultyId = "normal";
  let popEffects, particles, explosions, boardFlash, rafId, bgRafId, bgHearts, bgSparkles, wobbles;
  let chainBannerTimer;
  let popIntensity = 1;

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
    document.body.classList.toggle("is-playing", name === "game");
  }

  function emptyBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  function getDifficulty() {
    return DIFFICULTIES[difficultyId] || DIFFICULTIES.normal;
  }

  function getColorCount() {
    return getDifficulty().colors;
  }

  function randColor() {
    return Math.floor(Math.random() * getColorCount());
  }

  function setDifficulty(id) {
    if (!DIFFICULTIES[id]) return;
    difficultyId = id;
    diffButtons.forEach((btn) => {
      const on = btn.dataset.diff === id;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (diffDisplayEl) {
      diffDisplayEl.textContent = getDifficulty().label;
      if (id === "fever") diffDisplayEl.setAttribute("data-mode", "fever");
      else diffDisplayEl.removeAttribute("data-mode");
    }
  }

  function scheduleDropLoop() {
    if (dropTimer) clearTimeout(dropTimer);
    dropTimer = setTimeout(tickDrop, getDifficulty().dropMs);
  }

  function rollPairColors() {
    return { c0: randColor(), c1: randColor() };
  }

  function ensureNextPair() {
    if (!nextPair) nextPair = rollPairColors();
  }

  function drawNextPreview(now) {
    if (!nextCtx || !nextCanvas || !nextPair) return;
    const w = nextCanvas.width;
    const h = nextCanvas.height;
    const time = now == null ? performance.now() : now;
    nextCtx.clearRect(0, 0, w, h);
    const r = Math.min(w, h) * 0.2;
    drawGlassOrb(w * 0.5, h * 0.34, r, nextPair.c0, { now: time, ctx: nextCtx, vivid: true, alpha: 1 });
    drawGlassOrb(w * 0.5, h * 0.7, r, nextPair.c1, { now: time, ctx: nextCtx, vivid: true, alpha: 1 });
  }

  function spawnPair() {
    ensureNextPair();
    const incoming = nextPair;
    nextPair = rollPairColors();
    drawNextPreview();

    const cx = Math.floor(COLS / 2) - 1;
    const cy = 0;
    pair = {
      x: cx,
      y: cy,
      c0: incoming.c0,
      c1: incoming.c1,
    };
    rot = 0;
    if (!canPlace(pair.x, pair.y, rot)) {
      gameOver = true;
      finalScoreEl.textContent = score;
      showScreen("over");
    }
  }

  function cellOfPair(i) {
    const [dx, dy] = i === 0 ? [0, 0] : OFFSETS[rot];
    return { x: pair.x + dx, y: pair.y + dy, c: i === 0 ? pair.c0 : pair.c1 };
  }

  function canPlace(px, py, r) {
    for (let i = 0; i < 2; i++) {
      const [dx, dy] = i === 0 ? [0, 0] : OFFSETS[r];
      const x = px + dx;
      const y = py + dy;
      if (x < 0 || x >= COLS || y >= ROWS) return false;
      if (y >= 0 && board[y][x] !== null) return false;
    }
    return true;
  }

  function lockPair() {
    for (let i = 0; i < 2; i++) {
      const { x, y, c } = cellOfPair(i);
      if (y >= 0 && y < ROWS && x >= 0 && x < COLS) {
        board[y][x] = c;
        registerWobble(x, y, 1);
      }
    }
    pair = null;
    rot = 0;
    resolveChains();
  }

  function registerWobble(x, y, strength) {
    if (!wobbles) wobbles = {};
    wobbles[`${x},${y}`] = { t0: performance.now(), strength: strength || 1 };
  }

  function getWobble(x, y, now) {
    const w = wobbles && wobbles[`${x},${y}`];
    if (!w) return { sx: 1, sy: 1 };
    const t = (now - w.t0) / 1000;
    if (t > 0.65) {
      delete wobbles[`${x},${y}`];
      return { sx: 1, sy: 1 };
    }
    const damp = Math.exp(-t * 5.5) * w.strength;
    const wave = Math.sin(t * 26);
    return { sx: 1 + wave * 0.14 * damp, sy: 1 - wave * 0.11 * damp };
  }

  function pairJiggle(now) {
    const t = now * 0.001;
    const w = Math.sin(t * 9) * 0.035;
    return { sx: 1 + w, sy: 1 - w * 0.85 };
  }

  /** 各列ごとに1マスずつ独立して下へ詰める（ぷよぷよ風） */
  function applyGravity() {
    let moved = false;
    for (let x = 0; x < COLS; x++) {
      let write = ROWS - 1;
      for (let y = ROWS - 1; y >= 0; y--) {
        if (board[y][x] === null) continue;
        if (y !== write) {
          board[write][x] = board[y][x];
          board[y][x] = null;
          moved = true;
        }
        write--;
      }
      while (write >= 0) {
        if (board[write][x] !== null) board[write][x] = null;
        write--;
      }
    }
    return moved;
  }

  function applyGravityUntilSettled() {
    let moved = false;
    let guard = 0;
    while (applyGravity() && guard < ROWS + 2) {
      moved = true;
      guard++;
    }
    return moved;
  }

  function findGroups() {
    const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    const toClear = [];

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const color = board[y][x];
        if (color === null || visited[y][x]) continue;

        const stack = [[x, y]];
        const group = [];
        visited[y][x] = true;

        while (stack.length) {
          const [cx, cy] = stack.pop();
          group.push([cx, cy]);
          const dirs = [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
          ];
          for (const [dx, dy] of dirs) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (
              nx >= 0 &&
              nx < COLS &&
              ny >= 0 &&
              ny < ROWS &&
              !visited[ny][nx] &&
              board[ny][nx] === color
            ) {
              visited[ny][nx] = true;
              stack.push([nx, ny]);
            }
          }
        }

        if (group.length >= 4) {
          toClear.push(...group);
        }
      }
    }
    return toClear;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function easeInQuad(t) {
    return t * t;
  }

  function popProgress(t, intensity) {
    const k = 0.55 + Math.min(intensity || 1, 6) * 0.12;
    if (t < 0.22) {
      const p = easeOutCubic(t / 0.22);
      return { scale: 1 + k * p, alpha: 1, ring: 0.45 + p * 0.55, squash: 1 - p * 0.08 };
    }
    if (t < 0.42) {
      const p = (t - 0.22) / 0.2;
      return { scale: 1 + k + p * 0.12, alpha: 1, ring: 1, squash: 0.92 + Math.sin(p * Math.PI) * 0.06 };
    }
    const p = easeInQuad((t - 0.42) / 0.58);
    return { scale: 1 + k * 0.95 - p * 0.25, alpha: 1 - p, ring: 1 - p * 0.85, squash: 1 };
  }

  function cellCenter(x, y) {
    const w = canvas.width / COLS;
    const h = canvas.height / ROWS;
    const pad = 2;
    const size = Math.min(w, h) - pad * 2;
    return {
      cx: x * w + w / 2,
      cy: y * h + h / 2,
      r: size / 2,
      cellW: w,
      cellH: h,
    };
  }

  function colorAt(x, y) {
    if (pair) {
      for (let i = 0; i < 2; i++) {
        const { x: px, y: py, c } = cellOfPair(i);
        if (px === x && py === y) return c;
      }
    }
    if (y >= 0 && y < ROWS && x >= 0 && x < COLS) return board[y][x];
    return null;
  }

  function getStick(x, y, colorIndex) {
    const c = colorIndex;
    return {
      u: y > 0 && colorAt(x, y - 1) === c,
      d: y < ROWS - 1 && colorAt(x, y + 1) === c,
      l: x > 0 && colorAt(x - 1, y) === c,
      r: x < COLS - 1 && colorAt(x + 1, y) === c,
    };
  }

  function stickOffset(stick, r) {
    let ox = 0;
    let oy = 0;
    if (stick.u) oy -= r * 0.1;
    if (stick.d) oy += r * 0.1;
    if (stick.l) ox -= r * 0.1;
    if (stick.r) ox += r * 0.1;
    const n = (stick.u ? 1 : 0) + (stick.d ? 1 : 0) + (stick.l ? 1 : 0) + (stick.r ? 1 : 0);
    const grow = 1 + n * 0.035;
    return { ox, oy, grow };
  }

  function drawStickConnector(g, ax, ay, bx, by, r, colorIndex, alpha) {
    const col = COLORS[colorIndex];
    const a = alpha == null ? 1 : alpha;
    g.save();
    g.lineCap = "round";
    g.lineJoin = "round";
    g.shadowColor = col.glow;
    g.shadowBlur = 10;
    g.strokeStyle = col.fill;
    g.globalAlpha = a * 0.95;
    g.lineWidth = r * 1.92;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.stroke();
    g.shadowBlur = 4;
    g.strokeStyle = col.core;
    g.globalAlpha = a;
    g.lineWidth = r * 1.35;
    g.stroke();
    g.restore();
  }

  function forEachStickLink(fn) {
    const linked = new Set();
    function once(x1, y1, x2, y2, c) {
      const key = [x1, y1, x2, y2].sort((a, b) => a - b).join(",");
      if (linked.has(key)) return;
      linked.add(key);
      fn(x1, y1, x2, y2, c);
    }

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = board[y][x];
        if (c === null) continue;
        if (x + 1 < COLS && board[y][x + 1] === c) once(x, y, x + 1, y, c);
        if (y + 1 < ROWS && board[y + 1][x] === c) once(x, y, x, y + 1, c);
      }
    }

    if (!pair) return;
    for (let i = 0; i < 2; i++) {
      const { x, y, c } = cellOfPair(i);
      if (x + 1 < COLS && colorAt(x + 1, y) === c) once(x, y, x + 1, y, c);
      if (y + 1 < ROWS && colorAt(x, y + 1) === c) once(x, y, x, y + 1, c);
      if (x > 0 && colorAt(x - 1, y) === c) once(x, y, x - 1, y, c);
      if (y > 0 && colorAt(x, y - 1) === c) once(x, y, x, y - 1, c);
    }
  }

  function drawAllStickBridges(g, alpha) {
    forEachStickLink((x1, y1, x2, y2, c) => {
      const p1 = cellCenter(x1, y1);
      const p2 = cellCenter(x2, y2);
      drawStickConnector(g, p1.cx, p1.cy, p2.cx, p2.cy, p1.r, c, alpha);
    });
  }

  function strokeOpenRim(g, cx, cy, r, stick, col, a) {
    const segs = [
      { hide: stick.u, from: -Math.PI * 0.88, to: -Math.PI * 0.12 },
      { hide: stick.r, from: -Math.PI * 0.12, to: Math.PI * 0.12 },
      { hide: stick.d, from: Math.PI * 0.12, to: Math.PI * 0.88 },
      { hide: stick.l, from: Math.PI * 0.88, to: Math.PI * 1.12 },
    ];
    g.save();
    g.globalAlpha = a * 0.85;
    g.strokeStyle = col.rim;
    g.lineWidth = 1.6;
    g.shadowColor = col.glow;
    g.shadowBlur = 6;
    for (const s of segs) {
      if (s.hide) continue;
      g.beginPath();
      g.arc(cx, cy, r - 0.5, s.from, s.to);
      g.stroke();
    }
    g.shadowBlur = 0;
    g.globalAlpha = a * 0.45;
    g.strokeStyle = "rgba(255, 255, 255, 0.55)";
    g.lineWidth = 1;
    for (const s of segs) {
      if (s.hide) continue;
      g.beginPath();
      g.arc(cx, cy, r - 0.8, s.from, s.to);
      g.stroke();
    }
    g.restore();
  }

  function colorAt(x, y) {
    if (pair) {
      for (let i = 0; i < 2; i++) {
        const p = cellOfPair(i);
        if (p.x === x && p.y === y) return p.c;
      }
    }
    if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return null;
    return board[y][x];
  }

  function getStickStretch(x, y) {
    const c = colorAt(x, y);
    if (c === null) return { sx: 1, sy: 1 };
    let sx = 1;
    let sy = 1;
    if (colorAt(x - 1, y) === c) sx += 0.07;
    if (colorAt(x + 1, y) === c) sx += 0.07;
    if (colorAt(x, y - 1) === c) sy += 0.07;
    if (colorAt(x, y + 1) === c) sy += 0.07;
    return { sx, sy };
  }

  function drawStickBridge(x0, y0, x1, y1, colorIndex) {
    const a = cellCenter(x0, y0);
    const b = cellCenter(x1, y1);
    const col = COLORS[colorIndex];
    const r = a.r;
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const inset = r * 0.68;
    const sx = a.cx + ux * inset;
    const sy = a.cy + uy * inset;
    const ex = b.cx - ux * inset;
    const ey = b.cy - uy * inset;

    const grad = ctx.createLinearGradient(a.cx, a.cy, b.cx, b.cy);
    grad.addColorStop(0, col.fill);
    grad.addColorStop(0.5, col.core);
    grad.addColorStop(1, col.fill);

    ctx.save();
    ctx.shadowColor = col.glow;
    ctx.shadowBlur = 14;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.lineWidth = r * 1.95;
    ctx.strokeStyle = grad;
    ctx.globalAlpha = 0.92;
    ctx.stroke();
    ctx.lineWidth = r * 1.45;
    ctx.strokeStyle = col.core;
    ctx.globalAlpha = 0.88;
    ctx.stroke();
    ctx.lineWidth = r * 0.5;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawColorBridges() {
    for (let y = -1; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = colorAt(x, y);
        if (c === null) continue;
        if (colorAt(x + 1, y) === c) drawStickBridge(x, y, x + 1, y, c);
        if (colorAt(x, y + 1) === c) drawStickBridge(x, y, x, y + 1, c);
      }
    }
  }

  function getChainDisplay(chain) {
    if (chain >= 5) return { text: "MIU FEVER!!", tier: "fever" };
    if (chain === 4) return { text: "4 CHAIN!", tier: "4" };
    if (chain === 3) return { text: "3 CHAIN!", tier: "3" };
    if (chain === 2) return { text: "2 CHAIN!", tier: "2" };
    return null;
  }

  function getChainBannerMs(chain) {
    if (chain >= 5) return 1650;
    if (chain >= 4) return 1550;
    if (chain >= 3) return 1450;
    return CHAIN_BANNER_MS;
  }

  function showChainBanner(chain) {
    if (!chainBanner || !chainBannerText || chain < 2) return;
    const info = getChainDisplay(chain);
    if (!info) return;

    if (chainBannerTimer) clearTimeout(chainBannerTimer);
    chainBanner.classList.remove(
      "chain-banner--show",
      "chain-tier-2",
      "chain-tier-3",
      "chain-tier-4",
      "chain-tier-fever"
    );
    chainBannerText.textContent = info.text;
    chainBanner.hidden = false;
    void chainBanner.offsetWidth;
    chainBanner.classList.add("chain-banner--show", "chain-tier-" + info.tier);

    const stage = document.querySelector(".board-stage");
    if (stage) {
      stage.classList.remove("chain-shake");
      void stage.offsetWidth;
      stage.classList.add("chain-shake");
      setTimeout(() => stage.classList.remove("chain-shake"), 450);
    }

    chainBannerTimer = setTimeout(() => {
      chainBanner.classList.remove("chain-banner--show");
      chainBanner.hidden = true;
    }, getChainBannerMs(chain));
  }

  function hideChainBanner() {
    if (!chainBanner) return;
    if (chainBannerTimer) clearTimeout(chainBannerTimer);
    chainBanner.classList.remove("chain-banner--show");
    chainBanner.hidden = true;
  }

  function trimParticles() {
    if (particles.length > MAX_PARTICLES) {
      particles = particles.slice(particles.length - MAX_PARTICLES);
    }
  }

  function addParticle(p) {
    particles.push(p);
    trimParticles();
  }

  function spawnPopBurst(cells, chainLevel) {
    const set = new Set(cells.map(([x, y]) => `${x},${y}`));
    const now = performance.now();
    const intensity = Math.min(chainLevel || 1, 6);
    popIntensity = intensity;
    popEffects = [];

    let sumX = 0;
    let sumY = 0;
    for (const [x, y] of cells) {
      const { cx, cy } = cellCenter(x, y);
      sumX += cx;
      sumY += cy;
    }
    const burstX = sumX / cells.length;
    const burstY = sumY / cells.length;
    const baseR = Math.min(canvas.width, canvas.height) * 0.08;

    explosions.push({
      cx: burstX,
      cy: burstY,
      r0: baseR * (0.9 + intensity * 0.12),
      t0: now,
      tier: intensity,
      color: COLORS[cells.length % COLORS.length].glow,
    });
    for (let i = 0; i < Math.min(intensity, 4); i++) {
      explosions.push({
        cx: burstX,
        cy: burstY,
        r0: baseR * (0.75 + i * 0.15),
        t0: now + i * 50,
        tier: intensity,
        color: i % 2 === 0 ? COLORS[cells.length % COLORS.length].glow : "#7ef9ff",
      });
    }

    const perCell = 6 + intensity * 2;
    const starsPerCell = 8 + intensity * 3;

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!set.has(`${x},${y}`)) continue;
        const c = board[y][x];
        popEffects.push({ x, y, c, t0: now });
        board[y][x] = null;

        const { cx, cy, r: cellR } = cellCenter(x, y);
        const col = COLORS[c];

        explosions.push({
          cx,
          cy,
          r0: cellR * 1.15,
          t0: now,
          tier: intensity,
          color: col.glow,
        });

        for (let i = 0; i < starsPerCell; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 2.5 + Math.random() * (4 + intensity);
          addParticle({
            x: cx,
            y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 1.5,
            life: 1,
            color: "#ffffff",
            glow: col.neon,
            size: 2 + Math.random() * (3 + intensity * 0.4),
            kind: "star",
            t0: now,
          });
        }

        for (let i = 0; i < perCell; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 1.5 + Math.random() * (3.5 + intensity * 0.6);
          addParticle({
            x: cx,
            y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1,
            color: col.fill,
            glow: col.glow,
            size: 2 + Math.random() * (3 + intensity * 0.35),
            kind: i % 2 === 0 ? "star" : "dot",
            t0: now,
          });
        }
      }
    }

    boardFlash = Math.min(0.55 + intensity * 0.12, 0.95);
    scoreEl.classList.add("score-pop");
    setTimeout(() => scoreEl.classList.remove("score-pop"), 300);
    showChainBanner(chainLevel);
    pulseBoardShell(chainLevel);
  }

  function pulseBoardShell(chainLevel) {
    const shell = document.querySelector(".board-shell");
    if (!shell || chainLevel < 2) return;
    shell.classList.remove("board-combo-pulse", "board-combo-pulse--hot");
    void shell.offsetWidth;
    shell.classList.add("board-combo-pulse");
    if (chainLevel >= 4) shell.classList.add("board-combo-pulse--hot");
    setTimeout(() => shell.classList.remove("board-combo-pulse", "board-combo-pulse--hot"), 550);
  }

  function stopRaf() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function startRaf(loop) {
    stopRaf();
    function frame(now) {
      loop(now);
      if (rafId) rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
  }

  function resolveChains() {
    animating = true;
    let chain = 0;
    popEffects = [];
    particles = [];
    explosions = [];

    function finishTurn() {
      animating = false;
      popEffects = [];
      particles = [];
      explosions = [];
      boardFlash = 0;
      hideChainBanner();
      stopRaf();
      spawnPair();
      draw();
    }

    function step() {
      const cells = findGroups();
      if (cells.length === 0) {
        if (applyGravityUntilSettled()) {
          draw();
          setTimeout(step, CHAIN_PAUSE_MS);
          return;
        }
        finishTurn();
        return;
      }

      chain++;
      const pts = Math.floor(cells.length * 10 * chain * getDifficulty().scoreMult);
      score += pts;
      scoreEl.textContent = score;
      spawnPopBurst(cells, chain);

      const popStart = performance.now();
      let popFinished = false;
      startRaf((now) => {
        const elapsed = now - popStart;
        particles = particles.filter((p) => {
          const age = (now - p.t0) / (380 + (p.kind === "star" ? 80 : 0));
          p.life = 1 - age;
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.1;
          p.vx *= 0.99;
          return p.life > 0;
        });
        trimParticles();
        explosions = explosions.filter((ex) => (now - ex.t0) / 520 < 1);
        if (boardFlash > 0) boardFlash = Math.max(0, boardFlash - 0.035);
        draw(now);
        if (!popFinished && elapsed >= POP_MS) {
          popFinished = true;
          stopRaf();
          setTimeout(() => {
            popEffects = [];
            applyGravityUntilSettled();
            draw();
            setTimeout(step, CHAIN_PAUSE_MS);
          }, GRAVITY_PAUSE_MS);
        }
      });
    }

    step();
  }

  function resetLock() {
    if (lockTimer) {
      clearTimeout(lockTimer);
      lockTimer = null;
    }
  }

  function tryMove(dx, dy) {
    if (!pair || animating || gameOver) return false;
    if (canPlace(pair.x + dx, pair.y + dy, rot)) {
      pair.x += dx;
      pair.y += dy;
      if (dx !== 0) resetLock();
      return true;
    }
    return false;
  }

  function tryRotate() {
    if (!pair || animating || gameOver) return;
    const next = (rot + 1) % 4;
    const kicks = [
      [0, 0],
      [-1, 0],
      [1, 0],
      [0, -1],
      [2, 0],
      [-2, 0],
    ];
    for (const [kx, ky] of kicks) {
      if (canPlace(pair.x + kx, pair.y + ky, next)) {
        pair.x += kx;
        pair.y += ky;
        rot = next;
        resetLock();
        return;
      }
    }
  }

  function scheduleLock() {
    if (lockTimer) return;
    lockTimer = setTimeout(() => {
      lockTimer = null;
      if (pair) lockPair();
    }, LOCK_DELAY);
  }

  function softDrop() {
    if (!pair || animating || gameOver) return;
    if (!tryMove(0, 1)) {
      scheduleLock();
    } else {
      resetLock();
    }
  }

  function tickDrop() {
    if (gameOver) return;
    if (pair && !animating) {
      if (!tryMove(0, 1)) {
        scheduleLock();
      } else {
        resetLock();
      }
      draw();
    }
    scheduleDropLoop();
  }

  function traceGem(g, cx, cy, r) {
    g.beginPath();
    g.moveTo(cx, cy - r * 0.98);
    g.lineTo(cx + r * 0.62, cy - r * 0.62);
    g.lineTo(cx + r * 0.98, cy - r * 0.08);
    g.lineTo(cx + r * 0.72, cy + r * 0.58);
    g.lineTo(cx, cy + r * 1.02);
    g.lineTo(cx - r * 0.72, cy + r * 0.58);
    g.lineTo(cx - r * 0.98, cy - r * 0.08);
    g.lineTo(cx - r * 0.62, cy - r * 0.62);
    g.closePath();
  }

  function drawGemFacets(g, cx, cy, r, col, a) {
    const facets = [
      [cx, cy - r * 0.5, cx, cy, cx, cy - r * 0.98],
      [cx, cy - r * 0.5, cx, cy, cx + r * 0.62, cy - r * 0.62],
      [cx, cy - r * 0.5, cx, cy, cx + r * 0.98, cy - r * 0.08],
      [cx, cy, cx, cy + r * 0.58, cx + r * 0.72, cy + r * 0.58],
      [cx, cy, cx, cy + r * 0.58, cx, cy + r * 1.02],
      [cx, cy, cx, cy + r * 0.58, cx - r * 0.72, cy + r * 0.58],
      [cx, cy - r * 0.5, cx, cy, cx - r * 0.62, cy - r * 0.62],
      [cx, cy - r * 0.5, cx, cy, cx - r * 0.98, cy - r * 0.08],
    ];
    g.save();
    g.globalAlpha = a * 0.22;
    g.fillStyle = col.light;
    for (let i = 0; i < facets.length; i++) {
      const f = facets[i];
      g.beginPath();
      g.moveTo(f[0], f[1]);
      g.lineTo(f[2], f[3]);
      g.lineTo(f[4], f[5]);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = a * 0.35;
    g.strokeStyle = col.light;
    g.lineWidth = 0.8;
    for (const f of facets) {
      g.beginPath();
      g.moveTo(cx, cy - r * 0.12);
      g.lineTo(f[4], f[5]);
      g.stroke();
    }
    g.restore();
  }

  function strokeGemRim(g, cx, cy, r, col, a, width) {
    g.save();
    g.globalAlpha = a;
    traceGem(g, cx, cy, r);
    g.strokeStyle = col.rim;
    g.lineWidth = width || 1.6;
    g.shadowColor = col.glow;
    g.shadowBlur = 8;
    g.stroke();
    g.shadowBlur = 0;
    g.globalAlpha = a * 0.55;
    g.strokeStyle = "rgba(255, 255, 255, 0.65)";
    g.lineWidth = 0.7;
    g.stroke();
    g.restore();
  }

  function drawGlassOrb(cx, cy, baseR, colorIndex, opts) {
    const col = COLORS[colorIndex];
    const o = opts || {};
    const g = o.ctx || ctx;
    const vivid = o.vivid === true;
    const scale = o.scale || 1;
    const r = baseR * scale;
    const a = o.alpha == null ? 1 : o.alpha;
    const ring = o.ring || 0;
    const sx = o.squashX || 1;
    const sy = o.squashY || 1;
    const stick = o.stick;
    const now = o.now == null ? performance.now() : o.now;

    let drawCx = cx;
    let drawCy = cy;
    let drawR = r;
    if (stick) {
      const off = stickOffset(stick, r);
      drawCx += off.ox;
      drawCy += off.oy;
      drawR *= off.grow;
    }

    g.save();
    g.translate(drawCx, drawCy);
    g.scale(sx, sy);
    g.translate(-drawCx, -drawCy);
    g.globalAlpha = a;

    if (ring > 0) {
      traceGem(g, drawCx, drawCy, drawR * (1.12 + ring * 0.35));
      g.strokeStyle = col.neon;
      g.lineWidth = 2 + ring * 2;
      g.shadowColor = col.glow;
      g.shadowBlur = 26 + ring * 20;
      g.globalAlpha = a * ring * 0.8;
      g.stroke();
      g.shadowBlur = 0;
      g.globalAlpha = a;
    }

    g.shadowColor = col.glow;
    g.shadowBlur = vivid ? 20 : 14 + (scale > 1 ? (scale - 1) * 24 : 0);
    traceGem(g, drawCx, drawCy, drawR * 1.06);
    g.fillStyle = col.glass;
    g.fill();
    g.shadowBlur = 0;

    g.save();
    traceGem(g, drawCx, drawCy, drawR);
    g.clip();

    const body = g.createRadialGradient(
      drawCx - drawR * 0.35,
      drawCy - drawR * 0.4,
      drawR * 0.05,
      drawCx + drawR * 0.1,
      drawCy + drawR * 0.15,
      drawR * 1.1
    );
    body.addColorStop(0, col.light);
    body.addColorStop(0.25, col.core);
    body.addColorStop(0.55, col.fill);
    body.addColorStop(0.85, col.glow);
    body.addColorStop(1, col.deep);
    g.fillStyle = body;
    traceGem(g, drawCx, drawCy, drawR);
    g.fill();

    const inner = g.createRadialGradient(drawCx, drawCy - drawR * 0.1, 0, drawCx, drawCy, drawR * 0.75);
    inner.addColorStop(0, col.core);
    inner.addColorStop(0.6, col.fill);
    inner.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = a * 0.75;
    g.fillStyle = inner;
    g.beginPath();
    g.ellipse(drawCx, drawCy, drawR * 0.55, drawR * 0.62, 0, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = a;

    drawGemFacets(g, drawCx, drawCy, drawR, col, a);

    const table = g.createLinearGradient(
      drawCx - drawR * 0.45,
      drawCy - drawR * 0.7,
      drawCx + drawR * 0.2,
      drawCy - drawR * 0.2
    );
    table.addColorStop(0, `rgba(255, 255, 255, ${0.85 * a})`);
    table.addColorStop(0.5, `rgba(255, 255, 255, ${0.35 * a})`);
    table.addColorStop(1, "rgba(255, 255, 255, 0)");
    g.fillStyle = table;
    g.beginPath();
    g.moveTo(drawCx - drawR * 0.35, drawCy - drawR * 0.55);
    g.lineTo(drawCx + drawR * 0.15, drawCy - drawR * 0.72);
    g.lineTo(drawCx + drawR * 0.4, drawCy - drawR * 0.35);
    g.lineTo(drawCx - drawR * 0.05, drawCy - drawR * 0.25);
    g.closePath();
    g.fill();

    const fire = g.createLinearGradient(drawCx + drawR * 0.2, drawCy, drawCx - drawR * 0.3, drawCy + drawR * 0.5);
    fire.addColorStop(0, `rgba(255, 255, 255, ${0.15 * a})`);
    fire.addColorStop(0.5, `rgba(200, 240, 255, ${0.12 * a})`);
    fire.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = fire;
    g.fillRect(drawCx - drawR, drawCy - drawR, drawR * 2, drawR * 2);

    g.restore();

    const hiX = drawCx - drawR * 0.22;
    const hiY = drawCy - drawR * 0.38;
    const hi = g.createRadialGradient(hiX, hiY, 0, hiX, hiY, drawR * 0.35);
    hi.addColorStop(0, `rgba(255, 255, 255, ${0.95 * a})`);
    hi.addColorStop(0.45, `rgba(255, 255, 255, ${0.25 * a})`);
    hi.addColorStop(1, "rgba(255, 255, 255, 0)");
    g.fillStyle = hi;
    g.beginPath();
    g.ellipse(hiX, hiY, drawR * 0.22, drawR * 0.14, -0.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `rgba(255, 255, 255, ${0.9 * a})`;
    g.beginPath();
    g.arc(drawCx - drawR * 0.08, drawCy - drawR * 0.48, drawR * 0.06, 0, Math.PI * 2);
    g.fill();

    const stuck = stick && (stick.u || stick.d || stick.l || stick.r);
    if (!stuck) {
      strokeGemRim(g, drawCx, drawCy, drawR, col, a, vivid ? 2 : 1.5);
    } else {
      g.save();
      g.globalAlpha = a * 0.4;
      g.strokeStyle = col.light;
      g.lineWidth = 0.8;
      traceGem(g, drawCx, drawCy, drawR);
      g.stroke();
      g.restore();
    }

    const idle = 1 + Math.sin(now * 0.004 + drawCx * 0.1 + drawCy * 0.1) * 0.012;
    if (idle !== 1 && !ring && !vivid && !stuck) {
      g.save();
      g.globalAlpha = a * 0.12;
      g.strokeStyle = col.neon;
      g.lineWidth = 1;
      traceGem(g, drawCx, drawCy, drawR * idle);
      g.stroke();
      g.restore();
    }

    g.restore();
  }

  function drawCellAt(cx, cy, baseR, colorIndex, alpha, scale, ring, extra) {
    const o = extra || {};
    drawGlassOrb(cx, cy, baseR, colorIndex, {
      alpha,
      scale,
      ring,
      squashX: o.squashX,
      squashY: o.squashY,
      now: o.now,
      vivid: o.vivid,
      stick: o.stick,
    });
  }

  function drawCell(x, y, colorIndex, opts) {
    const { cx, cy, r } = cellCenter(x, y);
    const o = opts || {};
    const wob = o.wobble !== false ? getWobble(x, y, o.now || performance.now()) : { sx: 1, sy: 1 };
    const stick = o.stick != null ? o.stick : getStick(x, y, colorIndex);
    drawCellAt(cx, cy, r, colorIndex, o.alpha, o.scale, o.ring || 0, {
      squashX: o.squashX != null ? o.squashX * wob.sx : wob.sx,
      squashY: o.squashY != null ? o.squashY * wob.sy : wob.sy,
      now: o.now,
      vivid: true,
      stick,
    });
  }

  function drawParticle(p) {
    const a = p.life * 0.92;
    const sz = p.size * p.life;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.glow;
    ctx.shadowBlur = p.kind === "star" ? 18 + p.size * 2 : 10;
    if (p.kind === "star") {
      ctx.translate(p.x, p.y);
      ctx.rotate(p.t0 * 0.01);
      ctx.beginPath();
      ctx.moveTo(0, -sz);
      ctx.lineTo(sz * 0.28, 0);
      ctx.lineTo(0, sz);
      ctx.lineTo(-sz * 0.28, 0);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, sz, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawExplosions(now) {
    for (const ex of explosions) {
      const dur = 480 - Math.min(ex.tier, 6) * 20;
      const age = (now - ex.t0) / dur;
      if (age >= 1) continue;
      const pop = age < 0.2 ? easeOutCubic(age / 0.2) : 1;
      const fade = 1 - easeInQuad(age);
      const alpha = fade * (0.6 + ex.tier * 0.07) * pop;
      const r = ex.r0 * (0.15 + age * 1.65);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = ex.color;
      ctx.lineWidth = (3.5 + ex.tier * 0.65) * (1 - age * 0.45);
      ctx.shadowColor = ex.color;
      ctx.shadowBlur = 18 + ex.tier * 6;
      ctx.beginPath();
      ctx.arc(ex.cx, ex.cy, r, 0, Math.PI * 2);
      ctx.stroke();
      if (age < 0.28) {
        const inner = r * (0.5 - age * 0.8);
        ctx.globalAlpha = alpha * 0.55;
        ctx.fillStyle = ex.color;
        ctx.beginPath();
        ctx.arc(ex.cx, ex.cy, Math.max(inner, 2), 0, Math.PI * 2);
        ctx.fill();
      }
      if (age < 0.5 && ex.tier >= 3) {
        ctx.globalAlpha = alpha * 0.35;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(ex.cx, ex.cy, r * 0.55, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  const BOARD_BG_ALPHA = 0.62;

  function drawBoardBg(w, h) {
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, `rgba(34, 16, 42, ${BOARD_BG_ALPHA})`);
    bg.addColorStop(0.5, `rgba(26, 12, 24, ${BOARD_BG_ALPHA * 0.95})`);
    bg.addColorStop(1, `rgba(20, 8, 24, ${BOARD_BG_ALPHA * 0.9})`);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }

  function initBgDecor() {
    bgHearts = Array.from({ length: 7 }, (_, i) => ({
      x: 0.08 + Math.random() * 0.84,
      y: 0.05 + Math.random() * 0.9,
      size: 10 + Math.random() * 16,
      rot: Math.random() * Math.PI,
      phase: Math.random() * Math.PI * 2,
      drift: 0.00015 + Math.random() * 0.0002,
    }));
    bgSparkles = Array.from({ length: 24 }, () => ({
      x: Math.random(),
      y: Math.random(),
      size: 1.5 + Math.random() * 2.5,
      phase: Math.random() * Math.PI * 2,
      speed: 2 + Math.random() * 3,
    }));
  }

  function drawHeartPath(c, x, y, size, rot) {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.beginPath();
    const s = size;
    c.moveTo(0, s * 0.3);
    c.bezierCurveTo(0, -s * 0.35, -s * 0.9, -s * 0.35, 0, s * 0.85);
    c.bezierCurveTo(s * 0.9, -s * 0.35, 0, -s * 0.35, 0, s * 0.3);
    c.closePath();
    c.restore();
  }

  function drawBgFrame(now) {
    const w = bgCanvas.width;
    const h = bgCanvas.height;
    if (!w || !h) return;
    const t = now * 0.001;
    bgCtx.clearRect(0, 0, w, h);

    const base = bgCtx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#2a1438");
    base.addColorStop(0.45, "#1e0e28");
    base.addColorStop(1, "#120818");
    bgCtx.fillStyle = base;
    bgCtx.fillRect(0, 0, w, h);

    const miuX = w * 0.5;
    const miuY = h * 0.38;
    const breathe = 1 + Math.sin(t * 1.2) * 0.04;
    const auraR = w * 0.38 * breathe;

    const aura = bgCtx.createRadialGradient(miuX, miuY, 0, miuX, miuY, auraR);
    aura.addColorStop(0, "rgba(255, 140, 220, 0.22)");
    aura.addColorStop(0.45, "rgba(180, 100, 255, 0.1)");
    aura.addColorStop(1, "rgba(255, 60, 180, 0)");
    bgCtx.fillStyle = aura;
    bgCtx.fillRect(0, 0, w, h);

    for (let i = 0; i < 3; i++) {
      const ringR = w * (0.22 + i * 0.08) * breathe;
      bgCtx.beginPath();
      bgCtx.arc(miuX, miuY, ringR, t * 0.3 + i, t * 0.3 + i + Math.PI * 1.2);
      bgCtx.strokeStyle = i % 2 === 0 ? "rgba(120, 220, 255, 0.12)" : "rgba(255, 120, 200, 0.14)";
      bgCtx.lineWidth = 1.5;
      bgCtx.stroke();
    }

    const faceR = w * 0.14 * breathe;
    const faceGrad = bgCtx.createRadialGradient(
      miuX - faceR * 0.2,
      miuY - faceR * 0.2,
      0,
      miuX,
      miuY,
      faceR
    );
    faceGrad.addColorStop(0, "rgba(255, 200, 235, 0.35)");
    faceGrad.addColorStop(0.6, "rgba(255, 120, 200, 0.18)");
    faceGrad.addColorStop(1, "rgba(180, 80, 200, 0.05)");
    bgCtx.fillStyle = faceGrad;
    bgCtx.beginPath();
    bgCtx.arc(miuX, miuY, faceR, 0, Math.PI * 2);
    bgCtx.fill();

    bgCtx.fillStyle = "rgba(255, 220, 245, 0.55)";
    const eyeY = miuY - faceR * 0.08;
    const eyeDX = faceR * 0.28;
    bgCtx.beginPath();
    bgCtx.ellipse(miuX - eyeDX, eyeY, faceR * 0.09, faceR * 0.11, 0, 0, Math.PI * 2);
    bgCtx.ellipse(miuX + eyeDX, eyeY, faceR * 0.09, faceR * 0.11, 0, 0, Math.PI * 2);
    bgCtx.fill();

    bgCtx.strokeStyle = "rgba(255, 180, 220, 0.4)";
    bgCtx.lineWidth = 1.5;
    bgCtx.beginPath();
    bgCtx.arc(miuX, miuY + faceR * 0.18, faceR * 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
    bgCtx.stroke();

    bgCtx.font = `600 ${Math.floor(w * 0.055)}px "Hiragino Sans", sans-serif`;
    bgCtx.textAlign = "center";
    bgCtx.fillStyle = "rgba(255, 160, 220, 0.2)";
    bgCtx.fillText("MIU", miuX, miuY + faceR * 1.15);

    for (const hrt of bgHearts) {
      const floatY = ((hrt.y + Math.sin(t * 0.8 + hrt.phase) * 0.02) % 1.1) - 0.05;
      const x = hrt.x * w;
      const y = floatY * h;
      const pulse = 0.85 + Math.sin(t * 1.5 + hrt.phase) * 0.15;
      const alpha = 0.12 + Math.sin(t + hrt.phase) * 0.06;
      drawHeartPath(bgCtx, x, y, hrt.size * pulse, hrt.rot + t * hrt.drift * 50);
      bgCtx.strokeStyle = `rgba(255, 120, 200, ${alpha})`;
      bgCtx.lineWidth = 1.2;
      bgCtx.shadowColor = "rgba(255, 80, 180, 0.5)";
      bgCtx.shadowBlur = 8;
      bgCtx.stroke();
      bgCtx.shadowBlur = 0;
    }

    for (const sp of bgSparkles) {
      const tw = 0.35 + Math.sin(t * sp.speed + sp.phase) * 0.65;
      const sx = sp.x * w;
      const sy = sp.y * h;
      const sz = sp.size * tw;
      bgCtx.save();
      bgCtx.translate(sx, sy);
      bgCtx.rotate(t * 0.5 + sp.phase);
      bgCtx.fillStyle = `rgba(255, 240, 255, ${0.3 * tw})`;
      bgCtx.shadowColor = "#ff9ee0";
      bgCtx.shadowBlur = 6 * tw;
      bgCtx.beginPath();
      bgCtx.moveTo(0, -sz);
      bgCtx.lineTo(sz * 0.28, 0);
      bgCtx.lineTo(0, sz);
      bgCtx.lineTo(-sz * 0.28, 0);
      bgCtx.closePath();
      bgCtx.fill();
      bgCtx.restore();
    }

    for (let i = 0; i < 6; i++) {
      const bx = w * (0.15 + i * 0.14) + Math.sin(t * 0.6 + i) * 8;
      const by = h * 0.82 + Math.cos(t * 0.5 + i * 1.3) * 6;
      bgCtx.fillStyle = `rgba(140, 220, 255, ${0.08 + Math.sin(t + i) * 0.04})`;
      bgCtx.beginPath();
      bgCtx.arc(bx, by, 2, 0, Math.PI * 2);
      bgCtx.fill();
    }
  }

  function stopBgRaf() {
    if (bgRafId) {
      cancelAnimationFrame(bgRafId);
      bgRafId = null;
    }
  }

  function startBgAnim() {
    stopBgRaf();
    function frame(now) {
      if (!screens.game.classList.contains("active")) {
        stopBgRaf();
        return;
      }
      drawBgFrame(now);
      bgRafId = requestAnimationFrame(frame);
    }
    bgRafId = requestAnimationFrame(frame);
  }

  function draw(now) {
    const w = canvas.width;
    const h = canvas.height;
    const time = now == null ? performance.now() : now;
    ctx.clearRect(0, 0, w, h);
    drawBoardBg(w, h);

    const cellW = w / COLS;
    const cellH = h / ROWS;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        ctx.strokeStyle = "rgba(255, 120, 220, 0.05)";
        ctx.strokeRect(x * cellW, y * cellH, cellW, cellH);
      }
    }

    drawAllStickBridges(ctx, 1);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (board[y][x] !== null) {
          drawCell(x, y, board[y][x], { now: time });
        }
      }
    }

    if (popEffects && popEffects.length) {
      for (const eff of popEffects) {
        const t = Math.min((time - eff.t0) / POP_MS, 1);
        const { scale, alpha, ring, squash } = popProgress(t, popIntensity);
        const { cx, cy, r } = cellCenter(eff.x, eff.y);
        const sy = squash != null ? squash : 1;
        const sx = squash != null ? 1 / squash : 1;
        drawCellAt(cx, cy, r, eff.c, alpha, scale, ring, {
          now: time,
          squashX: sx,
          squashY: sy,
        });
      }
    }

    drawExplosions(time);

    for (const p of particles) {
      drawParticle(p);
    }

    if (boardFlash > 0) {
      ctx.fillStyle = `rgba(255, 120, 220, ${boardFlash * 0.35})`;
      ctx.fillRect(0, 0, w, h);
    }

    if (pair) {
      const jig = pairJiggle(time);
      for (let i = 0; i < 2; i++) {
        const { x, y, c } = cellOfPair(i);
        if (y >= -1) {
          drawCell(x, y, c, {
            now: time,
            squashX: jig.sx,
            squashY: jig.sy,
            wobble: false,
            stick: getStick(x, y, c),
          });
        }
      }
    }
  }

  function resizeCanvas() {
    const stage = canvas.closest(".board-stage");
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.floor(rect.width * dpr);
    const height = Math.floor(width * 2);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      bgCanvas.width = width;
      bgCanvas.height = height;
      draw();
    }
    if (nextCanvas) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const nw = Math.floor(88 * dpr);
      const nh = Math.floor(108 * dpr);
      if (nextCanvas.width !== nw || nextCanvas.height !== nh) {
        nextCanvas.width = nw;
        nextCanvas.height = nh;
      }
      drawNextPreview();
    }
  }

  function startGame() {
    if (dropTimer) clearTimeout(dropTimer);
    if (lockTimer) clearTimeout(lockTimer);
    stopRaf();
    if (diffDisplayEl) {
      diffDisplayEl.textContent = getDifficulty().label;
      if (difficultyId === "fever") diffDisplayEl.setAttribute("data-mode", "fever");
      else diffDisplayEl.removeAttribute("data-mode");
    }
    board = emptyBoard();
    score = 0;
    scoreEl.textContent = "0";
    gameOver = false;
    animating = false;
    pair = null;
    nextPair = rollPairColors();
    popEffects = [];
    particles = [];
    explosions = [];
    boardFlash = 0;
    wobbles = {};
    hideChainBanner();
    dropTimer = null;
    lockTimer = null;
    initBgDecor();
    spawnPair();
    showScreen("game");
    resizeCanvas();
    draw();
    startBgAnim();
    scheduleDropLoop();
  }

  diffButtons.forEach((btn) => {
    btn.addEventListener("click", () => setDifficulty(btn.dataset.diff));
  });
  setDifficulty("normal");

  function goHome() {
    if (dropTimer) clearTimeout(dropTimer);
    if (lockTimer) clearTimeout(lockTimer);
    stopRaf();
    stopBgRaf();
    hideChainBanner();
    gameOver = true;
    showScreen("home");
  }

  function bindControl(btn, action) {
    const run = (e) => {
      e.preventDefault();
      action();
      draw();
    };
    btn.addEventListener("touchstart", run, { passive: false });
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      action();
      draw();
    });
  }

  bindControl($("btn-left"), () => tryMove(-1, 0));
  bindControl($("btn-right"), () => tryMove(1, 0));
  bindControl($("btn-rotate"), tryRotate);
  bindControl($("btn-down"), softDrop);

  $("btn-start").addEventListener("click", startGame);
  $("btn-retry").addEventListener("click", startGame);
  $("btn-retry-over").addEventListener("click", startGame);
  $("btn-home").addEventListener("click", goHome);
  $("btn-home-over").addEventListener("click", goHome);

  document.addEventListener("keydown", (e) => {
    if (!screens.game.classList.contains("active") || gameOver || animating) return;
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        tryMove(-1, 0);
        break;
      case "ArrowRight":
        e.preventDefault();
        tryMove(1, 0);
        break;
      case "ArrowDown":
        e.preventDefault();
        softDrop();
        break;
      case "ArrowUp":
      case " ":
      case "z":
      case "Z":
        e.preventDefault();
        tryRotate();
        break;
      default:
        return;
    }
    draw();
  });

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 100));

  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.target === canvas || e.target === bgCanvas) e.preventDefault();
    },
    { passive: false }
  );
})();
