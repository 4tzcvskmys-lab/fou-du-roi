// Persistance dans le localStorage.

const KEY_GAMES = 'fdr.games.v1';
const KEY_ANALYSES = 'fdr.analyses.v1';
const KEY_SETTINGS = 'fdr.settings.v1';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('Stockage local impossible :', e);
    return false;
  }
}

export const store = {
  loadGames() {
    return read(KEY_GAMES, []);
  },
  saveGames(games) {
    return write(KEY_GAMES, games);
  },
  loadAnalyses() {
    return read(KEY_ANALYSES, {});
  },
  saveAnalyses(analyses) {
    return write(KEY_ANALYSES, analyses);
  },
  loadSettings() {
    return read(KEY_SETTINGS, {});
  },
  saveSettings(s) {
    return write(KEY_SETTINGS, s);
  },
  clearAll() {
    localStorage.removeItem(KEY_GAMES);
    localStorage.removeItem(KEY_ANALYSES);
  },
};
