// Test de bout en bout avec Playwright.
// Usage : (serveur lancé sur le port 8765) node tests/e2e.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const ROOT = path.join(__dirname, '..');
const results = [];
function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${name}${extra ? ' — ' + extra : ''}`);
}

// --- Réponses simulées des API publiques -----------------------------------
const sample = fs.readFileSync(path.join(ROOT, 'samples/exemple.pgn'), 'utf8');
const ccPgn = (id, white, black, result, moves) => `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.11.0${id}"]
[White "${white}"]
[Black "${black}"]
[Result "${result}"]
[ECO "C50"]
[ECOUrl "https://www.chess.com/openings/Italian-Game-Giuoco-Piano-4.c3"]
[Link "https://www.chess.com/game/live/10000${id}"]

${moves} ${result}`;
const ccMonthNov = { games: [
  { rules: 'chess', end_time: 3, pgn: ccPgn(1, 'TestJoueur', 'Rival1', '1-0', '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6') },
  { rules: 'chess', end_time: 4, pgn: ccPgn(2, 'Rival2', 'TestJoueur', '0-1', '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 d6') },
  { rules: 'chess960', end_time: 5, pgn: '[Event "960"]\n\n1. e4 *' },
] };
const ccMonthOct = { games: [
  { rules: 'chess', end_time: 1, pgn: ccPgn(3, 'TestJoueur', 'Rival3', '1/2-1/2', '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Qe7') },
] };
const liGame = (id, white, black, result, opening) => JSON.stringify({ id, variant: 'standard', pgn: `[Event "Rated blitz game"]
[Site "https://lichess.org/${id}"]
[Date "2026.11.05"]
[White "${white}"]
[Black "${black}"]
[Result "${result}"]
[ECO "B01"]
[Opening "${opening}"]

1. e4 d5 2. exd5 Qxd5 3. Nc3 Qa5 ${result}` });
const lichessNdjson = [
  liGame('abcdEFGH', 'testjoueur', 'Adversaire', '1-0', 'Scandinavian Defense'),
  liGame('ijklMNOP', 'Adversaire2', 'TestJoueur', '1-0', 'Scandinavian Defense'),
].join('\n') + '\n';

const apiCalls = [];
async function mockApis(context) {
  await context.route('https://api.chess.com/**', async (route) => {
    const url = route.request().url();
    apiCalls.push(url);
    if (/player\/inconnu\//.test(url)) return route.fulfill({ status: 404, body: '{"code":0,"message":"not found"}', headers: { 'access-control-allow-origin': '*' } });
    let body;
    if (url.endsWith('/games/archives')) {
      body = { archives: ['2026/08', '2026/09', '2026/10', '2026/11'].map((m) => `https://api.chess.com/pub/player/testjoueur/games/${m}`) };
    } else if (url.endsWith('/2026/11')) body = ccMonthNov;
    else if (url.endsWith('/2026/10')) body = ccMonthOct;
    else body = { games: [] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
  });
  await context.route('https://lichess.org/**', async (route) => {
    const req = route.request();
    apiCalls.push(req.url() + ' auth=' + (req.headers()['authorization'] || '-') + ' accept=' + req.headers()['accept']);
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: lichessNdjson, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
  });
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  await mockApis(context);
  const page = await context.newPage();
  const consoleErrors = [];
  const httpErrors = [];
  page.on('response', (r) => { if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.url()}`); });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // la 404 volontaire (utilisateur Chess.com inexistant simulé) est vérifiée séparément
    if (/status of 404/.test(m.text())) return;
    consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(BASE);
  await page.waitForSelector('#engine-status.ok', { timeout: 60000 });
  check('Le moteur Stockfish démarre', true);

  // --- 1. Coller un PGN (Partie de l'Opéra) ------------------------------
  await page.click('.tab[data-tab="importer"]');
  const opera = sample.split(/\n\s*\n(?=\[Event)/)[0];
  await page.fill('#pgn-input', opera);
  await page.click('#btn-import-paste');
  await page.waitForSelector('#analysis-layout:not(.hidden)');
  check('Import par collage : la partie s’ouvre', await page.isVisible('#board svg'));
  check('Liste des coups (33 demi-coups)', (await page.locator('#move-list .mv[data-ply]').count()) === 33);

  // navigation clavier
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  check('Navigation clavier → demi-coup 2', (await page.evaluate(() => window.__fdr.state.ply)) === 2);
  await page.keyboard.press('End');
  check('Touche Fin → dernier coup', (await page.evaluate(() => window.__fdr.state.ply)) === 33);
  await page.click('#move-list .mv[data-ply="10"]');
  check('Clic dans la liste des coups', (await page.evaluate(() => window.__fdr.state.ply)) === 10);
  check('Dernier coup surligné', (await page.locator('#board .sq-last').count()) === 2);
  await page.click('#btn-flip');
  check('Retournement de l’échiquier', await page.evaluate(() => window.__fdr.state.flipped));
  await page.click('#btn-flip');

  // --- 2. Analyse moteur à faible profondeur -------------------------------
  await page.selectOption('#depth-select', '8');
  await page.click('#btn-analyze');
  await page.waitForSelector('#progress:not(.hidden)');
  const t0 = Date.now();
  await page.waitForFunction(() => !window.__fdr.state.analyzing && window.__fdr.state.report, null, { timeout: 180000 });
  check('Analyse complète terminée', true, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const acc = await page.$$eval('.acc-value', (els) => els.map((e) => e.textContent));
  check('Précision affichée pour les deux joueurs', acc.length === 2 && acc.every((a) => /^\d+(\.\d)?$/.test(a)), acc.join(' / '));
  const cats = await page.locator('#move-list .cat-icon').count();
  check('Classification de chaque coup', cats === 33, `${cats} icônes`);
  const catSummary = await page.evaluate(() => {
    const r = window.__fdr.state.report;
    return { w: r.players.w.counts, b: r.players.b.counts, acplW: r.players.w.acpl, acplB: r.players.b.acpl };
  });
  check('Comptes par catégorie et perte moyenne', catSummary.acplW !== null && catSummary.acplB !== null, JSON.stringify(catSummary));
  const graphPixels = await page.evaluate(() => {
    const c = document.querySelector('#eval-graph');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let light = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200) light++;
    return light;
  });
  check('Courbe d’évaluation dessinée', graphPixels > 1000, `${graphPixels} pixels clairs`);
  // clic sur le graphique
  const box = await page.locator('#eval-graph').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  const plyAfterGraph = await page.evaluate(() => window.__fdr.state.ply);
  check('Clic sur la courbe → navigation', plyAfterGraph > 10 && plyAfterGraph < 24, `demi-coup ${plyAfterGraph}`);
  await page.click('#move-list .mv[data-ply="1"]');
  check('Flèche du meilleur coup', (await page.locator('#board .best-arrow').count()) === 1);
  check('Ligne principale du moteur', (await page.textContent('#engine-pv')).trim().length > 5, (await page.textContent('#engine-pv')).trim());
  // Chercher une erreur/gaffe pour vérifier « meilleur coup était »
  const badPly = await page.evaluate(() => {
    const r = window.__fdr.state.report;
    const m = r.moves.find((x) => ['imprecision', 'erreur', 'gaffe'].includes(x.category));
    return m ? m.ply : null;
  });
  if (badPly) {
    await page.click(`#move-list .mv[data-ply="${badPly}"]`);
    const hint = await page.textContent('#move-comment');
    check('Commentaire « Le meilleur coup était … »', /meilleur coup était/.test(hint), hint.trim().replace(/\s+/g, ' '));
  } else check('Commentaire « meilleur coup » (aucune erreur trouvée)', true);
  await page.click('#move-list .mv[data-ply="27"]');

  // capture d'écran principale
  await page.screenshot({ path: path.join(ROOT, 'screenshot.png'), fullPage: true });

  // --- 3. Exemple (plusieurs parties) + bibliothèque -------------------------
  await page.click('.tab[data-tab="importer"]');
  await page.click('#tab-importer [data-action="load-sample"]');
  await page.waitForFunction(() => window.__fdr.state.games.length >= 6);
  check('Charger un exemple : 6 parties', (await page.evaluate(() => window.__fdr.state.games.length)) === 6);
  await page.click('.tab[data-tab="importer"]');
  check('Liste de choix des parties', (await page.locator('#import-results .game-item').count()) === 6);

  // --- 4. Fichier .pgn -----------------------------------------------------
  await page.setInputFiles('#file-input', path.join(ROOT, 'samples/exemple.pgn'));
  await page.waitForFunction(() => /déjà présente/.test(document.querySelector('#import-status').textContent));
  check('Import de fichier (doublons détectés)', true, (await page.textContent('#import-status')).trim());

  // PGN invalide
  await page.fill('#pgn-input', '1. e4 e5 2. Ke3 Zz9');
  await page.click('#btn-import-paste');
  const errTxt = await page.textContent('#import-status');
  check('Message d’erreur en français pour un PGN invalide', /Aucune partie valide/.test(errTxt), errTxt.trim());

  // --- 5. Import en ligne (simulé) + erreur 404 ------------------------------
  await page.fill('#online-user', 'inconnu');
  await page.click('#btn-chesscom');
  await page.waitForFunction(() => /introuvable/.test(document.querySelector('#import-status').textContent));
  check('Chess.com 404 → message français', true, (await page.textContent('#import-status')).trim());

  // --- 6. Mon compte : synchronisation ---------------------------------------
  await page.click('.tab[data-tab="compte"]');
  await page.fill('#acc-chesscom', 'TestJoueur');
  await page.fill('#acc-chesscom-months', '3');
  await page.fill('#acc-lichess', 'TestJoueur');
  await page.fill('#acc-lichess-max', '50');
  await page.click('#btn-account-save');
  await page.waitForFunction(() => /Lichess/.test(document.querySelector('#sync-status').textContent) && !/en cours/.test(document.querySelector('#sync-status').textContent));
  const syncTxt = (await page.textContent('#sync-status')).trim();
  check('Synchronisation Chess.com + Lichess', /Chess\.com : 3 partie\(s\) récupérée\(s\), 3 nouvelle/.test(syncTxt) && /Lichess : 2 partie\(s\) récupérée\(s\), 2 nouvelle/.test(syncTxt), syncTxt);
  check('Plusieurs archives mensuelles Chess.com parcourues', apiCalls.filter((u) => /games\/2026\/1[01]$/.test(u)).length >= 2 && apiCalls.some((u) => /2026\/09$/.test(u)), apiCalls.filter((u) => /chess\.com/.test(u)).join(', '));
  check('Lichess : max=50 et en-tête NDJSON', apiCalls.some((u) => /max=50/.test(u) && /application\/x-ndjson/.test(u)));
  await page.click('#btn-sync');
  await page.waitForFunction(() => /déjà importée/.test(document.querySelector('#sync-status').textContent));
  const sync2 = (await page.textContent('#sync-status')).trim();
  check('Resynchronisation : doublons ignorés', /0 nouvelle/.test(sync2), sync2);
  const total = await page.evaluate(() => window.__fdr.state.games.length);
  check('Bibliothèque : 6 + 5 parties', total === 11, String(total));

  // jeton Lichess facultatif
  await page.fill('#acc-lichess-token', 'lip_jetonDeTest');
  await page.click('#btn-sync');
  await page.waitForFunction(() => !document.querySelector('#btn-sync').disabled);
  check('Jeton Lichess envoyé en en-tête Authorization', apiCalls.some((u) => /auth=Bearer lip_jetonDeTest/.test(u)));

  // orientation auto : partie où TestJoueur a les Noirs
  const blackGameId = await page.evaluate(() => window.__fdr.state.games.find((g) => g.headers.Black === 'TestJoueur' && g.headers.White === 'Rival2').id);
  await page.click('.tab[data-tab="bibliotheque"]');
  await page.click(`[data-open="${blackGameId}"]`);
  check('Orientation automatique (joueur avec les Noirs)', await page.evaluate(() => window.__fdr.state.flipped));
  const bottomName = await page.textContent('#player-bottom .pb-name');
  check('Le joueur du compte est en bas', bottomName === 'TestJoueur', bottomName);

  // --- 7. Mes statistiques -------------------------------------------------
  await page.click('.tab[data-tab="stats"]');
  const statsUser = await page.inputValue('#stats-user');
  check('Statistiques : pseudo du compte par défaut', /TestJoueur/.test(statsUser), statsUser);
  const kpis = await page.$$eval('.kpi-value', (els) => els.map((e) => e.textContent));
  check('Statistiques : V/N/D', kpis[0] === '5' && kpis[1] === '3' && kpis[2] === '1' && kpis[3] === '1', kpis.join(' | '));
  const openingsRows = await page.locator('#stats-out table >> nth=1 >> tbody tr').count();
  check('Statistiques : ouvertures', openingsRows === 2, `${openingsRows} ouvertures`);
  await page.fill('#stats-user', 'Exemple');
  await page.click('#btn-stats');
  const kpis2 = await page.$$eval('.kpi-value', (els) => els.map((e) => e.textContent));
  check('Statistiques pour « Exemple » (4 parties : 2V 1N 1D)', kpis2.slice(0, 4).join(',') === '4,2,1,1', kpis2.join(' | '));
  await page.screenshot({ path: path.join(ROOT, 'tests/screenshot-stats.png') });
  await page.click('.tab[data-tab="compte"]');
  await page.screenshot({ path: path.join(ROOT, 'tests/screenshot-compte.png') });

  // --- 8. Persistance (rechargement) ---------------------------------------
  await page.reload();
  await page.waitForSelector('#engine-status.ok', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('#btn-sync-top').disabled);
  const persisted = await page.evaluate(() => ({
    games: window.__fdr.state.games.length,
    analyses: Object.keys(window.__fdr.state.analyses).length,
    account: window.__fdr.settings.account.chesscom,
  }));
  check('Persistance localStorage après rechargement', persisted.games === 11 && persisted.analyses >= 1 && persisted.account === 'TestJoueur', JSON.stringify(persisted));

  // Partie de l'Opéra rouverte : rapport restauré sans réanalyse
  const operaId = await page.evaluate(() => window.__fdr.state.games.find((g) => g.headers.White === 'Paul Morphy').id);
  await page.click('.tab[data-tab="bibliotheque"]');
  await page.click(`[data-open="${operaId}"]`);
  check('Analyse restaurée depuis le stockage', (await page.locator('.acc-value').count()) === 2);

  await page.waitForTimeout(500);
  check('Seule réponse HTTP en erreur : la 404 simulée', httpErrors.length === 1 && /player\/inconnu\//.test(httpErrors[0]), httpErrors.join(', '));
  check('Aucune erreur dans la console', consoleErrors.length === 0, consoleErrors.join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies.`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
