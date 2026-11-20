/*
 * Remorse Chess rules engine.
 *
 * Standard chess, plus guilt:
 *  - A piece that captures becomes guilt-ridden. A guilt-ridden piece cannot
 *    capture (so it also gives no check), but still moves normally.
 *  - A bishop that ends a non-capturing move next to friendly guilt-ridden
 *    pieces (any of the 8 neighbouring squares) absolves all of them.
 *    A bishop already standing next to one may spend its turn absolving
 *    in place instead of moving.
 *  - A bishop that captures becomes guilt-ridden too, but cleanses itself:
 *    it stays guilty through its owner's next turn and is absolved when
 *    that turn ends. A guilty bishop cannot absolve others.
 *  - With no bishops left, guilt stays until a pawn promotes to a bishop.
 *  - Win by checkmate.
 *
 * Board: Uint8Array(64), index = rank * 8 + file, rank 0 is White's back rank.
 * Piece byte: type (1-6) | colour (0 white / 8 black) | GUILT (16).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RemorseEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  const BLACK_BIT = 8, GUILT = 16, TYPE_MASK = 7;
  const WHITE = 0, BLACK = 1;

  // Move flags
  const F_EP = 1, F_CASTLE = 2, F_DOUBLE = 4, F_ABSOLVE = 8;

  const encode = (from, to, promo, flags) => from | (to << 6) | ((promo || 0) << 12) | ((flags || 0) << 15);
  const mFrom = (m) => m & 63;
  const mTo = (m) => (m >> 6) & 63;
  const mPromo = (m) => (m >> 12) & 7;
  const mFlags = (m) => (m >> 15) & 15;

  const fileOf = (s) => s & 7;
  const rankOf = (s) => s >> 3;
  const colorOf = (p) => (p & BLACK_BIT ? BLACK : WHITE);
  const typeOf = (p) => p & TYPE_MASK;
  const isGuilty = (p) => (p & GUILT) !== 0;

  // Precomputed tables
  const KNIGHT_T = [], KING_T = [], RAYS = [];
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let s = 0; s < 64; s++) {
    const f = fileOf(s), r = rankOf(s);
    const kn = [], kg = [];
    for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
      const nf = f + df, nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) kn.push(nr * 8 + nf);
    }
    for (const [df, dr] of DIRS) {
      const nf = f + df, nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) kg.push(nr * 8 + nf);
    }
    KNIGHT_T.push(kn);
    KING_T.push(kg);
    const rays = [];
    for (const [df, dr] of DIRS) {
      const ray = [];
      let nf = f + df, nr = r + dr;
      while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) { ray.push(nr * 8 + nf); nf += df; nr += dr; }
      rays.push(ray);
    }
    RAYS.push(rays); // 0-3 orthogonal, 4-7 diagonal
  }

  const PIECE_CHARS = { 1: 'p', 2: 'n', 3: 'b', 4: 'r', 5: 'q', 6: 'k' };
  const CHAR_TYPES = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };
  const NAMES = { 1: 'pawn', 2: 'knight', 3: 'bishop', 4: 'rook', 5: 'queen', 6: 'king' };

  const sqName = (s) => 'abcdefgh'[fileOf(s)] + (rankOf(s) + 1);
  const sqFromName = (n) => (n.charCodeAt(1) - 49) * 8 + (n.charCodeAt(0) - 97);

  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  class Position {
    constructor(fen) {
      this.board = new Uint8Array(64);
      this.turn = WHITE;
      this.castling = 0; // 1 WK, 2 WQ, 4 BK, 8 BQ
      this.ep = -1;
      this.halfmove = 0;
      this.fullmove = 1;
      this.stack = [];
      this.load(fen || START_FEN);
    }

    /* FEN with one extension: a '*' after a piece letter marks it guilt-ridden. */
    load(fen) {
      const parts = fen.trim().split(/\s+/);
      this.board.fill(0);
      let r = 7, f = 0;
      const rows = parts[0];
      for (let i = 0; i < rows.length; i++) {
        const c = rows[i];
        if (c === '/') { r--; f = 0; continue; }
        if (c >= '1' && c <= '8') { f += +c; continue; }
        if (c === '*') { this.board[r * 8 + f - 1] |= GUILT; continue; }
        const t = CHAR_TYPES[c.toLowerCase()];
        if (!t) throw new Error('Bad FEN piece ' + c);
        this.board[r * 8 + f] = t | (c === c.toLowerCase() ? BLACK_BIT : 0);
        f++;
      }
      this.turn = parts[1] === 'b' ? BLACK : WHITE;
      this.castling = 0;
      const cs = parts[2] || '-';
      if (cs.includes('K')) this.castling |= 1;
      if (cs.includes('Q')) this.castling |= 2;
      if (cs.includes('k')) this.castling |= 4;
      if (cs.includes('q')) this.castling |= 8;
      this.ep = parts[3] && parts[3] !== '-' ? sqFromName(parts[3]) : -1;
      this.halfmove = parts[4] ? +parts[4] : 0;
      this.fullmove = parts[5] ? +parts[5] : 1;
      this.stack = [];
      return this;
    }

    fen() {
      let out = '';
      for (let r = 7; r >= 0; r--) {
        let empty = 0;
        for (let f = 0; f < 8; f++) {
          const p = this.board[r * 8 + f];
          if (!p) { empty++; continue; }
          if (empty) { out += empty; empty = 0; }
          const ch = PIECE_CHARS[typeOf(p)];
          out += colorOf(p) === WHITE ? ch.toUpperCase() : ch;
          if (isGuilty(p)) out += '*';
        }
        if (empty) out += empty;
        if (r) out += '/';
      }
      let cs = '';
      if (this.castling & 1) cs += 'K';
      if (this.castling & 2) cs += 'Q';
      if (this.castling & 4) cs += 'k';
      if (this.castling & 8) cs += 'q';
      return `${out} ${this.turn === WHITE ? 'w' : 'b'} ${cs || '-'} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.halfmove} ${this.fullmove}`;
    }

    /* Repetition key: placement + guilt + side + castling + ep. */
    key() {
      const parts = this.fen().split(' ');
      if (this.ep >= 0 && !this.legalMoves().some((m) => mFlags(m) & F_EP)) parts[3] = '-';
      return parts.slice(0, 4).join(' ');
    }

    clone() {
      const p = new Position(START_FEN);
      p.board.set(this.board);
      p.turn = this.turn; p.castling = this.castling; p.ep = this.ep;
      p.halfmove = this.halfmove; p.fullmove = this.fullmove;
      return p;
    }

    kingSquare(side) {
      const want = KING | (side === BLACK ? BLACK_BIT : 0);
      const b = this.board;
      for (let s = 0; s < 64; s++) if ((b[s] & 15) === want) return s;
      return -1;
    }

    /* Is `sq` attacked by an innocent (non-guilty) piece of colour `by`? */
    attacked(sq, by) {
      const b = this.board;
      const cb = by === BLACK ? BLACK_BIT : 0;
      const f = fileOf(sq);
      // Pawns
      if (by === WHITE) {
        if (f > 0 && sq - 9 >= 0 && b[sq - 9] === (PAWN)) return true;
        if (f < 7 && sq - 7 >= 0 && b[sq - 7] === (PAWN)) return true;
      } else {
        if (f > 0 && sq + 7 < 64 && b[sq + 7] === (PAWN | BLACK_BIT)) return true;
        if (f < 7 && sq + 9 < 64 && b[sq + 9] === (PAWN | BLACK_BIT)) return true;
      }
      // Exact equality above excludes guilty pawns (GUILT bit set).
      const kn = KNIGHT_T[sq];
      for (let i = 0; i < kn.length; i++) if (b[kn[i]] === (KNIGHT | cb)) return true;
      const kg = KING_T[sq];
      for (let i = 0; i < kg.length; i++) if (b[kg[i]] === (KING | cb)) return true;
      const rays = RAYS[sq];
      for (let d = 0; d < 8; d++) {
        const ray = rays[d];
        for (let i = 0; i < ray.length; i++) {
          const p = b[ray[i]];
          if (!p) continue;
          if (p === (QUEEN | cb) || p === ((d < 4 ? ROOK : BISHOP) | cb)) return true;
          break;
        }
      }
      return false;
    }

    inCheck(side) {
      const k = this.kingSquare(side === undefined ? this.turn : side);
      if (k < 0) return false;
      return this.attacked(k, (side === undefined ? this.turn : side) ^ 1);
    }

    /* Can the bishop on `sq` (colour side) absolve anyone adjacent? */
    hasGuiltyNeighbour(sq, side) {
      const b = this.board, kg = KING_T[sq];
      for (let i = 0; i < kg.length; i++) {
        const p = b[kg[i]];
        if (p && isGuilty(p) && colorOf(p) === side) return true;
      }
      return false;
    }

    pseudoMoves(out) {
      const b = this.board, side = this.turn;
      const moves = out || [];
      for (let s = 0; s < 64; s++) {
        const p = b[s];
        if (!p || colorOf(p) !== side) continue;
        const t = typeOf(p), guilty = isGuilty(p);
        if (t === PAWN) {
          const dir = side === WHITE ? 8 : -8;
          const startRank = side === WHITE ? 1 : 6;
          const lastRank = side === WHITE ? 7 : 0;
          const one = s + dir;
          if (one >= 0 && one < 64 && !b[one]) {
            if (rankOf(one) === lastRank) {
              for (const pr of [QUEEN, ROOK, BISHOP, KNIGHT]) moves.push(encode(s, one, pr, 0));
            } else {
              moves.push(encode(s, one, 0, 0));
              if (rankOf(s) === startRank && !b[one + dir]) moves.push(encode(s, one + dir, 0, F_DOUBLE));
            }
          }
          if (!guilty) {
            const f = fileOf(s);
            for (const df of [-1, 1]) {
              if (f + df < 0 || f + df > 7) continue;
              const to = one + df;
              if (to < 0 || to > 63) continue;
              const q = b[to];
              if (q && colorOf(q) !== side) {
                if (rankOf(to) === lastRank) {
                  for (const pr of [QUEEN, ROOK, BISHOP, KNIGHT]) moves.push(encode(s, to, pr, 0));
                } else moves.push(encode(s, to, 0, 0));
              } else if (to === this.ep && !q) {
                moves.push(encode(s, to, 0, F_EP));
              }
            }
          }
        } else if (t === KNIGHT || t === KING) {
          const tg = t === KNIGHT ? KNIGHT_T[s] : KING_T[s];
          for (let i = 0; i < tg.length; i++) {
            const to = tg[i], q = b[to];
            if (!q) moves.push(encode(s, to, 0, 0));
            else if (!guilty && colorOf(q) !== side) moves.push(encode(s, to, 0, 0));
          }
          if (t === KING) this._castles(s, side, moves);
        } else {
          const d0 = t === BISHOP ? 4 : 0, d1 = t === ROOK ? 4 : 8;
          const rays = RAYS[s];
          for (let d = d0; d < d1; d++) {
            const ray = rays[d];
            for (let i = 0; i < ray.length; i++) {
              const to = ray[i], q = b[to];
              if (!q) { moves.push(encode(s, to, 0, 0)); continue; }
              if (!guilty && colorOf(q) !== side) moves.push(encode(s, to, 0, 0));
              break;
            }
          }
          if (t === BISHOP && !guilty && this.hasGuiltyNeighbour(s, side)) {
            moves.push(encode(s, s, 0, F_ABSOLVE));
          }
        }
      }
      return moves;
    }

    _castles(s, side, moves) {
      const b = this.board, enemy = side ^ 1;
      if (side === WHITE && s === 4) {
        if ((this.castling & 1) && !b[5] && !b[6] && typeOf(b[7]) === ROOK && colorOf(b[7]) === WHITE &&
            !this.attacked(4, enemy) && !this.attacked(5, enemy) && !this.attacked(6, enemy))
          moves.push(encode(4, 6, 0, F_CASTLE));
        if ((this.castling & 2) && !b[3] && !b[2] && !b[1] && typeOf(b[0]) === ROOK && colorOf(b[0]) === WHITE &&
            !this.attacked(4, enemy) && !this.attacked(3, enemy) && !this.attacked(2, enemy))
          moves.push(encode(4, 2, 0, F_CASTLE));
      } else if (side === BLACK && s === 60) {
        if ((this.castling & 4) && !b[61] && !b[62] && typeOf(b[63]) === ROOK && colorOf(b[63]) === BLACK &&
            !this.attacked(60, enemy) && !this.attacked(61, enemy) && !this.attacked(62, enemy))
          moves.push(encode(60, 62, 0, F_CASTLE));
        if ((this.castling & 8) && !b[59] && !b[58] && !b[57] && typeOf(b[56]) === ROOK && colorOf(b[56]) === BLACK &&
            !this.attacked(60, enemy) && !this.attacked(59, enemy) && !this.attacked(58, enemy))
          moves.push(encode(60, 58, 0, F_CASTLE));
      }
    }

    _absolveAround(sq, side, changes) {
      const b = this.board, kg = KING_T[sq];
      for (let i = 0; i < kg.length; i++) {
        const n = kg[i], p = b[n];
        if (p && isGuilty(p) && colorOf(p) === side) {
          b[n] = p & ~GUILT;
          if (changes) changes.push(n);
        }
      }
    }

    /*
     * Apply a move. Returns an info object describing what happened
     * (captured piece, squares absolved, squares self-cleansed).
     */
    make(m, wantInfo) {
      const b = this.board;
      this.stack.push({ board: b.slice(), turn: this.turn, castling: this.castling, ep: this.ep, halfmove: this.halfmove, fullmove: this.fullmove });
      const side = this.turn;
      const from = mFrom(m), to = mTo(m), promo = mPromo(m), flags = mFlags(m);
      const info = wantInfo ? { captured: 0, capturedSq: -1, absolved: [], cleansed: [], becameGuilty: -1 } : null;

      // Bishops that were guilty when this turn began cleanse themselves at its end.
      let cleanse = null;
      for (let s = 0; s < 64; s++) {
        const p = b[s];
        if (p && (p & (TYPE_MASK | BLACK_BIT | GUILT)) === (BISHOP | (side === BLACK ? BLACK_BIT : 0) | GUILT)) {
          (cleanse || (cleanse = [])).push(s);
        }
      }

      let captured = 0, isPawnMove = false;
      if (flags & F_ABSOLVE) {
        this._absolveAround(from, side, info && info.absolved);
      } else {
        const p = b[from];
        isPawnMove = typeOf(p) === PAWN;
        captured = b[to];
        let capSq = to;
        if (flags & F_EP) {
          capSq = side === WHITE ? to - 8 : to + 8;
          captured = b[capSq];
          b[capSq] = 0;
        }
        b[to] = promo ? (p & ~TYPE_MASK) | promo : p;
        b[from] = 0;
        if (flags & F_CASTLE) {
          if (to === 6) { b[5] = b[7]; b[7] = 0; }
          else if (to === 2) { b[3] = b[0]; b[0] = 0; }
          else if (to === 62) { b[61] = b[63]; b[63] = 0; }
          else if (to === 58) { b[59] = b[56]; b[56] = 0; }
        }
        if (captured) {
          b[to] |= GUILT;
          if (info) { info.captured = captured; info.capturedSq = capSq; info.becameGuilty = to; }
        } else if (typeOf(b[to]) === BISHOP && !isGuilty(b[to])) {
          this._absolveAround(to, side, info && info.absolved);
        }
        // Castling rights
        if (typeOf(p) === KING) this.castling &= side === WHITE ? ~3 : ~12;
        if (from === 0 || to === 0) this.castling &= ~2;
        if (from === 7 || to === 7) this.castling &= ~1;
        if (from === 56 || to === 56) this.castling &= ~8;
        if (from === 63 || to === 63) this.castling &= ~4;
      }

      if (cleanse) {
        for (const s0 of cleanse) {
          const s = (s0 === from && !(flags & F_ABSOLVE)) ? to : s0;
          if (isGuilty(b[s]) && typeOf(b[s]) === BISHOP && colorOf(b[s]) === side) {
            b[s] &= ~GUILT;
            if (info) info.cleansed.push(s);
          }
        }
      }

      this.ep = flags & F_DOUBLE ? (from + to) >> 1 : -1;
      this.halfmove = captured || isPawnMove ? 0 : this.halfmove + 1;
      if (side === BLACK) this.fullmove++;
      this.turn = side ^ 1;
      return info;
    }

    unmake() {
      const u = this.stack.pop();
      this.board.set(u.board);
      this.turn = u.turn; this.castling = u.castling; this.ep = u.ep;
      this.halfmove = u.halfmove; this.fullmove = u.fullmove;
    }

    legalMoves() {
      const side = this.turn;
      const pseudo = this.pseudoMoves([]);
      const legal = [];
      for (const m of pseudo) {
        this.make(m);
        if (!this.inCheck(side)) legal.push(m);
        this.unmake();
      }
      return legal;
    }

    isCapture(m) {
      if (mFlags(m) & F_EP) return true;
      if (mFlags(m) & F_ABSOLVE) return false;
      return this.board[mTo(m)] !== 0;
    }

    /* Squares that would be absolved by this move (before making it). */
    absolvesBy(m) {
      const side = this.turn;
      const info = this.make(m, true);
      this.unmake();
      void side;
      return info.absolved;
    }

    insufficientMaterial() {
      let minors = 0, knights = 0;
      const bishopColors = new Set();
      for (let s = 0; s < 64; s++) {
        const t = typeOf(this.board[s]);
        if (t === PAWN || t === ROOK || t === QUEEN) return false;
        if (t === KNIGHT) { minors++; knights++; }
        if (t === BISHOP) { minors++; bishopColors.add((fileOf(s) + rankOf(s)) & 1); }
      }
      if (minors <= 1) return true;
      // Only bishops, all on squares of one colour: mate is impossible.
      return knights === 0 && bishopColors.size === 1;
    }

    /*
     * Dead by guilt: no pawns, no bishops, and every piece except the kings is
     * guilt-ridden. Nothing can ever be absolved, so nobody can give check again.
     */
    deadByGuilt() {
      for (let s = 0; s < 64; s++) {
        const p = this.board[s];
        if (!p) continue;
        const t = typeOf(p);
        if (t === PAWN || t === BISHOP) return false;
        if (t !== KING && !isGuilty(p)) return false;
      }
      return true;
    }

    toSAN(m, legal) {
      legal = legal || this.legalMoves();
      const from = mFrom(m), to = mTo(m), flags = mFlags(m), promo = mPromo(m);
      const p = this.board[from], t = typeOf(p);
      let san;
      if (flags & F_ABSOLVE) {
        san = 'B' + sqName(from) + '~';
      } else if (flags & F_CASTLE) {
        san = fileOf(to) === 6 ? 'O-O' : 'O-O-O';
      } else {
        const cap = this.isCapture(m);
        if (t === PAWN) {
          san = (cap ? 'abcdefgh'[fileOf(from)] + 'x' : '') + sqName(to);
          if (promo) san += '=' + PIECE_CHARS[promo].toUpperCase();
        } else {
          const letter = PIECE_CHARS[t].toUpperCase();
          let dis = '';
          const others = legal.filter((o) => o !== m && mTo(o) === to && !(mFlags(o) & F_ABSOLVE) &&
            mFrom(o) !== from && typeOf(this.board[mFrom(o)]) === t);
          if (others.length) {
            const sameFile = others.some((o) => fileOf(mFrom(o)) === fileOf(from));
            const sameRank = others.some((o) => rankOf(mFrom(o)) === rankOf(from));
            if (!sameFile) dis = 'abcdefgh'[fileOf(from)];
            else if (!sameRank) dis = String(rankOf(from) + 1);
            else dis = sqName(from);
          }
          san = letter + dis + (cap ? 'x' : '') + sqName(to);
        }
      }
      this.make(m);
      const check = this.inCheck();
      const mate = check && this.legalMoves().length === 0;
      this.unmake();
      return san + (mate ? '#' : check ? '+' : '');
    }
  }

  const uci = (m) => (mFlags(m) & F_ABSOLVE)
    ? sqName(mFrom(m)) + sqName(mFrom(m))
    : sqName(mFrom(m)) + sqName(mTo(m)) + (mPromo(m) ? PIECE_CHARS[mPromo(m)] : '');

  /*
   * Game: a Position plus history, SAN log and result detection.
   */
  class Game {
    constructor(fen) {
      this.pos = new Position(fen);
      this.startFen = fen || START_FEN;
      this.history = []; // {move, san, info, key}
      this.keys = [this.pos.key()];
    }

    legalMoves() { return this.pos.legalMoves(); }

    findMove(uciStr) {
      const want = uciStr.trim().toLowerCase();
      return this.legalMoves().find((m) => uci(m) === want);
    }

    play(m) {
      const legal = this.legalMoves();
      if (!legal.includes(m)) throw new Error('Illegal move ' + uci(m));
      const san = this.pos.toSAN(m, legal);
      const mover = this.pos.board[mFrom(m)];
      const info = this.pos.make(m, true);
      info.mover = mover;
      this.pos.stack.length = 0; // history lives in Game, not Position
      const key = this.pos.key();
      this.keys.push(key);
      const entry = { move: m, uci: uci(m), san, info, fen: this.pos.fen() };
      this.history.push(entry);
      return entry;
    }

    undo() {
      if (!this.history.length) return false;
      this.history.pop();
      this.keys.pop();
      const fen = this.history.length ? this.history[this.history.length - 1].fen : this.startFen;
      this.pos.load(fen);
      return true;
    }

    /* {over, result: '1-0'|'0-1'|'1/2-1/2', reason} */
    status() {
      const legal = this.legalMoves();
      if (legal.length === 0) {
        if (this.pos.inCheck()) {
          return { over: true, result: this.pos.turn === WHITE ? '0-1' : '1-0', reason: 'checkmate', winner: this.pos.turn ^ 1 };
        }
        return { over: true, result: '1/2-1/2', reason: 'stalemate' };
      }
      if (this.pos.halfmove >= 100) return { over: true, result: '1/2-1/2', reason: 'fifty-move rule' };
      const k = this.keys[this.keys.length - 1];
      let reps = 0;
      for (const x of this.keys) if (x === k) reps++;
      if (reps >= 3) return { over: true, result: '1/2-1/2', reason: 'threefold repetition' };
      if (this.pos.insufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'insufficient material' };
      if (this.pos.deadByGuilt()) return { over: true, result: '1/2-1/2', reason: 'remorse (no piece can ever capture again)' };
      return { over: false, inCheck: this.pos.inCheck() };
    }
  }

  return {
    PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, BLACK_BIT, GUILT, TYPE_MASK, WHITE, BLACK,
    F_EP, F_CASTLE, F_DOUBLE, F_ABSOLVE, START_FEN, NAMES, PIECE_CHARS, KING_T,
    encode, mFrom, mTo, mPromo, mFlags, fileOf, rankOf, colorOf, typeOf, isGuilty,
    sqName, sqFromName, uci, Position, Game,
  };
});
