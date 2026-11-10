// Application principale : interface, navigation, analyse.
import { Chess } from '../vendor/chess.js/chess.js';
import { Board } from './board.js';
import { Engine } from './engine.js';
import { EvalGraph } from './graph.js';
import { store } from './storage.js';
import { parseMany, buildPositions, formatLine, uciToSan, openingName } from './pgn.js';
import { buildReport, formatEval, winPercent, CATEGORIES, CATEGORY_BY_KEY } from './analysis.js';
import { fetchLichess, fetchChessCom } from './importers.js';
import { computeStats, playerNames, scorePercent } from './stats.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const settings = Object.assign({ depth: 14, theme: 'sombre', frNotation: true, statsUser: '' }, store.loadSettings());
settings.account = Object.assign({
  chesscomOn: false, chesscom: '', chesscomMonths: 3,
  lichessOn: false, lichess: '', lichessMax: 50, lichessToken: '',
  autoSync: true, lastSync: null,
}, settings.account || {});

const state = {
  games: store.loadGames(), // [{id, pgn, headers, plies, source, addedAt}]
  analyses: store.loadAnalyses(), // id -> {depth, evals, best, pv}
  currentId: null,
  game: null, // {fens, moves, headers}
  ply: 0,
  flipped: false,
  report: null,
  analyzing: false,
  cancelAnalysis: false,
  live: { busy: false, wanted: null, result: null, fen: null },
};

let engine = null;
let board = null;
let graph = null;

// ---------------------------------------------------------------- utilitaires
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const FR_PIECES = { K: 'R', Q: 'D', R: 'T', B: 'F', N: 'C' };
function san(s) {
  if (!settings.frNotation || !s) return s;
  return s.replace(/[KQRBN]/g, (c) => FR_PIECES[c]);
}
function line(s) {
  return settings.frNotation ? s.replace(/[KQRBN]/g, (c) => FR_PIECES[c]) : s;
}

function resultLabel(r) {
  return { '1-0': 'Victoire des Blancs', '0-1': 'Victoire des Noirs', '1/2-1/2': 'Partie nulle' }[r] || 'Résultat inconnu';
}

function formatDate(d) {
  if (!d || /\?/.test(d)) return '';
  const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(d);
  if (!m) return d;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function setStatus(el, msg, kind = 'info') {
  el.className = `status ${kind}`;
  el.innerHTML = msg;
}

function saveSettings() {
  store.saveSettings(settings);
}

function persistGames() {
  if (!store.saveGames(state.games)) {
    setStatus($('#import-status'), 'Attention : l’espace de stockage local est plein, certaines parties ne seront pas conservées.', 'err');
  }
}
function persistAnalyses() {
  if (!store.saveAnalyses(state.analyses)) {
    console.warn('Analyse non enregistrée (stockage plein).');
  }
}

// ---------------------------------------------------------------- onglets
function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'analyse' && graph) requestAnimationFrame(() => graph.draw());
  if (name === 'bibliotheque') renderLibrary();
  if (name === 'stats') renderStatsForm();
  if (name === 'compte') renderAccountForm();
  if (window.matchMedia('(max-width: 700px)').matches) window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- moteur
function initEngine() {
  const st = $('#engine-status');
  try {
    engine = new Engine();
  } catch (e) {
    st.className = 'engine-status err';
    st.querySelector('.label').textContent = 'Moteur indisponible';
    return;
  }
  engine.ready.then(() => {
    st.className = 'engine-status ok';
    st.querySelector('.label').textContent = 'Moteur prêt';
    refreshLive();
  }).catch((e) => {
    st.className = 'engine-status err';
    st.querySelector('.label').textContent = 'Moteur indisponible';
    st.title = e.message;
  });
}

// ---------------------------------------------------------------- import
function addParsedGames(parsed, source) {
  const result = new Array(parsed.length);
  let added = 0;
  // parcours à rebours : la première partie de la liste (la plus récente) finit en tête
  for (let i = parsed.length - 1; i >= 0; i--) {
    const g = parsed[i];
    let existing = state.games.find((x) => x.id === g.id || (g.url && x.url === g.url));
    if (!existing) {
      existing = { id: g.id, url: g.url || null, pgn: g.pgn, headers: g.headers, plies: g.plies, source, addedAt: Date.now() };
      state.games.unshift(existing);
      added++;
    }
    result[i] = existing;
  }
  persistGames();
  updateLibCount();
  return { list: result, added };
}

function handleImportText(text, source, { openFirst = false } = {}) {
  const status = $('#import-status');
  const { games, errors } = parseMany(text);
  if (!games.length) {
    setStatus(status, `<strong>Aucune partie valide n’a été trouvée.</strong>${errors.length ? '<br>' + errors.map(escapeHtml).join('<br>') : ''}`, 'err');
    return null;
  }
  const { list, added } = addParsedGames(games, source);
  const parts = [`${games.length} partie${games.length > 1 ? 's' : ''} lue${games.length > 1 ? 's' : ''}`];
  parts.push(added ? `${added} nouvelle${added > 1 ? 's' : ''} enregistrée${added > 1 ? 's' : ''}` : 'déjà présente(s) dans la bibliothèque');
  let msg = parts.join(' — ') + '.';
  if (errors.length) msg += `<br><span class="warn">${errors.length} partie(s) ignorée(s) :</span><br>` + errors.slice(0, 5).map(escapeHtml).join('<br>');
  setStatus(status, msg, errors.length ? 'warn' : 'ok');
  renderGameList($('#import-results'), list, { showDelete: false });
  $('#import-results-card').classList.toggle('hidden', list.length < 2);
  if (list.length === 1 || openFirst) {
    openGame(list[0].id);
  }
  return list;
}

async function loadSample() {
  const status = $('#import-status');
  try {
    let text = globalThis.__FDR_SAMPLE_PGN__;
    if (typeof text !== 'string') {
      const res = await fetch('samples/exemple.pgn');
      if (!res.ok) throw new Error();
      text = await res.text();
    }
    const list = handleImportText(text, 'exemple', { openFirst: true });
    if (list && !settings.statsUser) {
      settings.statsUser = 'Exemple';
      saveSettings();
    }
  } catch {
    setStatus(status, 'Impossible de charger le fichier d’exemple (lancez l’application via un serveur local).', 'err');
    showTab('importer');
  }
}

async function importOnline(site) {
  const status = $('#import-status');
  const user = $('#online-user').value;
  const btns = [$('#btn-lichess'), $('#btn-chesscom')];
  btns.forEach((b) => (b.disabled = true));
  setStatus(status, `<span class="spinner"></span> Récupération des parties depuis ${site === 'lichess' ? 'Lichess' : 'Chess.com'}…`, 'info');
  try {
    const { pgns, skipped } = site === 'lichess' ? await fetchLichess(user) : await fetchChessCom(user);
    const list = handleImportText(pgns.join('\n\n'), site);
    if (list) {
      $('#import-results-card').classList.remove('hidden');
      if (skipped) status.innerHTML += `<br><span class="muted">${skipped} partie(s) de variante ignorée(s).</span>`;
      settings.statsUser = user.trim();
      saveSettings();
    }
  } catch (e) {
    setStatus(status, escapeHtml(e.message || 'Erreur inconnue.'), 'err');
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}

async function readFiles(files) {
  const status = $('#import-status');
  if (!files || !files.length) return;
  try {
    const texts = await Promise.all([...files].map((f) => {
      if (f.size > 20 * 1024 * 1024) throw new Error(`Le fichier « ${f.name} » est trop volumineux (20 Mo maximum).`);
      return f.text();
    }));
    handleImportText(texts.join('\n\n'), 'fichier');
  } catch (e) {
    setStatus(status, escapeHtml(e.message || 'Lecture du fichier impossible.'), 'err');
  }
}

// ---------------------------------------------------------------- listes de parties
function gameTitle(h) {
  return `${h.White || '?'} – ${h.Black || '?'}`;
}

function renderGameList(container, list, { showDelete }) {
  if (!list.length) {
    container.innerHTML = '<p class="muted">Aucune partie pour le moment. Importez-en depuis l’onglet « Importer ».</p>';
    return;
  }
  container.innerHTML = list.map((g) => {
    const h = g.headers;
    const analysed = state.analyses[g.id];
    const elo = (e) => (e && e !== '?' ? ` <span class="muted">(${escapeHtml(e)})</span>` : '');
    return `<div class="game-item ${g.id === state.currentId ? 'current' : ''}" data-id="${g.id}">
      <button class="game-open" data-open="${g.id}">
        <span class="gi-players">${escapeHtml(h.White || '?')}${elo(h.WhiteElo)} <span class="vs">–</span> ${escapeHtml(h.Black || '?')}${elo(h.BlackElo)}</span>
        <span class="gi-meta">
          <span class="result-chip r-${(h.Result || '*').replace(/[^0-9a-z]/gi, '')}">${escapeHtml(h.Result || '*')}</span>
          ${escapeHtml(openingName(h))} · ${Math.ceil(g.plies / 2)} coups${formatDate(h.Date) ? ' · ' + formatDate(h.Date) : ''}
          ${analysed ? `<span class="badge-analysed">analysée (prof. ${analysed.depth})</span>` : ''}
        </span>
      </button>
      ${showDelete ? `<button class="icon-btn del" data-del="${g.id}" title="Supprimer cette partie" aria-label="Supprimer">✕</button>` : ''}
    </div>`;
  }).join('');
}

function renderLibrary() {
  const f = ($('#lib-filter').value || '').toLowerCase();
  const list = state.games.filter((g) => {
    if (!f) return true;
    const h = g.headers;
    return [h.White, h.Black, h.Event, openingName(h), h.Date].join(' ').toLowerCase().includes(f);
  });
  renderGameList($('#library'), list, { showDelete: true });
}

function updateLibCount() {
  $('#lib-count').textContent = state.games.length;
}

function deleteGame(id) {
  state.games = state.games.filter((g) => g.id !== id);
  delete state.analyses[id];
  persistGames();
  persistAnalyses();
  updateLibCount();
  if (state.currentId === id) {
    state.currentId = null;
    state.game = null;
    $('#analysis-layout').classList.add('hidden');
    $('#empty-state').classList.remove('hidden');
  }
  renderLibrary();
}

// ---------------------------------------------------------------- ouverture d'une partie
function openGame(id, ply = 0, { switchTab = true } = {}) {
  const entry = state.games.find((g) => g.id === id);
  if (!entry) return;
  if (state.analyzing) {
    state.cancelAnalysis = true;
    engine && engine.stop();
  }
  try {
    state.game = buildPositions(entry.pgn);
  } catch (e) {
    setStatus($('#import-status'), 'Cette partie ne peut pas être ouverte : ' + escapeHtml(e.message), 'err');
    return;
  }
  state.currentId = id;
  state.ply = Math.max(0, Math.min(ply, state.game.moves.length));
  applyOrientation({ render: false });
  state.live.result = null;
  state.live.fen = null;
  computeReport();
  $('#empty-state').classList.add('hidden');
  $('#analysis-layout').classList.remove('hidden');
  if (switchTab) showTab('analyse');
  renderGameInfo();
  renderMoveList();
  renderSummary();
  renderGraph();
  goto(state.ply, { force: true });
  if (engine) engine.newGame();
}

/** Orientation automatique : l'échiquier est tourné du côté du joueur du compte. */
function applyOrientation({ render = true } = {}) {
  if (!state.game) return;
  const mine = accountNames();
  const hw = (state.game.headers.White || '').toLowerCase();
  const hb = (state.game.headers.Black || '').toLowerCase();
  const flip = mine.includes(hb) && !mine.includes(hw);
  if (flip !== state.flipped) {
    state.flipped = flip;
    board.setFlipped(flip);
    if (render) {
      renderPlayers();
      renderEvalBar(currentEngineInfo() ? currentEngineInfo().eval : null);
    }
  }
}

function computeReport() {
  const an = state.analyses[state.currentId];
  state.report = an && an.evals && an.evals.length === state.game.fens.length ? buildReport(state.game, an) : null;
}

// ---------------------------------------------------------------- rendu
function renderGameInfo() {
  const h = state.game.headers;
  const date = formatDate(h.Date);
  const opening = openingName(h);
  $('#game-info').innerHTML = `
    <div class="gi-title">${escapeHtml(gameTitle(h))}</div>
    <div class="gi-sub">
      <span class="result-chip r-${(h.Result || '*').replace(/[^0-9a-z]/gi, '')}">${escapeHtml(h.Result || '*')}</span>
      ${escapeHtml(resultLabel(h.Result))}
    </div>
    <div class="gi-details">
      ${h.Event && h.Event !== '?' ? `<span>${escapeHtml(h.Event)}</span>` : ''}
      ${h.Site && h.Site !== '?' ? `<span>${escapeHtml(h.Site.replace(/^https?:\/\//, ''))}</span>` : ''}
      ${date ? `<span>${escapeHtml(date)}</span>` : ''}
      ${h.TimeControl && h.TimeControl !== '-' ? `<span>Cadence ${escapeHtml(h.TimeControl)}</span>` : ''}
    </div>
    <div class="gi-opening">${h.ECO && h.ECO !== '?' ? `<span class="eco">${escapeHtml(h.ECO)}</span>` : ''}${escapeHtml(opening)}</div>`;
}

function playerBar(color) {
  const h = state.game.headers;
  const name = color === 'w' ? h.White : h.Black;
  const elo = color === 'w' ? h.WhiteElo : h.BlackElo;
  const p = state.report && state.report.players[color];
  return `<span class="pb-color ${color === 'w' ? 'white' : 'black'}"></span>
    <span class="pb-name">${escapeHtml(name || (color === 'w' ? 'Blancs' : 'Noirs'))}</span>
    ${elo && elo !== '?' ? `<span class="pb-elo">${escapeHtml(elo)}</span>` : ''}
    ${p && p.accuracy !== null ? `<span class="pb-acc" title="Précision">${p.accuracy.toFixed(1)} %</span>` : ''}`;
}

function renderPlayers() {
  const topColor = state.flipped ? 'w' : 'b';
  $('#player-top').innerHTML = playerBar(topColor);
  $('#player-bottom').innerHTML = playerBar(topColor === 'w' ? 'b' : 'w');
}

function categoryBadge(key) {
  const c = CATEGORY_BY_KEY[key];
  return `<span class="cat-icon cat-${key}" title="${c.label}">${c.icon}</span>`;
}

function renderMoveList() {
  const { moves, fens } = state.game;
  const rep = state.report;
  const firstMoveNo = parseInt(fens[0].split(' ')[5], 10) || 1;
  const startsBlack = moves.length && moves[0].color === 'b';
  let html = '';
  let i = 0;
  let no = firstMoveNo;
  const cell = (idx) => {
    if (idx >= moves.length) return '<span class="mv empty"></span>';
    const m = moves[idx];
    const r = rep && rep.moves[idx];
    return `<button class="mv ${r ? 'cat-bg-' + r.category : ''}" data-ply="${idx + 1}">
      <span class="mv-san">${escapeHtml(san(m.san))}</span>${r ? categoryBadge(r.category) : ''}</button>`;
  };
  if (startsBlack) {
    html += `<span class="mv-no">${no}.</span><span class="mv empty">…</span>${cell(0)}`;
    i = 1;
    no++;
  }
  for (; i < moves.length; i += 2, no++) {
    html += `<span class="mv-no">${no}.</span>${cell(i)}${cell(i + 1)}`;
  }
  const res = state.game.headers.Result;
  if (res && res !== '*') html += `<span class="mv-result">${escapeHtml(res)} · ${escapeHtml(resultLabel(res))}</span>`;
  $('#move-list').innerHTML = html;
}

function renderSummary() {
  const rep = state.report;
  const out = $('#summary');
  if (!rep) {
    out.innerHTML = '<p class="muted">Lancez l’analyse pour obtenir la précision et la classification des coups.</p>';
    return;
  }
  const h = state.game.headers;
  const an = state.analyses[state.currentId];
  const col = (c) => {
    const p = rep.players[c];
    const acc = p.accuracy === null ? '–' : p.accuracy.toFixed(1);
    return `<div class="sum-player">
      <div class="sum-name"><span class="pb-color ${c === 'w' ? 'white' : 'black'}"></span>${escapeHtml((c === 'w' ? h.White : h.Black) || (c === 'w' ? 'Blancs' : 'Noirs'))}</div>
      <div class="sum-acc"><span class="acc-value">${acc}</span><span class="acc-unit">%</span></div>
      <div class="muted small">précision</div>
      <ul class="sum-cats">
        ${CATEGORIES.map((cat) => `<li>${categoryBadge(cat.key)}<span>${cat.label}</span><strong>${p.counts[cat.key]}</strong></li>`).join('')}
      </ul>
      <div class="sum-acpl">Perte moyenne : <strong>${p.acpl ?? '–'}</strong> cp</div>
    </div>`;
  };
  out.innerHTML = `<div class="sum-grid">${col('w')}${col('b')}</div>
    <p class="muted small">Analyse Stockfish à la profondeur ${an.depth}. Précision calculée à partir de la perte de probabilité de gain à chaque coup.</p>`;
  renderPlayers();
}

function renderGraph() {
  if (!graph) return;
  if (state.report) graph.set(state.report.wins, state.report.moves.map((m) => m.category), state.ply);
  else graph.set(null, null, state.ply);
}

function renderEvalBar(ev) {
  const fill = $('#eval-fill');
  const label = $('#eval-label');
  const bar = $('#eval-bar');
  bar.classList.toggle('flipped', state.flipped);
  if (!ev) {
    fill.style.height = '50%';
    label.textContent = '–';
    bar.classList.remove('black-better');
    return;
  }
  const w = winPercent(ev.cp);
  fill.style.height = `${w.toFixed(1)}%`;
  label.textContent = formatEval(ev).replace(/^\+/, '');
  bar.classList.toggle('black-better', ev.cp < 0);
}

/** Évaluation, meilleur coup et ligne principale pour la position courante. */
function currentEngineInfo() {
  const an = state.analyses[state.currentId];
  const fen = state.game.fens[state.ply];
  if (an && an.evals && an.evals[state.ply]) {
    return { eval: an.evals[state.ply], bestmove: an.best[state.ply], pv: an.pv[state.ply] || [], depth: an.depth, fen };
  }
  if (state.live.result && state.live.fen === fen) return { ...state.live.result, fen };
  return null;
}

function renderEngine() {
  const info = currentEngineInfo();
  const fen = state.game.fens[state.ply];
  const evEl = $('#engine-eval');
  const pvEl = $('#engine-pv');
  const chess = new Chess(fen);
  if (chess.isGameOver()) {
    const txt = chess.isCheckmate() ? 'Échec et mat.' : chess.isStalemate() ? 'Pat : partie nulle.' : 'Partie nulle.';
    evEl.textContent = info ? formatEval(info.eval) : '–';
    pvEl.textContent = txt;
    renderEvalBar(info ? info.eval : null);
    return null;
  }
  if (!info) {
    evEl.textContent = '…';
    pvEl.innerHTML = engine && !state.analyzing ? '<span class="muted">Calcul en cours…</span>' : '<span class="muted">Aucune analyse pour cette position.</span>';
    renderEvalBar(null);
    return null;
  }
  evEl.textContent = formatEval(info.eval);
  evEl.className = 'engine-eval ' + (info.eval.cp >= 0 ? 'w' : 'b');
  const pvText = info.pv && info.pv.length ? line(formatLine(fen, info.pv, 10)) : (info.bestmove ? line(uciToSan(fen, info.bestmove)) : '');
  pvEl.innerHTML = `<span class="muted small">prof. ${info.depth || '?'}</span> ${escapeHtml(pvText)}`;
  renderEvalBar(info.eval);
  return info;
}

function renderMoveComment() {
  const el = $('#move-comment');
  const rep = state.report;
  if (state.ply === 0) {
    el.innerHTML = '<span class="muted">Position initiale. Utilisez ← → pour naviguer.</span>';
    return;
  }
  const m = state.game.moves[state.ply - 1];
  const moveNo = Math.floor((state.ply - 1) / 2) + (parseInt(state.game.fens[0].split(' ')[5], 10) || 1) - (state.game.moves[0].color === 'b' ? 0 : 0);
  const fenParts = m.before.split(' ');
  const no = parseInt(fenParts[5], 10) || moveNo;
  const label = `${no}${m.color === 'w' ? '.' : '…'} ${san(m.san)}`;
  if (!rep) {
    el.innerHTML = `<strong>${escapeHtml(label)}</strong> <span class="muted">— analysez la partie pour évaluer ce coup.</span>`;
    return;
  }
  const r = rep.moves[state.ply - 1];
  const c = CATEGORY_BY_KEY[r.category];
  let txt = `${categoryBadge(r.category)} <strong>${escapeHtml(label)}</strong> : <span class="cat-text-${r.category}">${c.label}</span>`;
  if (r.isBest) txt += ' — <span class="muted">meilleur coup selon le moteur.</span>';
  else if (r.winLoss >= 0.5) txt += ` <span class="muted">(−${r.winLoss.toFixed(1)} % de chances de gain)</span>`;
  if (!r.isBest && r.bestUci && ['imprecision', 'erreur', 'gaffe', 'bon'].includes(r.category)) {
    const best = uciToSan(m.before, r.bestUci);
    txt += `<div class="best-hint">Le meilleur coup était <strong>${escapeHtml(san(best))}</strong>.</div>`;
  }
  el.innerHTML = txt;
}

function goto(ply, { force = false } = {}) {
  if (!state.game) return;
  const n = state.game.moves.length;
  ply = Math.max(0, Math.min(n, ply));
  if (ply === state.ply && !force) return;
  state.ply = ply;
  const fen = state.game.fens[ply];
  const last = ply > 0 ? state.game.moves[ply - 1] : null;
  const chess = new Chess(fen);
  const info = currentEngineInfo();
  const best = info && info.bestmove;
  const rep = state.report;
  board.set({
    fen,
    lastMove: last ? { from: last.from, to: last.to } : null,
    arrow: best ? { from: best.slice(0, 2), to: best.slice(2, 4) } : null,
    badge: rep && ply > 0 ? CATEGORY_BY_KEY[rep.moves[ply - 1].category] : null,
    inCheck: chess.inCheck(),
  });
  renderPlayers();
  renderEngine();
  renderMoveComment();
  // surbrillance dans la liste des coups
  $$('#move-list .mv.active').forEach((b) => b.classList.remove('active'));
  const btn = $(`#move-list .mv[data-ply="${ply}"]`);
  if (btn) {
    btn.classList.add('active');
    const list = $('#move-list');
    const top = btn.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + btn.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 2;
    }
  }
  const moveNo = last ? `${parseInt(last.before.split(' ')[5], 10)}${last.color === 'w' ? '.' : '…'} ${san(last.san)}` : 'Position initiale';
  $('#ply-indicator').textContent = moveNo;
  if (graph) graph.setCurrent(ply);
  if (!info) refreshLive();
}

// ---------------------------------------------------------------- analyse « en direct » de la position courante
function refreshLive() {
  if (!engine || !state.game || state.analyzing) return;
  const fen = state.game.fens[state.ply];
  const an = state.analyses[state.currentId];
  if (an && an.evals && an.evals[state.ply]) return;
  if (new Chess(fen).isGameOver()) return;
  if (state.live.fen === fen && state.live.result) return;
  state.live.wanted = fen;
  if (state.live.busy) {
    engine.stop();
    return;
  }
  runLive();
}

async function runLive() {
  state.live.busy = true;
  try {
    while (state.live.wanted && !state.analyzing) {
      const fen = state.live.wanted;
      state.live.wanted = null;
      const depth = Math.min(settings.depth, 16);
      const res = await engine.analyze(fen, {
        depth,
        onInfo: (partial) => {
          if (state.live.wanted || !state.game || state.game.fens[state.ply] !== fen) return;
          if (partial.depth >= 6 && partial.pv.length) {
            state.live.result = { eval: partial.eval, bestmove: partial.pv[0], pv: partial.pv, depth: partial.depth };
            state.live.fen = fen;
            throttledLiveRender();
          }
        },
      });
      if (!state.live.wanted && state.game && state.game.fens[state.ply] === fen) {
        state.live.result = res;
        state.live.fen = fen;
        goto(state.ply, { force: true });
      }
    }
  } catch (e) {
    console.warn(e);
  } finally {
    state.live.busy = false;
  }
}

let liveRenderPending = false;
function throttledLiveRender() {
  if (liveRenderPending) return;
  liveRenderPending = true;
  setTimeout(() => {
    liveRenderPending = false;
    if (state.game && !state.analyzing) goto(state.ply, { force: true });
  }, 250);
}

// ---------------------------------------------------------------- analyse complète
function terminalEval(fen) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { cp: c.turn() === 'w' ? -10000 : 10000, mate: 0 };
  if (c.isStalemate() || c.isInsufficientMaterial() || c.isDrawByFiftyMoves() || c.isThreefoldRepetition()) {
    return { cp: 0, mate: null };
  }
  return null;
}

async function analyzeGame() {
  if (!state.game) return;
  if (state.analyzing) {
    state.cancelAnalysis = true;
    engine.stop();
    return;
  }
  if (!engine) {
    alert('Le moteur Stockfish n’est pas disponible dans ce navigateur.');
    return;
  }
  const btn = $('#btn-analyze');
  const id = state.currentId;
  const fens = state.game.fens;
  const depth = settings.depth;
  state.analyzing = true;
  state.cancelAnalysis = false;
  state.live.wanted = null;
  engine.stop();
  btn.textContent = 'Arrêter l’analyse';
  btn.classList.add('danger');
  $('#depth-select').disabled = true;
  $('#progress').classList.remove('hidden');
  const fill = $('#progress-fill');
  const text = $('#progress-text');
  const an = { depth, evals: [], best: [], pv: [] };
  const t0 = performance.now();
  try {
    await engine.ready;
    await engine.newGame();
    for (let i = 0; i < fens.length; i++) {
      if (state.cancelAnalysis) break;
      const term = terminalEval(fens[i]);
      if (term && new Chess(fens[i]).isGameOver()) {
        an.evals[i] = term;
        an.best[i] = null;
        an.pv[i] = [];
      } else {
        const res = await engine.analyze(fens[i], { depth });
        if (state.cancelAnalysis) break;
        an.evals[i] = res.eval;
        an.best[i] = res.bestmove;
        an.pv[i] = (res.pv || []).slice(0, 12);
      }
      const pct = ((i + 1) / fens.length) * 100;
      fill.style.width = `${pct.toFixed(1)}%`;
      const elapsed = (performance.now() - t0) / 1000;
      const remaining = (elapsed / (i + 1)) * (fens.length - i - 1);
      text.textContent = `${Math.round(pct)} % — position ${i + 1}/${fens.length}${i > 2 ? ` — encore ~${Math.ceil(remaining)} s` : ''}`;
    }
    if (!state.cancelAnalysis && an.evals.length === fens.length) {
      state.analyses[id] = an;
      persistAnalyses();
      if (state.currentId === id) {
        computeReport();
        renderMoveList();
        renderSummary();
        renderGraph();
        goto(state.ply, { force: true });
      }
      text.textContent = `Analyse terminée en ${((performance.now() - t0) / 1000).toFixed(1)} s.`;
    } else {
      text.textContent = 'Analyse interrompue.';
    }
  } catch (e) {
    console.error(e);
    text.textContent = 'Erreur pendant l’analyse : ' + (e.message || e);
  } finally {
    state.analyzing = false;
    state.cancelAnalysis = false;
    btn.textContent = state.analyses[state.currentId] ? 'Relancer l’analyse' : 'Analyser la partie';
    btn.classList.remove('danger');
    $('#depth-select').disabled = false;
    setTimeout(() => {
      if (!state.analyzing) $('#progress').classList.add('hidden');
    }, 4000);
    refreshLive();
  }
}

// ---------------------------------------------------------------- compte / synchronisation
function accountDisplayNames() {
  const a = settings.account;
  const names = [];
  if (a.chesscomOn && a.chesscom.trim()) names.push(a.chesscom.trim());
  if (a.lichessOn && a.lichess.trim()) names.push(a.lichess.trim());
  return [...new Map(names.map((n) => [n.toLowerCase(), n])).values()];
}
function accountNames() {
  return accountDisplayNames().map((n) => n.toLowerCase());
}
function accountConfigured() {
  return accountNames().length > 0;
}

function renderAccountForm() {
  const a = settings.account;
  $('#acc-chesscom-on').checked = a.chesscomOn;
  $('#acc-chesscom').value = a.chesscom;
  $('#acc-chesscom-months').value = a.chesscomMonths;
  $('#acc-lichess-on').checked = a.lichessOn;
  $('#acc-lichess').value = a.lichess;
  $('#acc-lichess-max').value = a.lichessMax;
  $('#acc-lichess-token').value = a.lichessToken;
  $('#acc-autosync').checked = a.autoSync;
  updateSyncInfo();
}

function updateSyncInfo() {
  const a = settings.account;
  $('#sync-last').textContent = a.lastSync
    ? `Dernière synchronisation : ${new Date(a.lastSync).toLocaleString('fr-FR')}`
    : 'Aucune synchronisation pour le moment.';
  $('#btn-sync-top').classList.toggle('hidden', !accountConfigured());
}

function readAccountForm() {
  const clampInt = (v, lo, hi, d) => Math.max(lo, Math.min(hi, parseInt(v, 10) || d));
  const a = settings.account;
  a.chesscom = $('#acc-chesscom').value.trim();
  a.lichess = $('#acc-lichess').value.trim();
  a.chesscomOn = $('#acc-chesscom-on').checked && !!a.chesscom;
  a.lichessOn = $('#acc-lichess-on').checked && !!a.lichess;
  a.chesscomMonths = clampInt($('#acc-chesscom-months').value, 1, 24, 3);
  a.lichessMax = clampInt($('#acc-lichess-max').value, 1, 300, 50);
  a.lichessToken = $('#acc-lichess-token').value.trim();
  a.autoSync = $('#acc-autosync').checked;
}

function validateAccount() {
  const a = settings.account;
  const re = /^[A-Za-z0-9_-]{2,30}$/;
  if (a.chesscom && !re.test(a.chesscom)) return 'Pseudo Chess.com invalide (lettres, chiffres, « _ » et « - »).';
  if (a.lichess && !re.test(a.lichess)) return 'Pseudo Lichess invalide (lettres, chiffres, « _ » et « - »).';
  return null;
}

let syncing = false;
async function syncAccount({ auto = false } = {}) {
  const status = $('#sync-status');
  if (syncing) return;
  if (!accountConfigured()) {
    if (!auto) setStatus(status, 'Renseignez d’abord un pseudo Chess.com ou Lichess, puis enregistrez.', 'err');
    return;
  }
  syncing = true;
  const btns = [$('#btn-sync'), $('#btn-sync-top')];
  btns.forEach((b) => (b.disabled = true));
  $('#btn-sync-top').textContent = '⟳ Synchronisation…';
  setStatus(status, '<span class="spinner"></span> Synchronisation en cours…', 'info');
  const a = settings.account;
  const lines = [];
  let errors = 0;
  let totalAdded = 0;
  const jobs = [];
  if (a.chesscomOn && a.chesscom) {
    jobs.push(['Chess.com', 'chesscom', () => fetchChessCom(a.chesscom, { months: a.chesscomMonths, max: 300 })]);
  }
  if (a.lichessOn && a.lichess) {
    jobs.push(['Lichess', 'lichess', () => fetchLichess(a.lichess, { max: a.lichessMax, token: a.lichessToken })]);
  }
  for (const [label, source, run] of jobs) {
    try {
      const { pgns, skipped } = await run();
      const { games, errors: perr } = parseMany(pgns.join('\n\n'));
      const { added } = addParsedGames(games, source);
      totalAdded += added;
      let l = `<strong>${label}</strong> : ${games.length} partie(s) récupérée(s), ${added} nouvelle(s)`;
      if (games.length - added > 0) l += `, ${games.length - added} déjà importée(s)`;
      if (skipped) l += `, ${skipped} variante(s) ignorée(s)`;
      if (perr.length) l += `, ${perr.length} illisible(s)`;
      lines.push(l + '.');
    } catch (e) {
      errors++;
      lines.push(`<strong>${label}</strong> : ${escapeHtml(e.message || 'erreur inconnue.')}`);
    }
  }
  if (errors < jobs.length) {
    a.lastSync = Date.now();
    saveSettings();
  }
  setStatus(status, lines.join('<br>'), errors === jobs.length ? 'err' : errors ? 'warn' : 'ok');
  updateSyncInfo();
  updateLibCount();
  if ($('#tab-bibliotheque').classList.contains('active')) renderLibrary();
  if ($('#tab-stats').classList.contains('active')) renderStats();
  if (!state.currentId && state.games.length) openGame(state.games[0].id, 0, { switchTab: false });
  else if (state.currentId) applyOrientation();
  if (auto && (totalAdded || errors)) {
    showToast(errors
      ? 'Synchronisation : certaines parties n’ont pas pu être récupérées (voir « Mon compte »).'
      : `Synchronisation : ${totalAdded} nouvelle(s) partie(s) importée(s).`, errors ? 'warn' : 'ok');
  }
  btns.forEach((b) => (b.disabled = false));
  $('#btn-sync-top').textContent = '⟳ Synchroniser';
  syncing = false;
}

let toastTimer = null;
function showToast(msg, kind = 'info') {
  const t = $('#toast');
  t.className = `toast show ${kind}`;
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 6000);
}

// ---------------------------------------------------------------- statistiques
function renderStatsForm() {
  const names = playerNames(state.games);
  $('#players-list').innerHTML = names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');
  const input = $('#stats-user');
  if (!input.value) {
    const mine = accountDisplayNames();
    input.value = mine.length ? mine.join(', ') : settings.statsUser || '';
  }
  if (input.value) renderStats();
  else $('#stats-out').innerHTML = '';
}

function pct(n, d) {
  return d ? Math.round((n / d) * 100) : 0;
}

function wdlBar(b) {
  if (!b.total) return '<div class="wdl-bar empty"></div>';
  return `<div class="wdl-bar">
    <span class="seg win" style="width:${(b.victoire / b.total) * 100}%" title="Victoires"></span>
    <span class="seg draw" style="width:${(b.nul / b.total) * 100}%" title="Nulles"></span>
    <span class="seg loss" style="width:${(b.defaite / b.total) * 100}%" title="Défaites"></span>
  </div>`;
}

function renderStats() {
  const user = $('#stats-user').value.trim();
  const out = $('#stats-out');
  if (!user) {
    out.innerHTML = '<div class="status err">Saisissez un nom d’utilisateur.</div>';
    return;
  }
  settings.statsUser = user;
  saveSettings();
  const s = computeStats(state.games, user);
  if (!s.games) {
    out.innerHTML = `<div class="status warn">Aucune partie importée ne concerne « ${escapeHtml(user)} ». Importez des parties depuis l’onglet « Importer » (par exemple via Lichess ou Chess.com).</div>`;
    return;
  }
  const t = s.total;
  const score = scorePercent(t);
  const colorRow = (label, b, cls) => `<tr>
    <td><span class="pb-color ${cls}"></span>${label}</td>
    <td>${b.total}</td><td>${b.victoire}</td><td>${b.nul}</td><td>${b.defaite}</td>
    <td>${b.total ? scorePercent(b).toFixed(0) + ' %' : '–'}</td>
    <td class="bar-cell hide-m">${wdlBar(b)}</td></tr>`;
  const openings = s.openingList.slice(0, 12).map((o) => `<tr>
    <td>${o.eco ? `<span class="eco">${escapeHtml(o.eco)}</span>` : ''}${escapeHtml(o.name)}</td>
    <td>${o.all.total}</td>
    <td class="nowrap">${o.all.victoire}/${o.all.nul}/${o.all.defaite}</td>
    <td class="hide-m">${o.w.total ? scorePercent(o.w).toFixed(0) + ' %' : '–'}</td>
    <td class="hide-m">${o.b.total ? scorePercent(o.b).toFixed(0) + ' %' : '–'}</td>
    <td><strong>${scorePercent(o.all).toFixed(0)} %</strong></td>
    <td class="bar-cell hide-m">${wdlBar(o.all)}</td></tr>`).join('');
  out.innerHTML = `
    <div class="stats-kpis">
      <div class="card kpi"><div class="kpi-value">${s.games}</div><div class="kpi-label">parties</div></div>
      <div class="card kpi win"><div class="kpi-value">${t.victoire}</div><div class="kpi-label">victoires (${pct(t.victoire, t.total)} %)</div></div>
      <div class="card kpi draw"><div class="kpi-value">${t.nul}</div><div class="kpi-label">nulles (${pct(t.nul, t.total)} %)</div></div>
      <div class="card kpi loss"><div class="kpi-value">${t.defaite}</div><div class="kpi-label">défaites (${pct(t.defaite, t.total)} %)</div></div>
      <div class="card kpi"><div class="kpi-value">${score === null ? '–' : score.toFixed(0) + ' %'}</div><div class="kpi-label">score</div></div>
    </div>
    ${s.unknownResults ? `<p class="muted small">${s.unknownResults} partie(s) sans résultat connu non comptabilisée(s).</p>` : ''}
    <div class="card">
      <div class="card-title">Résultats par couleur</div>
      <table class="table">
        <thead><tr><th>Couleur</th><th>Parties</th><th>V</th><th>N</th><th>D</th><th>Score</th><th class="hide-m"></th></tr></thead>
        <tbody>${colorRow('Blancs', s.w, 'white')}${colorRow('Noirs', s.b, 'black')}</tbody>
      </table>
    </div>
    <div class="card">
      <div class="card-title">Ouvertures les plus jouées</div>
      <table class="table">
        <thead><tr><th>Ouverture</th><th>Parties</th><th class="nowrap">V/N/D</th><th class="hide-m">Score Blancs</th><th class="hide-m">Score Noirs</th><th>Score</th><th class="hide-m"></th></tr></thead>
        <tbody>${openings}</tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------- thème
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  if (graph) graph.draw();
}

// ---------------------------------------------------------------- initialisation
// Téléphone : glisser horizontalement sur l'échiquier pour changer de coup.
function bindSwipe(el) {
  let x0 = null, y0 = null, t0 = 0;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 === null || !state.game) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 35 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - t0 > 800) return;
    // gauche → coup suivant (comme tourner une page) ; droite → coup précédent
    goto(state.ply + (dx < 0 ? 1 : -1));
  }, { passive: true });
}

function bindEvents() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  bindSwipe($('#board'));
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-goto-tab]');
    if (t) showTab(t.dataset.gotoTab);
    const s = e.target.closest('[data-action="load-sample"]');
    if (s) loadSample();
    const o = e.target.closest('[data-open]');
    if (o) openGame(o.dataset.open);
    const d = e.target.closest('[data-del]');
    if (d && confirm('Supprimer cette partie et son analyse ?')) deleteGame(d.dataset.del);
    const mv = e.target.closest('#move-list .mv[data-ply]');
    if (mv) goto(parseInt(mv.dataset.ply, 10));
  });

  $('#btn-start').addEventListener('click', () => goto(0));
  $('#btn-prev').addEventListener('click', () => goto(state.ply - 1));
  $('#btn-next').addEventListener('click', () => goto(state.ply + 1));
  $('#btn-end').addEventListener('click', () => goto(Infinity));
  $('#btn-flip').addEventListener('click', flip);
  $('#btn-analyze').addEventListener('click', analyzeGame);

  const depthSel = $('#depth-select');
  if (![...depthSel.options].some((o) => +o.value === +settings.depth)) settings.depth = 14;
  depthSel.value = String(settings.depth);
  depthSel.addEventListener('change', () => {
    settings.depth = parseInt(depthSel.value, 10);
    saveSettings();
  });

  document.addEventListener('keydown', (e) => {
    if (!$('#tab-analyse').classList.contains('active') || !state.game) return;
    if (e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    const map = {
      ArrowLeft: () => goto(state.ply - 1),
      ArrowRight: () => goto(state.ply + 1),
      ArrowUp: () => goto(0),
      Home: () => goto(0),
      ArrowDown: () => goto(Infinity),
      End: () => goto(Infinity),
      f: flip,
      F: flip,
    };
    if (map[e.key]) {
      e.preventDefault();
      map[e.key]();
    }
  });

  $('#btn-import-paste').addEventListener('click', () => {
    const text = $('#pgn-input').value;
    if (!text.trim()) {
      setStatus($('#import-status'), 'Collez d’abord le texte PGN d’une ou plusieurs parties.', 'err');
      return;
    }
    handleImportText(text, 'collé');
  });
  $('#file-input').addEventListener('change', (e) => {
    readFiles(e.target.files);
    e.target.value = '';
  });
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault();
    dz.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault();
    dz.classList.remove('drag');
  }));
  dz.addEventListener('drop', (e) => readFiles(e.dataTransfer.files));
  $('#btn-lichess').addEventListener('click', () => importOnline('lichess'));
  $('#btn-chesscom').addEventListener('click', () => importOnline('chesscom'));
  $('#online-user').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') importOnline('lichess');
  });

  $('#lib-filter').addEventListener('input', renderLibrary);
  $('#btn-clear-all').addEventListener('click', () => {
    if (!state.games.length) return;
    if (!confirm('Effacer toutes les parties et analyses enregistrées ?')) return;
    state.games.slice().forEach((g) => deleteGame(g.id));
    store.clearAll();
    renderLibrary();
  });

  $('#btn-stats').addEventListener('click', renderStats);
  $('#account-form').addEventListener('submit', (e) => {
    e.preventDefault();
    readAccountForm();
    const err = validateAccount();
    if (err) {
      setStatus($('#sync-status'), err, 'err');
      return;
    }
    saveSettings();
    renderAccountForm();
    applyOrientation();
    $('#stats-user').value = '';
    setStatus($('#sync-status'), accountConfigured()
      ? 'Compte enregistré. Cliquez sur « Synchroniser maintenant » pour importer vos parties.'
      : 'Réglages enregistrés (aucun pseudo actif).', 'ok');
    if (accountConfigured()) syncAccount();
  });
  $('#btn-sync').addEventListener('click', () => {
    readAccountForm();
    const err = validateAccount();
    if (err) {
      setStatus($('#sync-status'), err, 'err');
      return;
    }
    saveSettings();
    updateSyncInfo();
    syncAccount();
  });
  $('#btn-sync-top').addEventListener('click', () => syncAccount());
  [['#acc-chesscom', '#acc-chesscom-on'], ['#acc-lichess', '#acc-lichess-on']].forEach(([inp, chk]) => {
    $(inp).addEventListener('input', () => {
      $(chk).checked = !!$(inp).value.trim();
    });
  });
  $('#stats-user').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') renderStats();
  });

  $('#theme-toggle').addEventListener('click', () => {
    settings.theme = settings.theme === 'sombre' ? 'clair' : 'sombre';
    saveSettings();
    applyTheme();
  });

  const fr = $('#fr-notation');
  if (fr) {
    fr.checked = settings.frNotation;
    fr.addEventListener('change', () => {
      settings.frNotation = fr.checked;
      saveSettings();
      if (state.game) {
        renderMoveList();
        goto(state.ply, { force: true });
      }
    });
  }
}

function flip() {
  if (!state.game) return;
  state.flipped = !state.flipped;
  board.setFlipped(state.flipped);
  renderPlayers();
  renderEvalBar(currentEngineInfo() ? currentEngineInfo().eval : null);
}

function init() {
  applyTheme();
  board = new Board($('#board'));
  graph = new EvalGraph($('#eval-graph'), (ply) => goto(ply));
  bindEvents();
  updateLibCount();
  initEngine();
  renderAccountForm();
  if (state.games.length) {
    const lastId = settings.lastGame && state.games.some((g) => g.id === settings.lastGame) ? settings.lastGame : state.games[0].id;
    openGame(lastId);
  }
  if (accountConfigured() && settings.account.autoSync) syncAccount({ auto: true });
  // mémorise la dernière partie ouverte (pagehide : seul événement fiable sur iPhone)
  const rememberGame = () => {
    settings.lastGame = state.currentId;
    saveSettings();
  };
  window.addEventListener('beforeunload', rememberGame);
  window.addEventListener('pagehide', rememberGame);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') rememberGame();
  });
  initInstallable();
}

// Appli installable : service worker (hors ligne) + aide à l'installation sur iPhone/iPad.
function initInstallable() {
  const isHttp = location.protocol === 'https:' || location.protocol === 'http:';
  if (isHttp && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker non enregistré', e));
  }
  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  let dismissed = false;
  try { dismissed = localStorage.getItem('fdr-install-dismissed') === '1'; } catch {}
  const banner = $('#install-banner');
  if (!banner) return;
  if (isHttp && isIos && !standalone && !dismissed) banner.classList.remove('hidden');
  $('#install-banner-close').addEventListener('click', () => {
    banner.classList.add('hidden');
    try { localStorage.setItem('fdr-install-dismissed', '1'); } catch {}
  });
}

// Exposé pour le débogage et les tests automatisés.
window.__fdr = { state, settings };

init();
