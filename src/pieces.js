/* Remorse Chess piece artwork: original flat SVG pieces on a 100x100 grid. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RemorsePieces = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const BASE = '<path d="M23 87h54v-5c0-3.3-2.7-6-6-6H29c-3.3 0-6 2.7-6 6z"/>';
  // Each entry: solid shapes (class b) then detail lines (class l).
  const SHAPES = {
    1: { // pawn
      b: '<path d="M33 76c1-12 9.5-16 10.5-27h13c1 11 9.5 15 10.5 27z"/><rect x="36.5" y="44" width="27" height="7" rx="3.5"/><circle cx="50" cy="31" r="13.5"/>',
      l: '' },
    2: { // knight
      b: '<path d="M31 76c0-14 6-22 13-30-5 3.5-10.5 5.5-15.5 3.5-4.5-2-5.5-7-2.5-11l14.5-17.5L42 9.5l11 8c14.5 5 22 18.5 22 35 0 9-2.5 16-2.5 23.5z"/>',
      l: '<path d="M57 24c8.5 6.5 11.5 16.5 11 29"/><circle class="dot" cx="43.5" cy="28" r="2.6"/><path d="M30.5 42.5l3 1.5"/>' },
    3: { // bishop
      b: '<path d="M34 76c2-10 9.5-13 9.5-22h13c0 9 7.5 12 9.5 22z"/><path d="M50 15c9.5 8 15.5 17.5 15.5 25.5 0 7.5-6.5 12.5-15.5 12.5s-15.5-5-15.5-12.5C34.5 32.5 40.5 23 50 15z"/><rect x="35.5" y="50" width="29" height="7" rx="3.5"/><circle cx="50" cy="11.5" r="4.8"/>',
      l: '<path d="M56.5 25.5L47 39"/>' },
    4: { // rook
      b: '<path d="M36 36h28l4.5 40h-37z"/><path d="M28 15h10.5v7h6.5v-7h10v7h6.5v-7H72v17c0 2.2-1.8 4-4 4H32c-2.2 0-4-1.8-4-4z"/>',
      l: '<path d="M37 46h26"/>' },
    5: { // queen
      b: '<path d="M33 76c2-7 4.5-11 4.5-16h25c0 5 2.5 9 4.5 16z"/><path d="M22 31l8 28h40l8-28-8.5 13.5L64 23l-7 19.5L50 20l-7 22.5L36 23l-5.5 21.5z"/><rect x="29.5" y="56" width="41" height="7" rx="3.5"/><circle cx="22" cy="29" r="4.3"/><circle cx="36" cy="21" r="4.3"/><circle cx="50" cy="17.5" r="4.3"/><circle cx="64" cy="21" r="4.3"/><circle cx="78" cy="29" r="4.3"/>',
      l: '' },
    6: { // king
      b: '<path d="M33 76c2-7 4.5-10 4.5-15h25c0 5 2.5 8 4.5 15z"/><path d="M46.8 7h6.4v6.5h6.8v6.4h-6.8V31h-6.4V19.9H40v-6.4h6.8z"/><path d="M27 37c8.5-7 15-7.5 23-.5 8-7 14.5-6.5 23 .5l-6 23H33z"/><rect x="30.5" y="56" width="39" height="7" rx="3.5"/>',
      l: '<path d="M50 40v13"/>' },
  };
  function svg(type, color) {
    const s = SHAPES[type];
    return '<svg class="pc ' + (color ? 'pc-b' : 'pc-w') + '" viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
      '<g class="b">' + BASE + s.b + '</g><g class="l">' + s.l + '</g></svg>';
  }
  return { svg };
});
