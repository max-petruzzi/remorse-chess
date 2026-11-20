# Remorse Chess

Chess where pieces feel remorse. Capture something and your piece becomes
**guilt-ridden**: a red token goes underneath it and it can no longer capture
(so it gives no check either). It still moves normally. A **bishop** cures it:
stand a bishop next to the guilty piece and spend a turn absolving it.

Play on your phone against a built-in bot (three levels), against Claude, or
pass-and-play with a friend.

**Play:** https://max-petruzzi.github.io/remorse-chess/ (open on your phone, then
Share → Add to Home Screen to install it; it works offline).

## Rules

1. Capturing makes a piece guilt-ridden.
2. Guilt-ridden pieces cannot capture. Because of that they do not give check
   and do not stop the enemy king from walking next to them.
3. Absolution is an action that uses your whole turn. A non-guilty bishop
   standing next to a guilty piece of its own side (any of the 8 neighbouring
   squares) may absolve that one piece instead of moving. Moving a bishop next
   to a guilty piece does nothing by itself.
4. A bishop that captures is guilt-ridden too. It cannot absolve others while
   guilty, but it may spend a turn absolving itself.
5. With no bishops left, guilt stays until a pawn promotes to a bishop.
6. Checkmate wins. Stalemate, threefold repetition, the 50-move rule and
   insufficient material are draws.

Readings chosen where the original video left things open: one absolution
forgives one piece, a promotion that captures makes a guilty piece, a guilty
pawn stays guilty when it promotes, a guilty king cannot capture, and en
passant counts as a capture. If no pawns or bishops remain and every piece but
the kings is guilty, the game is drawn.

## Layout

- `src/engine.js` rules engine (no dependencies, works in Node and browsers)
- `src/ai.js` bot: alpha-beta search with a guilt-aware evaluation
- `src/pieces.js` the piece artwork (original SVGs)
- `src/app.js`, `src/body.html`, `src/styles.css` the phone UI
- `scripts/build.js` builds `dist/` (a self-contained installable web app)
- `test/engine.test.js` rules tests; `test/e2e.js` plays full games in a phone-sized browser

## Develop

```sh
npm test               # rules tests
npm run build          # rebuild dist/ (icons need Playwright)
npm run serve          # http://localhost:8765
npm run e2e            # full games in a headless phone browser (needs Playwright)
```

`dist/` is committed so it can be hosted as-is. The GitHub Pages workflow in
`.github/workflows/pages.yml` publishes it.
