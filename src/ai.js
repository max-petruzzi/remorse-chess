/*
 * Remorse Chess bot: alpha-beta search with iterative deepening, quiescence on
 * captures, and an evaluation that understands guilt.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.RemorseAI = factory(root.RemorseEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, GUILT, BLACK_BIT, WHITE, BLACK, F_ABSOLVE } = E;
  const VALUE = [0, 100, 315, 345, 500, 920, 0];
  const MATE = 100000;

  // Piece-square tables from White's point of view, index = rank * 8 + file.
  const PST = {
    [PAWN]: [
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, -20, -20, 10, 10, 5,
      5, -5, -10, 0, 0, -10, -5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, 5, 10, 25, 25, 10, 5, 5,
      10, 10, 20, 30, 30, 20, 10, 10,
      50, 50, 50, 50, 50, 50, 50, 50,
      0, 0, 0, 0, 0, 0, 0, 0],
    [KNIGHT]: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50],
    [BISHOP]: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -20, -10, -10, -10, -10, -10, -10, -20],
    [ROOK]: [
      0, 0, 0, 5, 5, 0, 0, 0,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      5, 10, 10, 10, 10, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0],
    [QUEEN]: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -10, 5, 5, 5, 5, 5, 0, -10,
      0, 0, 5, 5, 5, 5, 0, -5,
      -5, 0, 5, 5, 5, 5, 0, -5,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20],
    [KING]: [
      20, 30, 10, 0, 0, 10, 30, 20,
      20, 20, 0, 0, 0, 0, 20, 20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30],
  };
  const KING_END = [
    -50, -30, -30, -30, -30, -30, -30, -50,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -50, -40, -30, -20, -20, -30, -40, -50];

  /* Static evaluation, positive = good for the side to move. */
  function evaluate(pos) {
    const b = pos.board;
    let score = [0, 0];
    const bishops = [0, 0], innocentBishops = [0, 0], nonPawn = [0, 0];
    const guiltySq = [[], []];
    const kings = [-1, -1];
    for (let s = 0; s < 64; s++) {
      const p = b[s];
      if (!p) continue;
      const t = p & 7, c = p & BLACK_BIT ? 1 : 0;
      if (t === BISHOP) { bishops[c]++; if (!(p & GUILT)) innocentBishops[c]++; }
      if (t !== PAWN && t !== KING) nonPawn[c] += VALUE[t];
      if (t === KING) kings[c] = s;
      if (p & GUILT) guiltySq[c].push(s);
    }
    const endgame = nonPawn[0] + nonPawn[1] <= 2600;
    for (let s = 0; s < 64; s++) {
      const p = b[s];
      if (!p) continue;
      const t = p & 7, c = p & BLACK_BIT ? 1 : 0;
      const idx = c === WHITE ? s : (7 - (s >> 3)) * 8 + (s & 7);
      let v = VALUE[t] + (t === KING && endgame ? KING_END[idx] : PST[t][idx]);
      if (p & GUILT) {
        if (t === KING) v -= 40;
        else if (t === BISHOP) v -= 15; // cleanses itself next turn
        else {
          // A guilty piece is a pacifist until a bishop gets to it.
          const redeemable = innocentBishops[c] > 0 || bishops[c] > 0;
          const factor = redeemable ? (t === PAWN ? 0.15 : 0.18) : (t === PAWN ? 0.3 : 0.4);
          v -= VALUE[t] * factor;
        }
      }
      score[c] += v;
    }
    // Bishops are the only cure for guilt: reward keeping one, and reward
    // bishops that are close to guilty friends.
    for (let c = 0; c < 2; c++) {
      if (bishops[c] > 0) score[c] += 30;
      if (bishops[c] > 1) score[c] += 20;
      if (guiltySq[c].length && innocentBishops[c]) {
        for (let s = 0; s < 64; s++) {
          const p = b[s];
          if (!p || (p & 7) !== BISHOP || (p & GUILT) || (p & BLACK_BIT ? 1 : 0) !== c) continue;
          let best = 8;
          for (const g of guiltySq[c]) {
            const d = Math.max(Math.abs((g & 7) - (s & 7)), Math.abs((g >> 3) - (s >> 3)));
            if (d < best) best = d;
          }
          score[c] += (8 - best) * 3;
        }
      }
    }
    const us = pos.turn;
    return score[us] - score[us ^ 1];
  }

  function moveOrderScore(pos, m, killers, ply) {
    const b = pos.board;
    const from = E.mFrom(m), to = E.mTo(m), fl = E.mFlags(m);
    if (fl & F_ABSOLVE) return 600;
    let s = 0;
    const victim = b[to];
    if (victim) s += 10000 + VALUE[victim & 7] * 10 - VALUE[b[from] & 7] / 10;
    else if (fl & E.F_EP) s += 10000 + 1000;
    if (E.mPromo(m)) s += 9000 + VALUE[E.mPromo(m)];
    if (killers && (killers[ply * 2] === m || killers[ply * 2 + 1] === m)) s += 5000;
    return s;
  }

  class Searcher {
    constructor(opts) {
      this.deadline = Infinity;
      this.nodes = 0;
      this.killers = new Int32Array(256);
      this.stopped = false;
      this.rand = (opts && opts.rand) || Math.random;
    }

    timeUp() {
      if ((++this.nodes & 1023) === 0 && Date.now() > this.deadline) this.stopped = true;
      return this.stopped;
    }

    ordered(pos, moves, ply, pvMove) {
      const scored = moves.map((m) => [m === pvMove ? 1e9 : moveOrderScore(pos, m, this.killers, ply), m]);
      scored.sort((a, b) => b[0] - a[0]);
      return scored.map((x) => x[1]);
    }

    quiesce(pos, alpha, beta, ply) {
      if (this.timeUp()) return 0;
      const stand = evaluate(pos);
      if (stand >= beta) return beta;
      if (stand > alpha) alpha = stand;
      if (ply > 30) return alpha;
      const side = pos.turn;
      const caps = pos.pseudoMoves([]).filter((m) => pos.isCapture(m) || E.mPromo(m) === QUEEN);
      for (const m of this.ordered(pos, caps, ply, -1)) {
        pos.make(m);
        if (pos.inCheck(side)) { pos.unmake(); continue; }
        const score = -this.quiesce(pos, -beta, -alpha, ply + 1);
        pos.unmake();
        if (this.stopped) return 0;
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
      }
      return alpha;
    }

    negamax(pos, depth, alpha, beta, ply) {
      if (this.timeUp()) return 0;
      const side = pos.turn;
      const inCheck = pos.inCheck(side);
      if (depth <= 0 && !inCheck) return this.quiesce(pos, alpha, beta, ply);
      if (pos.halfmove >= 100) return 0;
      const moves = this.ordered(pos, pos.pseudoMoves([]), ply, -1);
      let legal = 0, best = -Infinity;
      for (const m of moves) {
        pos.make(m);
        if (pos.inCheck(side)) { pos.unmake(); continue; }
        legal++;
        const score = -this.negamax(pos, depth - 1, -beta, -alpha, ply + 1);
        pos.unmake();
        if (this.stopped) return 0;
        if (score > best) best = score;
        if (score > alpha) alpha = score;
        if (alpha >= beta) {
          if (!pos.isCapture(m)) {
            this.killers[ply * 2 + 1] = this.killers[ply * 2];
            this.killers[ply * 2] = m;
          }
          break;
        }
      }
      if (!legal) return inCheck ? -MATE + ply : 0;
      return best;
    }

  }

  /*
   * Pick a move.
   * level: 'easy' | 'medium' | 'hard'
   * Returns {move, score, depth, nodes}.
   */
  function chooseMove(pos, level, opts) {
    opts = opts || {};
    const rand = opts.rand || Math.random;
    const cfg = {
      easy: { maxDepth: 2, ms: 250, noise: 140, blunder: 0.2 },
      medium: { maxDepth: 3, ms: 700, noise: 25, blunder: 0 },
      hard: { maxDepth: 64, ms: opts.ms || 1600, noise: 0, blunder: 0 },
    }[level || 'medium'];
    const work = pos.clone();
    const legal = work.legalMoves();
    if (!legal.length) return null;
    if (legal.length === 1) return { move: legal[0], score: 0, depth: 0, nodes: 0 };
    if (cfg.blunder && rand() < cfg.blunder) {
      return { move: legal[Math.floor(rand() * legal.length)], score: 0, depth: 0, nodes: 0 };
    }

    const s = new Searcher({ rand });
    s.deadline = Date.now() + cfg.ms;
    let order = legal.slice();
    let bestResults = null, depthDone = 0;
    for (let depth = 1; depth <= cfg.maxDepth; depth++) {
      // Full-window root so every move gets an exact score (needed for noise).
      const results = [];
      let aborted = false, alpha = -Infinity;
      for (const m of order) {
        work.make(m);
        // Without noise only the best move matters, so prune with alpha.
        const score = -s.negamax(work, depth - 1, -Infinity, cfg.noise ? Infinity : -alpha, 1);
        if (score > alpha) alpha = score;
        work.unmake();
        if (s.stopped) { aborted = true; break; }
        results.push({ move: m, score });
      }
      if (aborted && depth > 1) break;
      if (aborted) { // depth 1 never finished: score what we have
        if (results.length) bestResults = results;
        break;
      }
      results.sort((a, b) => b.score - a.score);
      bestResults = results;
      depthDone = depth;
      order = results.map((r) => r.move);
      if (results[0].score > MATE - 1000) break; // found a mate
      if (depth >= 2 && Date.now() > s.deadline - cfg.ms * 0.4 && cfg.maxDepth > 3) break;
    }
    if (!bestResults || !bestResults.length) {
      return { move: legal[0], score: 0, depth: 0, nodes: s.nodes };
    }
    let pick = bestResults[0];
    if (cfg.noise) {
      let bestNoisy = -Infinity;
      for (const r of bestResults) {
        if (r.score > MATE - 1000) { pick = r; break; }
        const v = r.score + (rand() * 2 - 1) * cfg.noise;
        if (v > bestNoisy) { bestNoisy = v; pick = r; }
      }
    }
    return { move: pick.move, score: pick.score, depth: depthDone, nodes: s.nodes };
  }

  return { chooseMove, evaluate, MATE, VALUE };
});
