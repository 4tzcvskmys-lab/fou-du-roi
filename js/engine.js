// Enveloppe du moteur Stockfish (WASM mono-thread) exécuté dans un Web Worker.

// Dans la version « fichier unique », le moteur est fourni via une URL blob.
const ENGINE_PATH = globalThis.__FDR_ENGINE_URL__ || 'vendor/stockfish/stockfish-19-lite-single.js';
export const MATE_CP = 10000;

export class Engine {
  constructor(path = ENGINE_PATH) {
    this.path = path;
    this.worker = null;
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.busy = false;
    this.failed = null;
    this.ready = this._start();
    // Évite une « unhandled rejection » si personne n'attend encore le moteur.
    this.ready.catch(() => {});
  }

  _start() {
    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(this.path);
      } catch (e) {
        this.failed = e;
        reject(new Error('Impossible de démarrer le moteur Stockfish.'));
        return;
      }
      this.worker.onmessage = (e) => {
        const text = typeof e.data === 'string' ? e.data : String(e.data);
        for (const line of text.split('\n')) for (const l of [...this.listeners]) l(line);
      };
      this.worker.onerror = (e) => {
        this.failed = e;
        reject(new Error('Le moteur Stockfish a rencontré une erreur de chargement.'));
      };
      const timer = setTimeout(() => reject(new Error('Le moteur Stockfish ne répond pas (délai dépassé).')), 60000);
      this._waitFor((l) => l === 'uciok').then(() => {
        this.send('setoption name Hash value 32');
        this.send('isready');
        return this._waitFor((l) => l === 'readyok');
      }).then(() => {
        clearTimeout(timer);
        resolve();
      });
      this.send('uci');
    });
  }

  send(cmd) {
    this.worker && this.worker.postMessage(cmd);
  }

  _waitFor(pred) {
    return new Promise((resolve) => {
      const fn = (line) => {
        if (pred(line)) {
          this.listeners.delete(fn);
          resolve(line);
        }
      };
      this.listeners.add(fn);
    });
  }

  /** Interrompt la recherche en cours (le résultat partiel est renvoyé). */
  stop() {
    if (this.busy) this.send('stop');
  }

  /** Nouvelle partie : vide la table de hachage. */
  newGame() {
    this.queue = this.queue.then(async () => {
      await this.ready;
      this.send('ucinewgame');
      this.send('isready');
      await this._waitFor((l) => l === 'readyok');
    }).catch(() => {});
    return this.queue;
  }

  /**
   * Analyse une position. Retourne une promesse :
   * { eval: {cp, mate} (point de vue des Blancs), bestmove, pv: [uci], depth }
   * onInfo(partial) est appelé à chaque ligne « info » exploitable.
   */
  analyze(fen, { depth = 14, onInfo } = {}) {
    const job = this.queue.then(() => this._run(fen, depth, onInfo));
    this.queue = job.catch(() => {});
    return job;
  }

  async _run(fen, depth, onInfo) {
    await this.ready;
    const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
    const sign = turn === 'w' ? 1 : -1;
    let last = null;
    this.busy = true;
    const infoListener = (line) => {
      if (!line.startsWith('info') || line.indexOf(' score ') < 0) return;
      if (/ multipv (\d+)/.test(line) && !/ multipv 1 /.test(line)) return;
      const d = /\bdepth (\d+)/.exec(line);
      const sc = /\bscore (cp|mate) (-?\d+)/.exec(line);
      const pv = /\bpv (.+)$/.exec(line);
      if (!sc) return;
      const raw = parseInt(sc[2], 10);
      const ev = toWhiteEval(sc[1], raw, sign);
      last = {
        eval: ev,
        depth: d ? parseInt(d[1], 10) : 0,
        pv: pv ? pv[1].trim().split(/\s+/) : (last ? last.pv : []),
      };
      if (onInfo) onInfo(last);
    };
    this.listeners.add(infoListener);
    try {
      this.send('position fen ' + fen);
      this.send('go depth ' + depth);
      const bm = await this._waitFor((l) => l.startsWith('bestmove'));
      const best = bm.split(/\s+/)[1];
      return {
        eval: last ? last.eval : { cp: 0, mate: null },
        bestmove: best && best !== '(none)' ? best : null,
        pv: last ? last.pv : [],
        depth: last ? last.depth : 0,
      };
    } finally {
      this.listeners.delete(infoListener);
      this.busy = false;
    }
  }

  terminate() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
  }
}

/** Convertit un score UCI (point de vue du trait) en évaluation côté Blancs. */
function toWhiteEval(kind, value, sign) {
  if (kind === 'cp') return { cp: value * sign, mate: null };
  if (value === 0) {
    // le camp au trait est mat
    return { cp: -sign * MATE_CP, mate: 0 };
  }
  const m = value * sign;
  return { cp: m > 0 ? MATE_CP - m : -MATE_CP - m, mate: m };
}
