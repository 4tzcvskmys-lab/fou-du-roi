const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  const ok = (name, cond, extra = '') => console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('#engine-status.ok', { timeout: 60000 });
  ok('Bannière d’installation iPhone visible', await page.isVisible('#install-banner'));
  const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  ok('Manifeste valide', manifest.display === 'standalone' && manifest.icons.length === 3, manifest.short_name);
  const icons = await page.evaluate(async () => Promise.all(['icons/apple-touch-icon.png','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png'].map(async u => (await fetch(u)).status)));
  ok('Icônes accessibles', icons.every(s => s === 200), icons.join(','));
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cached = await page.evaluate(async () => (await (await caches.open('fdr-v1')).keys()).length);
  ok('Service worker actif, fichiers en cache', cached >= 20, cached + ' fichiers');
  // charger l'exemple en ligne
  await page.click('.tab[data-tab="importer"]');
  await page.click('#tab-importer [data-action="load-sample"]');
  await page.waitForFunction(() => window.__fdr.state.games.length >= 6);
  await page.screenshot({ path: require('path').join(__dirname, 'mobile-1.png') });
  // fermer la bannière
  await page.click('#install-banner-close');
  ok('Bannière fermée', !(await page.isVisible('#install-banner')));
  // HORS LIGNE
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('#engine-status.ok', { timeout: 60000 });
  ok('Hors ligne : l’application et le moteur démarrent', true);
  ok('Hors ligne : bannière reste fermée', !(await page.isVisible('#install-banner')));
  ok('Hors ligne : parties conservées', (await page.evaluate(() => window.__fdr.state.games.length)) === 6);
  await page.selectOption('#depth-select', '12');
  await page.click('#btn-analyze');
  const t0 = Date.now();
  await page.waitForFunction(() => !window.__fdr.state.analyzing && window.__fdr.state.report, null, { timeout: 180000 });
  ok('Hors ligne : analyse complète', true, ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('Pas de débordement horizontal (largeur iPhone)', overflow <= 1, overflow + ' px');
  await page.screenshot({ path: require('path').join(__dirname, 'mobile-2.png') });
  await page.screenshot({ path: require('path').join(__dirname, 'mobile-full.png'), fullPage: true });
  ok('Aucune erreur console', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.error('ÉCHEC', e); process.exit(1); });
