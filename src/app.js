/* Remorse Chess UI. Depends on RemorseEngine and RemorseAI globals. */
(function () {
  'use strict';
  const E = window.RemorseEngine;
  const AI = window.RemorseAI;
  const Pieces = window.RemorsePieces;
  const { Game, uci, mFrom, mTo, mPromo, mFlags, F_ABSOLVE, WHITE, BLACK } = E;

  const OPP_NAMES = { easy: 'Novice', medium: 'Deacon', hard: 'Bishop', claude: 'Claude', human: 'Player 2' };
  const STORE_KEY = 'remorse-chess-v1';

  const $ = (id) => document.getElementById(id);

  const S = {
    game: new Game(),
    settings: { opponent: 'medium', side: 'w', chosenSide: 'w' },
    selected: -1,
    flipped: false,
    thinking: false,
    token: 0,
    pendingPromo: null,
    lastEntry: null,
    claudeNote: '',
    claudeAbort: null,
    drag: null,
    noSlide: false,
    overShown: false,
  };

  /* ---------- persistence ---------- */
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(snapshot()));
    } catch (e) { /* storage unavailable */ }
  }
  function snapshot() {
    return {
      settings: S.settings,
      startFen: S.game.startFen,
      moves: S.game.history.map((h) => h.uci),
      flipped: S.flipped,
    };
  }
  function restore(data) {
    if (!data || !data.settings) return false;
    try {
      const g = new Game(data.startFen || undefined);
      for (const u of data.moves || []) {
        const m = g.findMove(u);
        if (m === undefined) return false;
        g.play(m);
      }
      S.game = g;
      S.settings = Object.assign(S.settings, data.settings);
      S.flipped = !!data.flipped;
      S.lastEntry = g.history[g.history.length - 1] || null;
      return true;
    } catch (e) { return false; }
  }

  /* ---------- helpers ---------- */
  const humanColor = () => (S.settings.side === 'b' ? BLACK : WHITE);
  const isHumanTurn = () => S.settings.opponent === 'human' || S.game.pos.turn === humanColor();
  const colorName = (c) => (c === WHITE ? 'White' : 'Black');

  function playerName(color) {
    if (S.settings.opponent === 'human') return colorName(color);
    return color === humanColor() ? 'You' : OPP_NAMES[S.settings.opponent];
  }

  /* ---------- Claude availability ---------- */
  let samplePromise = null;
  function getSample() {
    if (!samplePromise) {
      samplePromise = (async () => {
        try {
          if (!window.claude || typeof window.claude.use !== 'function') return null;
          return await window.claude.use('sample');
        } catch (e) { return null; }
      })();
    }
    return samplePromise;
  }

  /* ---------- bot worker ---------- */
  let worker = null, workerReqs = new Map(), workerSeq = 0;
  function initWorker() {
    try {
      const src = $('engine-src').textContent + '\n' + $('ai-src').textContent + '\n' +
        'self.onmessage=function(e){var d=e.data;var p=new RemorseEngine.Position(d.fen);' +
        'var r=RemorseAI.chooseMove(p,d.level);self.postMessage({id:d.id,uci:r?RemorseEngine.uci(r.move):null,score:r?r.score:0,depth:r?r.depth:0});};';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = (e) => {
        const cb = workerReqs.get(e.data.id);
        workerReqs.delete(e.data.id);
        if (cb) cb(e.data);
      };
      worker.onerror = () => { worker = null; };
    } catch (e) { worker = null; }
  }
  function botMove(fen, level) {
    return new Promise((resolve) => {
      if (worker) {
        const id = ++workerSeq;
        let done = false;
        workerReqs.set(id, (d) => { done = true; resolve(d.uci); });
        worker.postMessage({ id, fen, level });
        // If the worker dies silently, fall back to the main thread.
        setTimeout(() => { if (!done) { workerReqs.delete(id); worker = null; resolve(mainThreadMove(fen, level)); } }, 12000);
      } else {
        setTimeout(() => resolve(mainThreadMove(fen, level)), 30);
      }
    });
  }
  function mainThreadMove(fen, level) {
    const r = AI.chooseMove(new E.Position(fen), level);
    return r ? uci(r.move) : null;
  }

  /* ---------- rendering ---------- */
  function squareEl(sq) { return $('board').querySelector(`[data-sq="${sq}"]`); }

  function buildBoard() {
    const board = $('board');
    board.innerHTML = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const rank = S.flipped ? row : 7 - row;
        const file = S.flipped ? 7 - col : col;
        const sq = rank * 8 + file;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sq ' + ((rank + file) % 2 ? 'light' : 'dark');
        b.dataset.sq = sq;
        b.setAttribute('role', 'gridcell');
        if (col === 0) b.insertAdjacentHTML('beforeend', `<span class="coord rank">${rank + 1}</span>`);
        if (row === 7) b.insertAdjacentHTML('beforeend', `<span class="coord file">${'abcdefgh'[file]}</span>`);
        board.appendChild(b);
      }
    }
  }

  function legalFromSelected() {
    if (S.selected < 0) return [];
    return S.game.legalMoves().filter((m) => mFrom(m) === S.selected);
  }

  function render(anim) {
    const pos = S.game.pos;
    const status = S.game.status();
    const legalSel = legalFromSelected();
    const targets = new Map(); // sq -> 'move' | 'capture' | 'castle' | 'absolve'
    for (const m of legalSel) {
      const fl = mFlags(m);
      if (fl & F_ABSOLVE) { if (mTo(m) !== mFrom(m)) targets.set(mTo(m), 'absolve'); continue; }
      targets.set(mTo(m), pos.isCapture(m) ? 'capture' : (fl & E.F_CASTLE) ? 'castle' : 'move');
    }
    const last = S.lastEntry;
    const checkSq = status.inCheck || (status.over && status.reason === 'checkmate') ? pos.kingSquare(pos.turn) : -1;
    const justGuilty = anim && last ? last.info.becameGuilty : -1;
    const justAbsolved = anim && last ? new Set(last.info.absolved) : new Set();

    for (let sq = 0; sq < 64; sq++) {
      const el = squareEl(sq);
      el.querySelectorAll('.piece,.dot,.ring,.halo').forEach((n) => n.remove());
      el.classList.toggle('sel', sq === S.selected);
      el.classList.toggle('last', !!last && (sq === mFrom(last.move) || sq === mTo(last.move)) && sq !== S.selected);
      el.classList.toggle('check', sq === checkSq);
      const p = pos.board[sq];
      let label = E.sqName(sq);
      if (p) {
        const c = E.colorOf(p), t = E.typeOf(p), guilty = E.isGuilty(p);
        const piece = document.createElement('span');
        piece.className = 'piece ' + (c === WHITE ? 'w' : 'b');
        if (guilty) piece.classList.add('guilty');
        if (sq === justGuilty) piece.classList.add('just-guilty');
        if (justAbsolved.has(sq)) piece.classList.add('just-absolved');
        piece.innerHTML = (guilty ? '<span class="token"></span>' : '') + Pieces.svg(t, c);
        el.appendChild(piece);
        label += ` ${colorName(c)} ${E.NAMES[t]}${guilty ? ', guilt-ridden' : ''}`;
      }
      const tk = targets.get(sq);
      if (tk) {
        const mark = document.createElement('span');
        mark.className = tk === 'capture' ? 'ring' : tk === 'absolve' ? 'halo' : 'dot' + (tk === 'castle' ? ' castle' : '');
        el.appendChild(mark);
        label += tk === 'absolve' ? ', can be absolved' : tk === 'capture' ? ', capture' : tk === 'castle' ? ', castle here' : ', move here';
      }
      el.setAttribute('aria-label', label);
    }

    // Slide animation for the last move.
    const slide = !S.noSlide; S.noSlide = false;
    if (slide && anim && last && !(mFlags(last.move) & F_ABSOLVE) && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const fromEl = squareEl(mFrom(last.move)), toEl = squareEl(mTo(last.move));
      const piece = toEl.querySelector('.piece');
      if (piece) {
        const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
        piece.style.transition = 'none';
        piece.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px)`;
        piece.getBoundingClientRect();
        piece.style.transition = 'transform 190ms ease-out';
        piece.style.transform = '';
      }
    }

    // Absolution buttons: absolving is an action that uses the turn.
    const absolves = isHumanTurn() && !S.thinking && !status.over ? legalSel.filter((m) => mFlags(m) & F_ABSOLVE) : [];
    const bar = $('absolve-bar');
    bar.innerHTML = '';
    for (const m of absolves) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-gold';
      btn.dataset.uci = uci(m);
      const self = mTo(m) === mFrom(m);
      btn.textContent = self ? 'Absolve this bishop' : `Absolve ${E.NAMES[E.typeOf(pos.board[mTo(m)])]} ${E.sqName(mTo(m))}`;
      bar.appendChild(btn);
    }
    if (absolves.length) bar.insertAdjacentHTML('beforeend', '<span class="hint">Uses your turn</span>');
    bar.hidden = absolves.length === 0;
    $('status').hidden = absolves.length > 0;

    renderBars(status);
    renderStatus(status);
    $('btn-undo').disabled = !canUndo();
    $('claude-note').hidden = !S.claudeNote;
    $('claude-text').textContent = S.claudeNote;
  }

  function renderBars(status) {
    const pos = S.game.pos;
    const bottomColor = S.flipped ? BLACK : WHITE;
    const topColor = bottomColor ^ 1;
    const caps = { 0: [], 1: [] }; // pieces captured BY colour
    for (const h of S.game.history) {
      if (h.info.captured) caps[E.colorOf(h.info.mover)].push(h.info.captured);
    }
    const guiltCount = [0, 0];
    for (let s = 0; s < 64; s++) {
      const p = pos.board[s];
      if (p && E.isGuilty(p)) guiltCount[E.colorOf(p)]++;
    }
    for (const [slot, color] of [['top', topColor], ['bottom', bottomColor]]) {
      $('name-' + slot).textContent = playerName(color);
      $('bar-' + slot).classList.toggle('to-move', !status.over && pos.turn === color);
      const tok = $('tokens-' + slot);
      tok.innerHTML = guiltCount[color]
        ? Array(Math.min(guiltCount[color], 8)).fill('<i class="tok"></i>').join('') + `<span>${guiltCount[color]} guilty</span>`
        : '';
      const order = [5, 4, 3, 2, 1];
      const list = caps[color].slice().sort((a, b) => order.indexOf(E.typeOf(a)) - order.indexOf(E.typeOf(b)));
      $('cap-' + slot).innerHTML = list.map((p) => Pieces.svg(E.typeOf(p), E.colorOf(p))).join('');
    }
  }

  function renderStatus(status) {
    const el = $('status');
    el.classList.remove('thinking', 'alert', 'done');
    let text;
    const pos = S.game.pos;
    if (status.over) {
      el.classList.add('done');
      text = status.reason === 'checkmate'
        ? `Checkmate. ${playerName(status.winner)} ${playerName(status.winner) === 'You' ? 'win' : 'wins'}.`
        : `Draw by ${status.reason}.`;
    } else if (S.thinking) {
      el.classList.add('thinking');
      text = S.settings.opponent === 'claude' ? 'Claude is thinking…' : `${OPP_NAMES[S.settings.opponent]} is thinking…`;
    } else {
      const who = playerName(pos.turn);
      if (status.inCheck) el.classList.add('alert');
      if (S.settings.opponent === 'human') text = `${who} to move${status.inCheck ? ', in check' : ''}`;
      else text = isHumanTurn() ? (status.inCheck ? 'You are in check' : 'Your move') : `${who} to move`;
      const sel = S.selected >= 0 ? pos.board[S.selected] : 0;
      if (sel && E.isGuilty(sel) && isHumanTurn()) {
        text = E.typeOf(sel) === E.BISHOP
          ? 'Guilt-ridden bishop: it can move, or spend a turn absolving itself.'
          : `Guilt-ridden ${E.NAMES[E.typeOf(sel)]}: it can move but not capture.`;
      }
    }
    $('status-text').textContent = text;
  }

  /* ---------- game flow ---------- */
  function commit(m) {
    S.token++;
    S.lastEntry = S.game.play(m);
    S.selected = -1;
    render(true);
    save();
    afterMove();
  }

  function afterMove() {
    const st = S.game.status();
    if (st.over) {
      const token = S.token, len = S.game.history.length;
      if (!S.overShown) setTimeout(() => {
        if (token !== S.token || len !== S.game.history.length || !S.game.status().over) return;
        showOver(S.game.status());
      }, 650);
      return;
    }
    if (!isHumanTurn()) requestAnimationFrame(() => setTimeout(opponentMove, 120));
  }

  function showOver(st) {
    S.overShown = true;
    const human = S.settings.opponent !== 'human';
    let title = st.reason === 'checkmate' ? 'Checkmate' : 'Draw';
    let text;
    if (st.reason === 'checkmate') {
      const winner = playerName(st.winner);
      if (human) {
        title = winner === 'You' ? 'Absolved and victorious' : 'Checkmate';
        text = winner === 'You' ? 'You checkmated ' + OPP_NAMES[S.settings.opponent] + '.' : OPP_NAMES[S.settings.opponent] + ' checkmated you.';
      } else text = `${winner} wins by checkmate.`;
    } else {
      text = `The game is drawn by ${st.reason}.`;
    }
    const full = Math.ceil(S.game.history.length / 2);
    text += ` ${full} move${full === 1 ? '' : 's'} played.`;
    $('over-title').textContent = title;
    $('over-text').textContent = text;
    $('sheet-over').hidden = false;
  }

  async function opponentMove() {
    if (isHumanTurn() || S.game.status().over || S.thinking) return;
    const token = ++S.token;
    S.thinking = true;
    render(false);
    const fen = S.game.pos.fen();
    const started = Date.now();
    let moveUci = null;
    if (S.settings.opponent === 'claude') {
      moveUci = await claudeMove(token);
    }
    if (token !== S.token) return;
    if (!moveUci) {
      const level = S.settings.opponent === 'claude' ? 'medium' : S.settings.opponent;
      moveUci = await botMove(fen, level);
    }
    if (token !== S.token) return;
    const wait = Math.max(0, 380 - (Date.now() - started));
    setTimeout(() => {
      if (token !== S.token) return;
      S.thinking = false;
      const m = moveUci && S.game.findMove(moveUci);
      if (m === undefined || m === null) { render(false); return; }
      commit(m);
    }, wait);
  }

  /* ---------- Claude opponent ---------- */
  function describeMove(pos, m, legal) {
    const san = pos.toSAN(m, legal);
    const notes = [];
    if (mFlags(m) & F_ABSOLVE) {
      notes.push(mTo(m) === mFrom(m) ? 'bishop spends the turn absolving itself'
        : 'bishop spends the turn absolving your ' + E.NAMES[E.typeOf(pos.board[mTo(m)])] + ' on ' + E.sqName(mTo(m)));
    } else {
      if (pos.isCapture(m)) {
        const capSq = (mFlags(m) & E.F_EP) ? (pos.turn === WHITE ? mTo(m) - 8 : mTo(m) + 8) : mTo(m);
        notes.push('captures ' + E.NAMES[E.typeOf(pos.board[capSq])] + ', your piece becomes guilt-ridden');
      }
      if (mPromo(m)) notes.push('promotes');
    }
    return `${uci(m)} = ${san}${notes.length ? ' (' + notes.join('; ') + ')' : ''}`;
  }

  function boardDiagram(pos) {
    const rows = [];
    for (let r = 7; r >= 0; r--) {
      let line = (r + 1) + ' ';
      for (let f = 0; f < 8; f++) {
        const p = pos.board[r * 8 + f];
        if (!p) { line += ' .  '; continue; }
        const ch = E.PIECE_CHARS[E.typeOf(p)];
        line += ' ' + (E.colorOf(p) === WHITE ? ch.toUpperCase() : ch) + (E.isGuilty(p) ? '* ' : '  ');
      }
      rows.push(line);
    }
    rows.push('   a   b   c   d   e   f   g   h');
    return rows.join('\n');
  }

  async function claudeMove(token) {
    const sample = await getSample();
    if (!sample) {
      S.claudeNote = 'Claude is only available when this game is opened inside Claude. The Deacon bot moved instead.';
      return null;
    }
    const pos = S.game.pos;
    const legal = pos.legalMoves();
    const me = colorName(pos.turn);
    const guilty = [[], []];
    for (let s = 0; s < 64; s++) {
      const p = pos.board[s];
      if (p && E.isGuilty(p)) guilty[E.colorOf(p)].push(E.PIECE_CHARS[E.typeOf(p)].toUpperCase() + E.sqName(s));
    }
    const hist = S.game.history.map((h, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : '') + h.san).join(' ');
    const prompt = [
      `You are playing Remorse Chess as ${me}. Play to win.`,
      '',
      'Rules: normal chess, except pieces feel guilt.',
      '- A piece that captures becomes guilt-ridden (marked *). Guilt-ridden pieces cannot capture, and so they do not give check, but they move normally.',
      '- Absolution is an action that uses a whole turn: a non-guilty bishop standing next to (8 neighbours) a guilt-ridden friendly piece may absolve that one piece instead of moving. Moving a bishop next to a guilty piece does nothing by itself.',
      '- A bishop that captures is guilt-ridden too; it cannot absolve others, but it may spend a turn absolving itself.',
      '- With no bishops, guilt is permanent until a pawn promotes to a bishop. Win by checkmate.',
      'Strategy notes: capturing with a valuable piece disarms it until a bishop reaches it, so think about which piece captures; enemy guilty pieces are harmless attackers; keep your bishops.',
      '',
      `Position (FEN, * = guilt-ridden): ${pos.fen()}`,
      boardDiagram(pos),
      `Guilt-ridden White pieces: ${guilty[0].join(', ') || 'none'}. Guilt-ridden Black pieces: ${guilty[1].join(', ') || 'none'}.`,
      pos.inCheck() ? `${me} is in check.` : '',
      `Moves so far: ${hist || '(none)'}`,
      '',
      'Your legal moves (id = notation (effects)):',
      legal.map((m) => describeMove(pos, m, legal)).join('\n'),
      '',
      'Reply with only JSON: {"move": "<one id from the list>", "comment": "<one short in-character sentence to your opponent, max 20 words>"}',
    ].filter((x) => x !== null).join('\n');

    S.claudeNote = 'Thinking about the position…';
    $('btn-claude-skip').hidden = false;
    render(false);
    const ctl = new AbortController();
    S.claudeAbort = ctl;
    try {
      const out = await sample.json(prompt, { signal: ctl.signal, cache: false });
      if (token !== S.token) return null;
      const want = out && typeof out.move === 'string' ? out.move.trim().toLowerCase() : '';
      const m = legal.find((x) => uci(x) === want);
      S.claudeNote = out && typeof out.comment === 'string' ? out.comment.slice(0, 200) : '';
      if (m === undefined) {
        S.claudeNote = `Claude suggested "${want || '?'}", which is not legal here, so the Deacon bot moved instead.`;
        return null;
      }
      return uci(m);
    } catch (e) {
      const code = e && e.code;
      if (code === 'cancelled') S.claudeNote = 'You skipped Claude this turn. The Deacon bot moved instead.';
      else if (code === 'not_granted' || code === 'sampling_disabled') S.claudeNote = 'Claude was not allowed to play, so the Deacon bot is moving. Start a new game to pick another opponent.';
      else if (code === 'rate_limited') S.claudeNote = 'Claude is rate limited right now. The Deacon bot moved instead.';
      else S.claudeNote = 'Claude could not answer this time. The Deacon bot moved instead.';
      return null;
    } finally {
      S.claudeAbort = null;
      $('btn-claude-skip').hidden = true;
    }
  }

  /* ---------- input ---------- */
  const canAct = () => !(S.thinking || S.game.status().over || !isHumanTurn() || S.pendingPromo);

  /* Legal ways to go from the selected square to `sq` (a rook square counts for castling). */
  function movesTo(sq) {
    if (S.selected < 0) return [];
    const pos = S.game.pos;
    const legal = legalFromSelected();
    const cands = legal.filter((m) => mTo(m) === sq && !(mFlags(m) & F_ABSOLVE));
    if (cands.length) return cands;
    const p = pos.board[sq];
    if (p && E.typeOf(p) === E.ROOK && E.colorOf(p) === pos.turn && E.typeOf(pos.board[S.selected]) === E.KING) {
      return legal.filter((m) => (mFlags(m) & E.F_CASTLE) && (mTo(m) > S.selected) === (sq > S.selected));
    }
    return [];
  }

  function play(cands, dropped) {
    if (cands.length > 1) { render(false); showPromo(cands); return; }
    S.noSlide = !!dropped;
    commit(cands[0]);
  }

  /* A tap on a square (also used for keyboard activation). */
  function onSquare(sq) {
    if (!canAct()) return;
    const pos = S.game.pos;
    const cands = movesTo(sq);
    if (cands.length) { play(cands, false); return; }
    const p = pos.board[sq];
    if (p && E.colorOf(p) === pos.turn && sq !== S.selected) S.selected = sq;
    else S.selected = -1;
    render(false);
  }

  /* ---------- drag and drop ---------- */
  function squareAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const b = el && el.closest ? el.closest('.sq') : null;
    return b && $('board').contains(b) ? +b.dataset.sq : -1;
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button > 0) return;
    const sq = squareAt(e.clientX, e.clientY);
    if (sq < 0) return;
    e.preventDefault();
    S.drag = null;
    if (!canAct()) return;
    const pos = S.game.pos;
    const p = pos.board[sq];
    const d = { id: e.pointerId, downSq: sq, x: e.clientX, y: e.clientY, from: -1, active: false, wasSelected: sq === S.selected, moveOnTap: false, touch: e.pointerType !== 'mouse', el: null, over: -1 };
    if (movesTo(sq).length) {
      d.moveOnTap = true; // tapping a target (or the rook, to castle)
    } else if (p && E.colorOf(p) === pos.turn) {
      S.selected = sq;
      d.from = sq;
      render(false);
    }
    S.drag = d;
    try { $('board').setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
  }

  function onPointerMove(e) {
    const d = S.drag;
    if (!d || e.pointerId !== d.id || d.from < 0) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.active) {
      if (dx * dx + dy * dy < 36) return;
      const sqEl = squareEl(d.from);
      d.el = sqEl.querySelector('.piece');
      if (!d.el) return;
      d.active = true;
      const r = sqEl.getBoundingClientRect();
      d.cx = r.left + r.width / 2; d.cy = r.top + r.height / 2;
      sqEl.classList.add('drag-from');
      d.el.classList.add('dragging');
      d.el.style.transition = 'none';
    }
    e.preventDefault();
    d.el.style.transform = `translate(${e.clientX - d.cx}px, ${e.clientY - d.cy}px) scale(${d.touch ? 1.7 : 1.15})`;
    const over = squareAt(e.clientX, e.clientY);
    if (over !== d.over) {
      if (d.over >= 0) squareEl(d.over).classList.remove('drag-over');
      if (over >= 0 && over !== d.from) squareEl(over).classList.add('drag-over');
      d.over = over;
    }
  }

  function onPointerUp(e) {
    const d = S.drag;
    if (!d || e.pointerId !== d.id) return;
    S.drag = null;
    try { $('board').releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const upSq = squareAt(e.clientX, e.clientY);
    for (const el of $('board').querySelectorAll('.drag-from,.drag-over')) el.classList.remove('drag-from', 'drag-over');
    if (d.active) {
      // Dropped a dragged piece.
      const cands = upSq >= 0 && upSq !== d.from && canAct() ? movesTo(upSq) : [];
      if (cands.length) play(cands, true);
      else render(false); // snap back, keep it selected
      return;
    }
    if (upSq !== d.downSq || !canAct()) { render(false); return; }
    if (d.moveOnTap) { const cands = movesTo(upSq); if (cands.length) play(cands, false); return; }
    if (d.from >= 0) { if (d.wasSelected) { S.selected = -1; render(false); } return; }
    S.selected = -1;
    render(false);
  }

  function onPointerCancel(e) {
    const d = S.drag;
    if (!d || e.pointerId !== d.id) return;
    S.drag = null;
    render(false);
  }

  function showPromo(cands) {
    S.pendingPromo = cands;
    const color = S.game.pos.turn === WHITE ? 'w' : 'b';
    const row = $('promo-row');
    row.innerHTML = '';
    for (const t of [E.QUEEN, E.ROOK, E.BISHOP, E.KNIGHT]) {
      const m = cands.find((x) => mPromo(x) === t);
      if (m === undefined) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', 'Promote to ' + E.NAMES[t]);
      b.innerHTML = Pieces.svg(t, color === 'w' ? 0 : 1);
      b.addEventListener('click', (e) => { e.stopPropagation(); closePromo(); commit(m); });
      row.appendChild(b);
    }
    $('promo').hidden = false;
  }

  function closePromo() {
    S.pendingPromo = null;
    $('promo').hidden = true;
  }

  function canUndo() {
    if (S.settings.opponent === 'human') return S.game.history.length > 0;
    const hc = humanColor();
    return S.game.history.some((h) => E.colorOf(h.info.mover) === hc);
  }

  function undo() {
    if (!canUndo()) return;
    closePromo();
    S.token++; // cancel any pending opponent move
    if (S.claudeAbort) S.claudeAbort.abort();
    S.thinking = false;
    S.game.undo();
    // Against a bot, undo back to the human's turn.
    if (S.settings.opponent !== 'human') {
      while (S.game.history.length && !isHumanTurn()) S.game.undo();
    }
    S.lastEntry = S.game.history[S.game.history.length - 1] || null;
    S.selected = -1;
    S.overShown = false;
    S.claudeNote = '';
    $('sheet-over').hidden = true;
    render(false);
    save();
    afterMove();
  }

  function newGame(settings) {
    S.token++;
    closePromo();
    $('sheet-over').hidden = true;
    if (S.claudeAbort) S.claudeAbort.abort();
    S.settings = settings;
    S.game = new Game();
    S.lastEntry = null;
    S.selected = -1;
    S.thinking = false;
    S.overShown = false;
    S.claudeNote = '';
    S.flipped = settings.opponent !== 'human' && settings.side === 'b';
    buildBoard();
    render(false);
    save();
    afterMove();
  }

  /* ---------- settings sheet ---------- */
  function openSettings() {
    const s = S.settings;
    const opp = document.getElementById('opp-' + s.opponent);
    if (opp && !opp.disabled) opp.checked = true; else $('opp-medium').checked = true;
    (document.getElementById('side-' + (s.chosenSide || s.side)) || $('side-w')).checked = true;
    $('sheet-settings').hidden = false;
  }
  function readSettings() {
    const opponent = (document.querySelector('input[name="opp"]:checked') || {}).value || 'medium';
    let chosenSide = (document.querySelector('input[name="side"]:checked') || {}).value || 'w';
    const side = chosenSide === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : chosenSide;
    return { opponent, side, chosenSide };
  }

  function wire() {
    const board = $('board');
    board.addEventListener('pointerdown', onPointerDown);
    board.addEventListener('pointermove', onPointerMove);
    board.addEventListener('pointerup', onPointerUp);
    board.addEventListener('pointercancel', onPointerCancel);
    board.addEventListener('contextmenu', (e) => e.preventDefault());
    // Keyboard activation only: pointer taps are handled above.
    board.addEventListener('click', (e) => {
      if (e.detail !== 0) return;
      const b = e.target.closest('.sq');
      if (b) onSquare(+b.dataset.sq);
    });
    $('absolve-bar').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-uci]');
      if (!btn || !isHumanTurn() || S.thinking) return;
      const m = S.game.findMove(btn.dataset.uci);
      if (m !== undefined) commit(m);
    });
    $('btn-undo').addEventListener('click', undo);
    $('promo').addEventListener('click', (e) => { if (!e.target.closest('button')) { closePromo(); render(false); } });
    $('btn-flip').addEventListener('click', () => { S.flipped = !S.flipped; buildBoard(); render(false); save(); });
    $('btn-rules').addEventListener('click', () => { $('sheet-rules').hidden = false; });
    $('btn-rules-close').addEventListener('click', () => { $('sheet-rules').hidden = true; try { localStorage.setItem(STORE_KEY + '-rules', '1'); } catch (e) { /* ignore */ } });
    $('btn-settings').addEventListener('click', openSettings);
    $('btn-settings-cancel').addEventListener('click', () => { $('sheet-settings').hidden = true; });
    $('btn-start').addEventListener('click', () => { $('sheet-settings').hidden = true; newGame(readSettings()); });
    $('btn-over-new').addEventListener('click', () => { $('sheet-over').hidden = true; openSettings(); });
    $('btn-over-review').addEventListener('click', () => { $('sheet-over').hidden = true; });
    $('btn-claude-skip').addEventListener('click', () => { if (S.claudeAbort) S.claudeAbort.abort(); });
    for (const id of ['sheet-settings', 'sheet-rules', 'sheet-over']) {
      $(id).addEventListener('click', (e) => { if (e.target === $(id)) $(id).hidden = true; });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && S.pendingPromo) closePromo();
      if (e.key === 'Escape') for (const id of ['sheet-settings', 'sheet-rules', 'sheet-over']) $(id).hidden = true;
    });
  }

  async function checkClaude() {
    const label = $('claude-avail');
    const input = $('opp-claude');
    const sample = await getSample();
    if (sample) {
      label.textContent = 'Uses your Claude account';
      input.disabled = false;
    } else {
      label.textContent = 'Claude.ai version only';
      input.disabled = true;
      if (S.settings.opponent === 'claude' && !isHumanTurn()) S.claudeNote = '';
    }
  }

  /* ---------- boot ---------- */
  function start(hotData) {
    initWorker();
    wire();
    let restored = false;
    if (hotData && hotData.moves) restored = restore(hotData);
    if (!restored) {
      try { restored = restore(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); } catch (e) { restored = false; }
    }
    buildBoard();
    render(false);
    $('opp-claude').disabled = true;
    checkClaude();
    let seenRules = false;
    try { seenRules = localStorage.getItem(STORE_KEY + '-rules') === '1'; } catch (e) { seenRules = false; }
    if (!restored && !seenRules) $('sheet-rules').hidden = false;
    const st = S.game.status();
    if (st.over) S.overShown = true;
    afterMove();

    // Test and debugging hook.
    window.__remorse = {
      state: () => ({ fen: S.game.pos.fen(), turn: S.game.pos.turn, status: S.game.status(), history: S.game.history.map((h) => h.san), thinking: S.thinking, human: isHumanTurn(), settings: S.settings }),
      legal: () => S.game.legalMoves().map(uci),
      absolves: () => S.game.legalMoves().filter((m) => mFlags(m) & F_ABSOLVE).map(uci),
      newGame: (opponent, side) => newGame({ opponent, side, chosenSide: side }),
    };
  }

  if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
    try { window.claude.hot.snapshot(snapshot); } catch (e) { /* ignore */ }
  }
  const boot = () => (window.claude && window.claude.hot && window.claude.hot.ready)
    ? window.claude.hot.ready(start)
    : start((window.claude && window.claude.hot && window.claude.hot.data) || {});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // Offline support when installed from a normal web host.
  if ('serviceWorker' in navigator && location.protocol === 'https:' && document.querySelector('link[rel="manifest"]')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
