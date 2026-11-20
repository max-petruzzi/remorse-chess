#!/usr/bin/env node
/*
 * Builds two self-contained pages from src/:
 *   dist/index.html  - installable PWA (manifest + service worker) for any static host
 *   <out>/artifact.html - the same app as a Claude artifact page (no doctype/head)
 * Usage: node scripts/build.js [artifactOutDir]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

const engine = src('engine.js');
const ai = src('ai.js');
const pieces = src('pieces.js');
const app = src('app.js');
const css = src('styles.css');
const body = src('body.html');
const version = require('crypto').createHash('sha1').update(engine + ai + pieces + app + css + body).digest('hex').slice(0, 10);

const FONTS = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@700&family=Inter:ital,wght@0,400;0,500;0,600;1,400&display=swap';
const TITLE = 'Remorse Chess';

const scripts = `<script id="engine-src">${engine}</script>
<script id="ai-src">${ai}</script>
<script>${pieces}</script>
<script>${app}</script>`;

// ---- PWA page ----
const pwa = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${TITLE}</title>
<meta name="description" content="Chess where every capture leaves a piece guilt-ridden until a bishop absolves it. Play against a bot on your phone.">
<meta name="theme-color" content="#121016">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Remorse">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>
:root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
html { height: 100dvh; }
[hidden] { display: none !important; }
${css}</style>
</head>
<body>
${body}
${scripts}
</body>
</html>
`;
fs.writeFileSync(path.join(dist, 'index.html'), pwa);

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="112" fill="#15121d"/>
<circle cx="256" cy="230" r="190" fill="#2b2140"/>
<ellipse cx="256" cy="420" rx="128" ry="34" fill="#9b2c3d"/>
<ellipse cx="256" cy="412" rx="104" ry="20" fill="#d2465c" opacity=".55"/>
<g fill="#f6efe1" stroke="#2a2030" stroke-width="10" stroke-linejoin="round">
<path d="M166 400h180l-14-40H180z"/>
<path d="M196 360h120c-6-38-18-66-30-86 26-22 40-52 40-84 0-36-30-72-70-96-40 24-70 60-70 96 0 32 14 62 40 84-12 20-24 48-30 86z"/>
<circle cx="256" cy="72" r="20"/>
</g>
<path d="M272 140l-34 52" stroke="#2a2030" stroke-width="12" stroke-linecap="round"/>
<circle cx="256" cy="230" r="196" fill="none" stroke="#e9b44c" stroke-width="6" opacity=".55"/>
</svg>
`;
fs.writeFileSync(path.join(dist, 'icon.svg'), icon);

const manifest = {
  name: TITLE,
  short_name: 'Remorse',
  description: 'Chess where captures make pieces guilt-ridden until a bishop absolves them.',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#121016',
  theme_color: '#121016',
  icons: [
    { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
fs.writeFileSync(path.join(dist, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

const sw = `// Remorse Chess service worker: cache-first app shell, network for fonts with cache fallback.
const CACHE = 'remorse-${version}';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // Network first for the page so updates arrive; cache when offline.
    if (req.mode === 'navigate') {
      e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('index.html', copy)); return res; })
        .catch(() => caches.match('index.html')));
      return;
    }
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
    return;
  }
  if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res;
    })));
  }
});
`;
fs.writeFileSync(path.join(dist, 'sw.js'), sw);

// ---- Artifact page (the artifact host supplies doctype/head) ----
const artifactOut = process.argv[2];
if (artifactOut) {
  const artifact = `<title>${TITLE}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="${FONTS}">
<style>
${css}</style>
${body}
${scripts}
`;
  fs.mkdirSync(artifactOut, { recursive: true });
  fs.writeFileSync(path.join(artifactOut, 'artifact.html'), artifact);
  console.log('artifact ->', path.join(artifactOut, 'artifact.html'));
}
console.log('built dist/ version', version);
