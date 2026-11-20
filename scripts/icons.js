#!/usr/bin/env node
// Renders dist/icon.svg to the PNG sizes iOS and Android want. Needs Playwright.
'use strict';
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const dist = path.join(__dirname, '..', 'dist');
  const browser = await chromium.launch();
  for (const size of [180, 192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0;background:#15121d}</style><img src="file://${path.join(dist, 'icon.svg')}" width="${size}" height="${size}">`);
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(dist, `icon-${size}.png`) });
    await page.close();
  }
  await browser.close();
  console.log('icons rendered');
})();
