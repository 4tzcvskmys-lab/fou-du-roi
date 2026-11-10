// Récupération des parties récentes depuis les API publiques de Lichess et Chess.com.

const MAX_GAMES = 20;

function cleanUsername(u) {
  const name = String(u || '').trim();
  if (!name) throw new Error('Veuillez saisir un nom d’utilisateur.');
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(name)) {
    throw new Error('Nom d’utilisateur invalide (lettres, chiffres, « _ » et « - » uniquement).');
  }
  return name;
}

async function safeFetch(url, options, siteName) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error(`Impossible de contacter ${siteName}. Vérifiez votre connexion Internet (ou un éventuel blocage réseau).`);
  }
  return res;
}

function httpError(res, siteName, username) {
  if (res.status === 404) return new Error(`Utilisateur « ${username} » introuvable sur ${siteName}.`);
  if (res.status === 429) return new Error(`${siteName} limite le nombre de requêtes. Réessayez dans une minute.`);
  if (res.status >= 500) return new Error(`${siteName} est momentanément indisponible (erreur ${res.status}).`);
  return new Error(`Erreur ${res.status} lors de la requête vers ${siteName}.`);
}

/** Lichess : flux NDJSON des dernières parties. Retourne un tableau de textes PGN. */
export async function fetchLichess(username, { max = MAX_GAMES, token = '' } = {}) {
  const user = cleanUsername(username);
  const n = Math.max(1, Math.min(300, parseInt(max, 10) || MAX_GAMES));
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${n}&pgnInJson=true&opening=true&clocks=false&evals=false`;
  const headers = { Accept: 'application/x-ndjson' };
  // Jeton personnel facultatif (stocké uniquement en local) : donne accès aux parties privées.
  if (token && token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  const res = await safeFetch(url, { headers }, 'Lichess');
  if (res.status === 401) throw new Error('Le jeton Lichess est invalide ou expiré. Corrigez-le ou laissez le champ vide.');
  if (!res.ok) throw httpError(res, 'Lichess', user);
  const text = await res.text();
  const pgns = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.variant && obj.variant !== 'standard' && obj.variant !== 'fromPosition') {
      skipped++;
      continue;
    }
    if (obj.pgn) pgns.push(obj.pgn);
  }
  if (!pgns.length) {
    throw new Error(skipped
      ? `Aucune partie d’échecs standard trouvée pour « ${user} » sur Lichess (variantes ignorées).`
      : `Aucune partie trouvée pour « ${user} » sur Lichess.`);
  }
  return { pgns, skipped };
}

/** Chess.com : liste des archives mensuelles, puis les plus récentes. */
export async function fetchChessCom(username, { months = 1, max = MAX_GAMES } = {}) {
  const nMonths = Math.max(1, Math.min(24, parseInt(months, 10) || 1));
  const maxGames = Math.max(1, Math.min(500, parseInt(max, 10) || MAX_GAMES));
  const user = cleanUsername(username).toLowerCase();
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`;
  const res = await safeFetch(base, {}, 'Chess.com');
  if (!res.ok) throw httpError(res, 'Chess.com', user);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('Réponse inattendue de Chess.com.');
  }
  const archives = Array.isArray(data.archives) ? data.archives : [];
  if (!archives.length) throw new Error(`Aucune archive de parties pour « ${user} » sur Chess.com.`);

  const games = [];
  let skipped = 0;
  // On parcourt les `nMonths` archives mensuelles les plus récentes (du plus récent
  // au plus ancien) ; si elles sont vides, on remonte jusqu'à 3 mois de plus.
  for (let k = 0, i = archives.length - 1; i >= 0; k++, i--) {
    if (games.length >= maxGames) break;
    if (k >= nMonths && (games.length > 0 || k >= nMonths + 3)) break;
    const r = await safeFetch(archives[i], {}, 'Chess.com');
    if (!r.ok) throw httpError(r, 'Chess.com', user);
    let month;
    try {
      month = await r.json();
    } catch {
      throw new Error('Réponse inattendue de Chess.com.');
    }
    const list = (month.games || []).slice().sort((a, b) => (b.end_time || 0) - (a.end_time || 0));
    for (const g of list) {
      if (games.length >= maxGames) break;
      if (g.rules && g.rules !== 'chess') {
        skipped++;
        continue;
      }
      if (g.pgn) games.push(g.pgn);
    }
  }
  if (!games.length) {
    throw new Error(skipped
      ? `Aucune partie d’échecs standard récente pour « ${user} » sur Chess.com (variantes ignorées).`
      : `Aucune partie récente trouvée pour « ${user} » sur Chess.com.`);
  }
  return { pgns: games, skipped };
}
