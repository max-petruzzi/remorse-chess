'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

const { Position, Game, uci } = E;

function perft(pos, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of pos.legalMoves()) {
    pos.make(m);
    n += perft(pos, depth - 1);
    pos.unmake();
  }
  return n;
}

const moves = (fen) => new Position(fen).legalMoves().map(uci).sort();
const has = (fen, u) => moves(fen).includes(u);
function playAll(fen, list) {
  const g = new Game(fen);
  for (const u of list) {
    const m = g.findMove(u);
    assert.ok(m !== undefined, `move ${u} should be legal in ${g.pos.fen()}; legal: ${g.legalMoves().map(uci).join(' ')}`);
    g.play(m);
  }
  return g;
}

test('standard chess move generation (perft) from the start', () => {
  const p = new Position();
  assert.equal(perft(p, 1), 20);
  assert.equal(perft(p, 2), 400);
  assert.equal(perft(p, 3), 8902);
});

test('kiwipete depth 1 matches standard chess (castling, ep, promotions)', () => {
  const p = new Position('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  assert.equal(perft(p, 1), 48);
  const p3 = new Position('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
  assert.equal(perft(p3, 1), 14);
  // Depth 2 legitimately differs from standard chess (191): after a capture the
  // capturing piece is guilty and no longer gives check.
});

test('FEN round trip keeps guilt markers', () => {
  const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4N*3/4P3/8/PPPP1PPP/RNBQKB1R b KQkq - 0 4';
  assert.equal(new Position(fen).fen(), fen);
});

test('a capturing piece becomes guilt-ridden', () => {
  const g = playAll(undefined, ['e2e4', 'd7d5', 'e4d5']);
  const p = g.pos.board[E.sqFromName('d5')];
  assert.ok(E.isGuilty(p));
  assert.equal(E.typeOf(p), E.PAWN);
  assert.equal(g.history[2].san, 'exd5');
});

test('a guilt-ridden piece cannot capture but still moves', () => {
  // White knight on e5 is guilty; black pawns on d7 and f7 are in reach.
  const fen = '4k3/3p1p2/8/4N*3/8/8/8/4K3 w - - 0 1';
  assert.ok(!has(fen, 'e5d7'));
  assert.ok(!has(fen, 'e5f7'));
  assert.ok(has(fen, 'e5c6'));
  assert.ok(has(fen, 'e5g4'));
  // Innocent knight can capture.
  assert.ok(has(fen.replace('N*', 'N'), 'e5d7'));
});

test('guilty pawns cannot capture diagonally or en passant', () => {
  assert.ok(!has('4k3/8/8/8/8/3p4/4P*3/4K3 w - - 0 1', 'e2d3'));
  assert.ok(has('4k3/8/8/8/8/3p4/4P*3/4K3 w - - 0 1', 'e2e3'));
  // En passant: black just played d7d5, white pawn on e5.
  assert.ok(has('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5d6'));
  assert.ok(!has('4k3/8/8/3pP*3/8/8/8/4K3 w - d6 0 1', 'e5d6'));
});

test('guilt-ridden pieces give no check, so the enemy king may walk into their lines', () => {
  // Guilty white rook on a1 "attacks" the a-file; black king may step onto it.
  const fen = '8/8/8/8/8/1k6/8/R*3K3 b - - 0 1';
  assert.ok(new Position(fen).inCheck(E.BLACK) === false);
  assert.ok(has(fen, 'b3a3'));
  assert.ok(has(fen, 'b3a2'));
  // Innocent rook: those squares are forbidden.
  assert.ok(!has(fen.replace('R*', 'R'), 'b3a3'));
});

test('a guilty king cannot capture an undefended attacker', () => {
  // Black queen on e2 checks the white king on e1; the white king is guilty.
  const fen = '4k3/8/8/8/8/8/4q3/4K*3 w - - 0 1';
  const legal = moves(fen);
  assert.ok(!legal.includes('e1e2'));
  // No other way out: d1/f1/d2/f2 are covered by the queen -> checkmate.
  const g = new Game(fen);
  assert.equal(g.status().reason, 'checkmate');
  assert.equal(g.status().result, '0-1');
  // Innocent king just takes the queen.
  assert.ok(has('4k3/8/8/8/8/8/4q3/4K3 w - - 0 1', 'e1e2'));
});

test('moving a bishop next to a guilty piece does not absolve by itself', () => {
  const g = playAll('4k3/8/8/8/3N*4/8/8/2B1K3 w - - 0 1', ['c1e3']);
  assert.ok(E.isGuilty(g.pos.board[E.sqFromName('d4')]), 'still guilty after the bishop arrives');
  assert.deepEqual(g.history[0].info.absolved, []);
});

test('a bishop next to a guilty friend can spend a turn absolving it', () => {
  const fen = '4k3/8/8/8/3N*4/2B5/8/4K3 w - - 0 1';
  assert.ok(has(fen, 'c3d4'));
  const g = playAll(fen, ['c3d4']);
  assert.ok(!E.isGuilty(g.pos.board[E.sqFromName('d4')]));
  assert.equal(E.typeOf(g.pos.board[E.sqFromName('c3')]), E.BISHOP, 'the bishop stays where it was');
  assert.equal(E.typeOf(g.pos.board[E.sqFromName('d4')]), E.KNIGHT);
  assert.equal(g.pos.turn, E.BLACK, 'absolving uses the turn');
  assert.equal(g.history[0].san, 'Bc3~d4');
  assert.deepEqual(g.history[0].info.absolved, [E.sqFromName('d4')]);
  // Not offered when the neighbour is innocent, or not adjacent.
  assert.ok(!has('4k3/8/8/8/3N4/2B5/8/4K3 w - - 0 1', 'c3d4'));
  assert.ok(!moves('4k3/8/8/3N*4/8/2B5/8/4K3 w - - 0 1').includes('c3d5'));
});

test('one absolution forgives one piece, and never an enemy piece', () => {
  // Bishop d4 touches guilty white knights on c5 and e5 and a guilty black knight on d5.
  const fen = '4k3/8/8/2N*n*N*3/3B4/8/8/4K3 w - - 0 1';
  const legal = moves(fen);
  assert.ok(legal.includes('d4c5') && legal.includes('d4e5'));
  assert.ok(!legal.includes('d4d5'), 'cannot absolve (or capture) the enemy knight this way... it is a capture');
  const g = playAll(fen, ['d4c5']);
  assert.ok(!E.isGuilty(g.pos.board[E.sqFromName('c5')]));
  assert.ok(E.isGuilty(g.pos.board[E.sqFromName('e5')]), 'the other knight needs its own turn');
  assert.ok(E.isGuilty(g.pos.board[E.sqFromName('d5')]));
});

test('a bishop that captures is guilty until it spends a turn absolving itself', () => {
  const g = playAll('4k3/6p1/7p/8/8/8/P7/2B1K3 w - - 0 1', ['c1h6', 'e8d7']);
  const h6 = E.sqFromName('h6');
  assert.ok(E.isGuilty(g.pos.board[h6]));
  let legal = g.legalMoves().map(uci);
  assert.ok(!legal.includes('h6g7'), 'guilty bishop cannot capture');
  assert.ok(legal.includes('h6h6'), 'it can absolve itself');
  g.play(g.findMove('a2a3'));
  g.play(g.findMove('d7d6'));
  assert.ok(E.isGuilty(g.pos.board[h6]), 'guilt does not wear off on its own');
  g.play(g.findMove('h6h6'));
  assert.ok(!E.isGuilty(g.pos.board[h6]));
  assert.equal(g.history[4].san, 'Bh6~');
  g.play(g.findMove('d6d5'));
  assert.ok(g.legalMoves().map(uci).includes('h6g7'), 'clean again, so it can capture');
});

test('a guilty bishop cannot absolve others', () => {
  const fen = '4k3/8/8/8/3N*4/2B*5/8/4K3 w - - 0 1';
  const legal = moves(fen);
  assert.ok(!legal.includes('c3d4'));
  assert.ok(legal.includes('c3c3'));
});

test('absolving is not allowed while it leaves the king in check', () => {
  const fen = '4k3/8/8/8/3N*4/2B5/8/r3K3 w - - 0 1';
  assert.ok(!has(fen, 'c3d4'));
});

test('promotion carries guilt; a pawn promoting with a capture becomes guilty', () => {
  const g = playAll('1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1', ['a7b8q']);
  const p = g.pos.board[E.sqFromName('b8')];
  assert.equal(E.typeOf(p), E.QUEEN);
  assert.ok(E.isGuilty(p));
});

test('with no bishops, guilt stays until a pawn promotes to a bishop', () => {
  const start = '4k3/PN*6/8/8/8/8/8/4K3 w - - 0 1';
  assert.ok(!moves(start).some((u) => u.endsWith('b7') && u !== 'a7b7'), 'nobody can absolve the knight yet');
  const g = playAll(start, ['a7a8b', 'e8d7']);
  assert.ok(E.isGuilty(g.pos.board[E.sqFromName('b7')]), 'promotion alone does not absolve');
  assert.ok(g.legalMoves().map(uci).includes('a8b7'), 'the new bishop can absolve next turn');
  g.play(g.findMove('a8b7'));
  assert.ok(!E.isGuilty(g.pos.board[E.sqFromName('b7')]));
});

test('discovered check from an innocent piece still counts', () => {
  // White rook a1, white guilty knight on a4 blocks; knight moves away -> check on a8 king.
  const g = playAll('k7/8/8/8/N*7/8/8/R3K3 w - - 0 1', ['a4c5']);
  assert.ok(g.pos.inCheck());
  assert.ok(g.history[0].san.endsWith('+'));
});

test('a capture never delivers check from the capturing piece itself', () => {
  // Qxf7 would normally be check; the queen is now guilty, so it is not.
  const g = playAll('4k3/5p2/8/8/8/8/8/4K2Q w - - 0 1', ['h1h5', 'e8d8', 'h5f7']);
  assert.ok(!g.pos.inCheck());
});

test('castling works and is not blocked by guilty attackers', () => {
  // Guilty black rook on f8 eyes f1, which would normally stop O-O.
  assert.ok(has('4kr*2/8/8/8/8/8/8/4K2R w K - 0 1', 'e1g1'));
  assert.ok(!has('4kr2/8/8/8/8/8/8/4K2R w K - 0 1', 'e1g1'));
  const g = playAll('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1', ['e1c1']);
  assert.equal(E.typeOf(g.pos.board[E.sqFromName('d1')]), E.ROOK);
  assert.equal(g.history[0].san, 'O-O-O');
});

test('game results: stalemate, fifty-move, repetition, insufficient material', () => {
  assert.equal(new Game('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').status().reason, 'stalemate');
  assert.equal(new Game('4k3/8/8/8/8/8/8/R3K3 w - - 100 80').status().reason, 'fifty-move rule');
  assert.equal(new Game('4k3/8/8/8/8/8/8/4KN2 w - - 0 1').status().reason, 'insufficient material');
  const g = playAll('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', ['a1a2', 'e8d8', 'a2a1', 'd8e8', 'a1a2', 'e8d8', 'a2a1', 'd8e8']);
  assert.equal(g.status().reason, 'threefold repetition');
});

test('undo restores the exact previous position, guilt included', () => {
  const g = playAll(undefined, ['e2e4', 'd7d5', 'e4d5']);
  const before = g.history[1].fen;
  g.undo();
  assert.equal(g.pos.fen(), before);
  assert.equal(g.history.length, 2);
});

test('random self-play keeps invariants (kings present, make/unmake symmetric)', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let games = 0, totalPlies = 0, absolutions = 0, guiltyCaptures = 0;
  for (; games < 60; games++) {
    const g = new Game();
    for (let ply = 0; ply < 300; ply++) {
      const st = g.status();
      if (st.over) break;
      const legal = g.legalMoves();
      const before = g.pos.fen();
      for (const m of legal) {
        g.pos.make(m);
        g.pos.unmake();
        assert.equal(g.pos.fen(), before);
        // Guilty pieces never capture.
        if (g.pos.isCapture(m)) assert.ok(!E.isGuilty(g.pos.board[E.mFrom(m)]));
      }
      const m = legal[Math.floor(rnd() * legal.length)];
      const e = g.play(m);
      if (e.info.absolved.length) absolutions++;
      assert.equal(e.info.absolved.length > 0, (E.mFlags(m) & E.F_ABSOLVE) !== 0);
      if (e.info.captured) guiltyCaptures++;
      assert.ok(g.pos.kingSquare(E.WHITE) >= 0 && g.pos.kingSquare(E.BLACK) >= 0);
      assert.ok(!g.pos.inCheck(g.pos.turn ^ 1), 'side that just moved is never left in check');
      totalPlies++;
    }
  }
  assert.ok(totalPlies > 1000);
  assert.ok(absolutions > 0, 'absolution happens in random play');
  assert.ok(guiltyCaptures > 0);
});

test('dead positions caused by permanent guilt are drawn', () => {
  assert.match(new Game('k7/8/8/8/8/8/8/KQ*6 w - - 0 1').status().reason, /remorse/);
  assert.match(new Game('k7/8/8/8/8/8/8/KR*R*5 w - - 0 1').status().reason, /remorse/);
  assert.equal(new Game('k7/8/8/8/8/8/8/KQ6 w - - 0 1').status().over, false, 'innocent queen can still mate');
  assert.equal(new Game('k7/8/8/8/8/8/1B6/KQ*6 w - - 0 1').status().over, false, 'a bishop could still absolve');
});

test('same-coloured bishops only is insufficient material', () => {
  assert.equal(new Game('k7/8/8/8/8/8/b7/KB6 w - - 0 1').status().reason, 'insufficient material');
  assert.equal(new Game('k7/8/8/8/8/8/1b6/KB6 w - - 0 1').status().over, false);
});

test('repetition ignores an en passant square when no en passant capture is possible', () => {
  const g = playAll(undefined, ['e2e4', 'g8f6', 'g1f3', 'f6g8', 'f3g1', 'g8f6', 'g1f3', 'f6g8', 'f3g1']);
  assert.equal(g.status().reason, 'threefold repetition');
});
