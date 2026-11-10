// Statistiques agrégées pour un joueur sur l'ensemble des parties importées.
import { openingName } from './pgn.js';

function resultFor(result, color) {
  if (result === '1/2-1/2') return 'nul';
  if (result === '1-0') return color === 'w' ? 'victoire' : 'defaite';
  if (result === '0-1') return color === 'b' ? 'victoire' : 'defaite';
  return null; // partie en cours / inconnue
}

/** Liste des noms de joueurs présents dans les parties (pour l'autocomplétion). */
export function playerNames(games) {
  const counts = new Map();
  for (const g of games) {
    for (const n of [g.headers.White, g.headers.Black]) {
      if (!n || n === '?') continue;
      counts.set(n, (counts.get(n) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

export function computeStats(games, username) {
  // plusieurs pseudos possibles, séparés par des virgules (ex. Chess.com + Lichess)
  const names = String(username || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const u = names.length ? names : null;
  const empty = () => ({ victoire: 0, nul: 0, defaite: 0, total: 0 });
  const stats = { total: empty(), w: empty(), b: empty(), openings: new Map(), unknownResults: 0, games: 0 };
  if (!u) return stats;
  for (const g of games) {
    const h = g.headers;
    let color = null;
    if (names.includes((h.White || '').toLowerCase())) color = 'w';
    else if (names.includes((h.Black || '').toLowerCase())) color = 'b';
    if (!color) continue;
    stats.games++;
    const r = resultFor(h.Result, color);
    if (!r) {
      stats.unknownResults++;
      continue;
    }
    for (const bucket of [stats.total, stats[color]]) {
      bucket[r]++;
      bucket.total++;
    }
    const name = openingName(h);
    if (!stats.openings.has(name)) stats.openings.set(name, { name, eco: h.ECO || '', w: empty(), b: empty(), all: empty() });
    const o = stats.openings.get(name);
    for (const bucket of [o.all, o[color]]) {
      bucket[r]++;
      bucket.total++;
    }
  }
  stats.openingList = [...stats.openings.values()].sort((a, b) => b.all.total - a.all.total || a.name.localeCompare(b.name));
  return stats;
}

export function scorePercent(bucket) {
  if (!bucket.total) return null;
  return ((bucket.victoire + bucket.nul * 0.5) / bucket.total) * 100;
}
