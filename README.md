# Remorse Chess

Chess where pieces feel remorse. Capture something and your piece becomes
**guilt-ridden**: a red token goes underneath it and it can no longer capture
(so it gives no check either). It still moves normally. A **bishop** cures it:
move a bishop onto any square touching the guilty piece and it is absolved.

Play on your phone against a built-in bot (three levels), against Claude, or
pass-and-play with a friend.

**Play:** https://max-petruzzi.github.io/remorse-chess/ (open on your phone, then
Share → Add to Home Screen to install it; it works offline).

## Rules

1. Capturing makes a piece guilt-ridden.
2. Guilt-ridden pieces cannot capture. Because of that they do not give check
   and do not stop the enemy king from walking next to them.
3. A non-guilty bishop that ends a non-capturing move next to guilty pieces of
   its own side (any of the 8 neighbouring squares) absolves all of them. A
   bishop already next to one can spend its turn absolving in place.
4. A bishop that captures is guilty through its owner's next turn, then
   cleanses itself automatically.
5. With no bishops left, guilt stays until a pawn promotes to a bishop.
6. Checkmate wins. Stalemate, threefold repetition, the 50-move rule and
   insufficient material are draws.

Readings chosen where the original video left things open: a promotion that
captures makes a guilty piece, a guilty king cannot capture, en passant counts
as a capture, and one bishop absolves every adjacent guilty friend at once.

## Layout

- `src/engine.js` rules engine (no dependencies, works in Node and browsers)
- `src/ai.js` bot: alpha-beta search with a guilt-aware evaluation
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
