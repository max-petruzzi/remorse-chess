#!/usr/bin/env node
/*
 * End-to-end playthrough at phone size. Plays full games by tapping squares
 * like a person would, against the bot, and checks after every move that:
 *  - no console errors happened
 *  - the guilt tokens drawn on the board match the engine's position
 *  - the game ends with the result sheet shown
 * Usage: node test/e2e.js [url] [games]
 */
'use strict';
const { chromium, devices } = require('playwright');
const assert = require('assert');

const URL = process.argv[2] || 'http://localhost:8765/';
const GAMES = +(process.argv[3] || 3);

function rng(seed) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

async function waitHumanTurn(page) {
  await page.waitForFunction(() => {
    const s = window.__remorse.state();
    return s.status.over || (s.human && !s.thinking);
  }, null, { timeout: 30000 });
}

async function domGuilt(page) {
  return page.evaluate(() => [...document.querySelectorAll('.sq')]
    .filter((sq) => sq.querySelector('.piece.guilty'))
    .map((sq) => +sq.dataset.sq).sort((a, b) => a - b));
}

function fenGuilt(fen) {
  const out = [];
  const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, i) => {
    const r = 7 - i;
    let f = 0;
    for (const c of row) {
      if (c >= '1' && c <= '8') f += +c;
      else if (c === '*') out.push(r * 8 + f - 1);
      else f++;
    }
  });
  return out.sort((a, b) => a - b);
}

async function tapMove(page, u, absolve) {
  const sq = (n) => (n.charCodeAt(1) - 49) * 8 + (n.charCodeAt(0) - 97);
  const from = sq(u.slice(0, 2)), to = sq(u.slice(2, 4));
  await page.click(`[data-sq="${from}"]`);
  if (absolve) {
    // Absolving is a button press that uses the turn.
    await page.click(`#absolve-bar button[data-uci="${u}"]`);
    return;
  }
  await page.click(`[data-sq="${to}"]`);
  if (u.length === 5) {
    const name = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[u[4]];
    await page.click(`#promo-row button[aria-label="Promote to ${name}"]`);
  }
}

async function playGame(page, opts, rand) {
  await page.evaluate(({ opponent, side }) => window.__remorse.newGame(opponent, side), opts);
  let plies = 0, sawGuilt = false, sawAbsolve = false;
  for (;;) {
    await waitHumanTurn(page);
    const st = await page.evaluate(() => window.__remorse.state());
    const dom = await domGuilt(page);
    assert.deepStrictEqual(dom, fenGuilt(st.fen), 'drawn guilt tokens match the position: ' + st.fen);
    if (dom.length) sawGuilt = true;
    if (st.history.some((h) => h.includes('~'))) sawAbsolve = true;
    if (st.status.over) return { st, plies, sawGuilt, sawAbsolve };
    if (plies >= opts.maxPlies) return { st, plies, sawGuilt, sawAbsolve, cut: true };
    const legal = await page.evaluate(() => window.__remorse.legal());
    // Prefer absolutions when available so the variant rules get exercised.
    const absolves = await page.evaluate(() => window.__remorse.absolves());
    const useAbsolve = absolves.length > 0 && rand() < 0.5;
    const pick = useAbsolve ? absolves[Math.floor(rand() * absolves.length)] : legal[Math.floor(rand() * legal.length)];
    const isAbsolve = absolves.includes(pick);
    const before = st.history.length;
    await tapMove(page, pick, isAbsolve);
    await page.waitForFunction((n) => window.__remorse.state().history.length > n, before, { timeout: 5000 });
    plies++;
  }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.waitForFunction(() => window.__remorse);
  if (await page.isVisible('#btn-rules-close')) await page.click('#btn-rules-close');

  const scroll = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: window.innerHeight, sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(scroll.sh <= scroll.ih + 1 && scroll.sw <= scroll.iw, 'the game fits one screen with no page scrolling: ' + JSON.stringify(scroll));

  const rand = rng(7);
  const configs = [
    { opponent: 'easy', side: 'w', maxPlies: 400 },
    { opponent: 'easy', side: 'b', maxPlies: 400 },
    { opponent: 'human', side: 'w', maxPlies: 160 },
    { opponent: 'medium', side: 'w', maxPlies: 400 },
  ];
  let guiltSeen = false;
  for (let i = 0; i < GAMES; i++) {
    const cfg = configs[i % configs.length];
    const t = Date.now();
    const r = await playGame(page, cfg, rand);
    guiltSeen = guiltSeen || r.sawGuilt;
    if (r.st.status.over && cfg.opponent !== 'human') {
      await page.waitForSelector('#sheet-over:not([hidden])', { timeout: 3000 });
      await page.click('#btn-over-review');
    }
    console.log(`game ${i + 1} vs ${cfg.opponent} as ${cfg.side}: ${r.st.status.over ? r.st.status.reason + ' ' + r.st.status.result : 'stopped'} ` +
      `after ${r.st.history.length} plies, guilt seen: ${r.sawGuilt}, absolve button used: ${r.sawAbsolve}, ${Math.round((Date.now() - t) / 1000)}s`);
  }

  // Undo returns to the human's turn and restores the position.
  await page.evaluate(() => window.__remorse.newGame('easy', 'w'));
  await tapMove(page, 'e2e4');
  await waitHumanTurn(page);
  await page.click('#btn-undo');
  const afterUndo = await page.evaluate(() => window.__remorse.state());
  assert.strictEqual(afterUndo.history.length, 0, 'undo goes back to before the human move');

  // The game survives a reload (saved locally).
  await tapMove(page, 'd2d4');
  await waitHumanTurn(page);
  const beforeReload = await page.evaluate(() => window.__remorse.state().fen);
  await page.reload();
  await page.waitForFunction(() => window.__remorse);
  const afterReload = await page.evaluate(() => window.__remorse.state().fen);
  assert.strictEqual(afterReload, beforeReload, 'game restored after reload');

  // Promotion picker closes on undo and on new game (QA bug 1).
  await page.evaluate(() => window.__remorse.newGame('human', 'w'));
  for (const u of ['a2a4', 'b8c6', 'a4a5', 'h7h6', 'a5a6', 'h6h5', 'a6b7', 'h5h4']) await tapMove(page, u);
  await page.click('[data-sq="49"]'); await page.click('[data-sq="57"]');
  assert.ok(await page.isVisible('#promo'), 'picker opens for b7-b8');
  await page.click('#btn-undo');
  assert.ok(!(await page.isVisible('#promo')), 'picker closed by undo');
  await tapMove(page, 'h5h4'); // undo took back Black's last move in pass & play
  await page.click('[data-sq="49"]'); await page.click('[data-sq="57"]');
  assert.ok(await page.isVisible('#promo'), 'picker opens for b7-b8');
  await page.click('#promo', { position: { x: 5, y: 5 } });
  assert.ok(!(await page.isVisible('#promo')), 'tapping outside the picker cancels it');

  // Undoing a mate quickly must not leave the game-over sheet behind (QA bug 2).
  await page.evaluate(() => window.__remorse.newGame('human', 'w'));
  for (const u of ['f2f3', 'e7e5', 'g2g4']) await tapMove(page, u);
  await tapMove(page, 'd8h4');
  await page.click('#btn-undo');
  await page.waitForTimeout(900);
  assert.ok(!(await page.isVisible('#sheet-over')), 'no game-over sheet after undoing mate');

  // Castling: tap the king, then the rook (or the marked square).
  await page.evaluate(() => window.__remorse.newGame('human', 'w'));
  for (const u of ['e2e4', 'e7e5', 'g1f3', 'g8f6', 'f1c4', 'f8c5']) await tapMove(page, u);
  await page.click('[data-sq="4"]'); await page.click('[data-sq="7"]');
  await tapMove(page, 'e8g8');
  const castled = await page.evaluate(() => window.__remorse.state().history.slice(-2));
  assert.deepStrictEqual(castled, ['O-O', 'O-O'], 'both ways of castling work');

  assert.ok(guiltSeen, 'guilt tokens appeared during play');
  assert.deepStrictEqual(errors, [], 'no console errors');
  console.log('E2E OK');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
