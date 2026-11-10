// Graphique d'évaluation (canvas), cliquable pour naviguer dans la partie.
import { CATEGORY_BY_KEY } from './analysis.js';

export class EvalGraph {
  constructor(canvas, onSelect) {
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.wins = null; // probabilités de gain des Blancs, par demi-coup (0..n)
    this.categories = null; // catégories des coups (index = demi-coup - 1)
    this.current = 0;
    this.hover = null;
    this.pad = { l: 6, r: 6, t: 8, b: 8 };
    canvas.addEventListener('click', (e) => {
      const ply = this._plyAt(e);
      if (ply !== null) this.onSelect(ply);
    });
    canvas.addEventListener('mousemove', (e) => {
      this.hover = this._plyAt(e);
      this.draw();
    });
    canvas.addEventListener('mouseleave', () => {
      this.hover = null;
      this.draw();
    });
    this._ro = new ResizeObserver(() => this.draw());
    this._ro.observe(canvas);
  }

  set(wins, categories, current) {
    this.wins = wins;
    this.categories = categories;
    this.current = current;
    this.draw();
  }

  setCurrent(ply) {
    this.current = ply;
    this.draw();
  }

  _plyAt(e) {
    if (!this.wins || this.wins.length < 2) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width - this.pad.l - this.pad.r;
    const n = this.wins.length - 1;
    const ply = Math.round(((x - this.pad.l) / w) * n);
    return Math.max(0, Math.min(n, ply));
  }

  draw() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const col = (v, d) => (css.getPropertyValue(v).trim() || d);
    const { l, r, t, b } = this.pad;
    const gw = W - l - r;
    const gh = H - t - b;

    // fond : moitié noire
    ctx.fillStyle = col('--graph-black', '#22252c');
    ctx.fillRect(l, t, gw, gh);

    if (!this.wins || this.wins.length < 2) {
      ctx.fillStyle = col('--muted', '#888');
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Lancez l’analyse pour afficher la courbe d’évaluation', W / 2, H / 2 + 4);
      return;
    }
    const n = this.wins.length - 1;
    const X = (i) => l + (i / n) * gw;
    const Y = (w) => t + (1 - w / 100) * gh;

    // aire blanche
    ctx.beginPath();
    ctx.moveTo(X(0), t + gh);
    this.wins.forEach((w, i) => ctx.lineTo(X(i), Y(w)));
    ctx.lineTo(X(n), t + gh);
    ctx.closePath();
    ctx.fillStyle = col('--graph-white', '#e9e6df');
    ctx.fill();

    // ligne médiane
    ctx.strokeStyle = col('--graph-mid', 'rgba(128,128,128,.6)');
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(l, Y(50));
    ctx.lineTo(l + gw, Y(50));
    ctx.stroke();
    ctx.setLineDash([]);

    // courbe
    ctx.beginPath();
    this.wins.forEach((w, i) => (i ? ctx.lineTo(X(i), Y(w)) : ctx.moveTo(X(i), Y(w))));
    ctx.strokeStyle = col('--accent', '#5fb3a1');
    ctx.lineWidth = 2;
    ctx.stroke();

    // marqueurs d'erreurs
    if (this.categories) {
      this.categories.forEach((cat, i) => {
        if (!['imprecision', 'erreur', 'gaffe'].includes(cat)) return;
        ctx.beginPath();
        ctx.arc(X(i + 1), Y(this.wins[i + 1]), cat === 'gaffe' ? 4.5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = col(`--cat-${cat}`, '#e55');
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }

    // demi-coup survolé et courant
    const vline = (i, color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(X(i), t);
      ctx.lineTo(X(i), t + gh);
      ctx.stroke();
    };
    if (this.hover !== null && this.hover !== this.current) vline(this.hover, 'rgba(160,160,160,.5)', 1);
    vline(Math.min(this.current, n), col('--accent-strong', '#f0b44c'), 2);
  }
}

export { CATEGORY_BY_KEY };
