// Découpage et lecture de fichiers PGN (une ou plusieurs parties).
import { Chess } from '../vendor/chess.js/chess.js';

/**
 * Découpe un texte PGN contenant plusieurs parties.
 * Une nouvelle partie commence lorsqu'une ligne d'en-tête « [ » apparaît
 * après que du texte de coups a été rencontré.
 */
export function splitPgn(text) {
  const lines = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const games = [];
  let current = [];
  let seenMoves = false;
  let inComment = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inComment && trimmed.startsWith('[') && seenMoves) {
      if (current.join('').trim()) games.push(current.join('\n').trim());
      current = [];
      seenMoves = false;
    }
    current.push(line);
    if (!inComment && !trimmed.startsWith('[') && trimmed !== '' && !trimmed.startsWith('%')) {
      seenMoves = true;
    }
    // suivi grossier des commentaires multilignes { ... }
    for (const ch of line) {
      if (ch === '{') inComment = true;
      else if (ch === '}') inComment = false;
    }
  }
  if (current.join('').trim()) games.push(current.join('\n').trim());
  return games;
}

/** Hachage simple (djb2) pour dédoublonner les parties. */
export function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Normalise le texte des coups pour un identifiant stable. */
function canonicalKey(headers, sanMoves) {
  return [headers.White, headers.Black, headers.Date, headers.Site, sanMoves.join(' ')].join('|');
}

/**
 * Lit une partie PGN. Retourne { pgn, headers, sans, id } ou lève une erreur en français.
 */
export function parseGame(pgn) {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch (e) {
    throw new Error('PGN invalide : ' + traduireErreur(e && e.message));
  }
  const headers = chess.getHeaders();
  const sans = chess.history();
  if (sans.length === 0) throw new Error('La partie ne contient aucun coup.');
  const url = gameUrl(headers);
  return { pgn, headers, plies: sans.length, url, id: hashString(url || canonicalKey(headers, sans)) };
}

/**
 * Adresse unique de la partie si elle provient d'un site (Chess.com : en-tête Link ;
 * Lichess : en-tête Site ou GameId). Sert à éviter les doublons lors des synchronisations.
 */
export function gameUrl(headers) {
  if (headers.Link && /^https?:\/\//.test(headers.Link)) return headers.Link.replace(/^http:/, 'https:').replace(/\/$/, '');
  if (headers.Site && /lichess\.org\/\w{8}/.test(headers.Site)) {
    const m = /lichess\.org\/(\w{8})/.exec(headers.Site);
    return 'https://lichess.org/' + m[1];
  }
  if (headers.GameId) return 'https://lichess.org/' + headers.GameId;
  return null;
}

/** Lit toutes les parties d'un texte ; retourne { games, errors }. */
export function parseMany(text) {
  const chunks = splitPgn(text);
  const games = [];
  const errors = [];
  chunks.forEach((chunk, i) => {
    try {
      games.push(parseGame(chunk));
    } catch (e) {
      errors.push(`Partie n°${i + 1} : ${e.message}`);
    }
  });
  return { games, errors };
}

/**
 * Reconstitue toutes les positions d'une partie.
 * Retourne { fens: [n+1], moves: [n] (coups détaillés), headers }.
 */
export function buildPositions(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const moves = chess.history({ verbose: true }).map((m) => ({
    san: m.san,
    from: m.from,
    to: m.to,
    color: m.color,
    lan: m.lan,
    before: m.before,
    after: m.after,
    promotion: m.promotion,
  }));
  const fens = moves.length ? [moves[0].before, ...moves.map((m) => m.after)] : [chess.fen()];
  return { fens, moves, headers: chess.getHeaders() };
}

/** Convertit une suite de coups UCI en notation SAN depuis une position. */
export function uciLineToSan(fen, uciMoves, max = 12) {
  const chess = new Chess(fen);
  const out = [];
  for (const uci of uciMoves.slice(0, max)) {
    try {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
      out.push({ san: m.san, color: m.color, moveNumber: null, fenBefore: m.before });
    } catch {
      break;
    }
  }
  return out;
}

/** Formate une ligne (SAN) avec les numéros de coups, à partir d'un FEN. */
export function formatLine(fen, uciMoves, max = 12) {
  const parts = fen.split(' ');
  let moveNo = parseInt(parts[5], 10) || 1;
  const sans = uciLineToSan(fen, uciMoves, max);
  const out = [];
  sans.forEach((m, i) => {
    if (m.color === 'w') out.push(`${moveNo}.`);
    else if (i === 0) out.push(`${moveNo}…`);
    out.push(m.san);
    if (m.color === 'b') moveNo++;
  });
  return out.join(' ');
}

export function uciToSan(fen, uci) {
  const r = uciLineToSan(fen, [uci], 1);
  return r.length ? r[0].san : uci;
}

function traduireErreur(msg) {
  if (!msg) return 'format non reconnu.';
  const m = /Invalid move in PGN: (.+)/.exec(msg);
  if (m) return `coup illégal ou non reconnu « ${m[1]} ».`;
  if (/Invalid FEN/i.test(msg)) return 'position de départ (FEN) invalide.';
  const syn = /but "(.*?)" found/.exec(msg);
  if (/^Expected/.test(msg)) return syn ? `syntaxe PGN non reconnue près de « ${syn[1]} ».` : 'syntaxe PGN non reconnue.';
  return msg;
}

/** Nom d'ouverture : en-tête Opening, sinon ECOUrl (chess.com), sinon ECO. */
export function openingName(headers) {
  if (headers.Opening && headers.Opening !== '?') return headers.Opening;
  if (headers.ECOUrl) {
    const slug = headers.ECOUrl.split('/').pop() || '';
    const name = decodeURIComponent(slug).replace(/-/g, ' ').replace(/\s+\d.*$/, '').trim();
    if (name) return name;
  }
  if (headers.ECO && headers.ECO !== '?') return `ECO ${headers.ECO}`;
  return 'Ouverture inconnue';
}
