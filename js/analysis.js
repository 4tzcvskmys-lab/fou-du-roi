// Calculs d'analyse : probabilité de gain, classification des coups, précision, perte moyenne.

export const CATEGORIES = [
  { key: 'excellent', label: 'Excellent', icon: '✦', max: 2 },
  { key: 'bon', label: 'Bon', icon: '✓', max: 5 },
  { key: 'imprecision', label: 'Imprécision', icon: '?!', max: 10 },
  { key: 'erreur', label: 'Erreur', icon: '?', max: 20 },
  { key: 'gaffe', label: 'Gaffe', icon: '??', max: Infinity },
];
export const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

const CP_CEIL = 1000;

/** Probabilité de gain (0..100) pour les Blancs à partir d'un score en centipions. */
export function winPercent(cp) {
  const c = Math.max(-CP_CEIL, Math.min(CP_CEIL, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

/** Précision d'un coup (0..100) à partir de la perte de probabilité de gain. */
export function moveAccuracy(winLoss) {
  const a = 103.1668100711649 * Math.exp(-0.04354415386753951 * Math.max(0, winLoss)) - 3.166924740191411;
  return Math.max(0, Math.min(100, a));
}

export function classify(winLoss) {
  for (const c of CATEGORIES) if (winLoss < c.max) return c.key;
  return 'gaffe';
}

/** Formate une évaluation pour l'affichage (point de vue des Blancs). */
export function formatEval(ev) {
  if (!ev) return '–';
  if (ev.mate !== null && ev.mate !== undefined) {
    if (ev.mate === 0) return ev.cp > 0 ? '1-0' : '0-1';
    return (ev.mate > 0 ? '+' : '−') + 'M' + Math.abs(ev.mate);
  }
  const v = ev.cp / 100;
  if (Math.abs(v) < 0.005) return '0.00';
  return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(2);
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function stdev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
}
function weightedMean(pairs) {
  const tw = pairs.reduce((a, [, w]) => a + w, 0);
  return tw ? pairs.reduce((a, [v, w]) => a + v * w, 0) / tw : 0;
}
function harmonicMean(arr) {
  if (!arr.length) return 0;
  const s = arr.reduce((a, v) => a + 1 / Math.max(v, 0.01), 0);
  return arr.length / s;
}

/**
 * Construit le rapport complet à partir des positions et des évaluations.
 * game: { fens, moves }, an: { evals: [n+1], best: [n+1], pv: [n+1] }
 */
export function buildReport(game, an) {
  const n = game.moves.length;
  const wins = an.evals.map((e) => winPercent(e.cp));
  const moves = [];
  for (let i = 0; i < n; i++) {
    const mv = game.moves[i];
    const white = mv.color === 'w';
    const before = an.evals[i];
    const after = an.evals[i + 1];
    const wBefore = white ? wins[i] : 100 - wins[i];
    const wAfter = white ? wins[i + 1] : 100 - wins[i + 1];
    const winLoss = Math.max(0, wBefore - wAfter);
    const clampCp = (cp) => Math.max(-CP_CEIL, Math.min(CP_CEIL, cp));
    const cpBefore = clampCp(white ? before.cp : -before.cp);
    const cpAfter = clampCp(white ? after.cp : -after.cp);
    const cpLoss = Math.max(0, cpBefore - cpAfter);
    const playedUci = mv.from + mv.to + (mv.promotion || '');
    const isBest = an.best[i] === playedUci;
    const cat = isBest ? 'excellent' : classify(winLoss);
    moves.push({
      ply: i + 1,
      color: mv.color,
      winLoss,
      cpLoss,
      accuracy: moveAccuracy(winLoss),
      category: cat,
      isBest,
      bestUci: an.best[i],
    });
  }

  // Précision « partie » : moyenne pondérée par la volatilité + moyenne harmonique.
  const windowSize = Math.max(2, Math.min(8, Math.floor(n / 10)));
  const windows = [];
  const allWins = wins.slice(0, n + 1);
  if (allWins.length >= windowSize) {
    const first = allWins.slice(0, windowSize);
    for (let k = 0; k < Math.min(windowSize - 2, n); k++) windows.push(first);
    for (let k = 0; k + windowSize <= allWins.length; k++) windows.push(allWins.slice(k, k + windowSize));
  }
  const weights = moves.map((_, i) => {
    const w = windows[i] ? stdev(windows[i]) : 0.5;
    return Math.max(0.5, Math.min(12, w));
  });

  const players = {};
  for (const color of ['w', 'b']) {
    const ms = moves.filter((m) => m.color === color);
    const idx = moves.map((m, i) => (m.color === color ? i : -1)).filter((i) => i >= 0);
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c.key, 0]));
    ms.forEach((m) => counts[m.category]++);
    let accuracy = null;
    if (ms.length) {
      const wm = weightedMean(idx.map((i) => [moves[i].accuracy, weights[i]]));
      const hm = harmonicMean(ms.map((m) => m.accuracy));
      accuracy = (wm + hm) / 2;
    }
    players[color] = {
      moves: ms.length,
      accuracy,
      acpl: ms.length ? Math.round(mean(ms.map((m) => m.cpLoss))) : null,
      counts,
    };
  }
  return { moves, players, wins };
}
