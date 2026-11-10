// Échiquier dessiné en SVG, avec des pièces vectorielles originales.

const NS = 'http://www.w3.org/2000/svg';
const FILES = 'abcdefgh';

// Pièces dessinées dans un carré 100×100.
const PIECE_SHAPES = {
  p: [
    ['circle', { cx: 50, cy: 31, r: 12 }],
    ['path', { d: 'M37 45 H63 L59 51 H41 Z' }],
    ['path', { d: 'M42 51 Q41 66 31 77 H69 Q59 66 58 51 Z' }],
    ['rect', { x: 24, y: 77, width: 52, height: 10, rx: 4 }],
  ],
  r: [
    ['rect', { x: 22, y: 77, width: 56, height: 10, rx: 3 }],
    ['path', { d: 'M31 77 L34 42 H66 L69 77 Z' }],
    ['path', { d: 'M27 42 V20 H37 V28 H45 V20 H55 V28 H63 V20 H73 V42 Z' }],
    ['line', { x1: 34, y1: 50, x2: 66, y2: 50, detail: 1 }],
  ],
  n: [
    ['rect', { x: 26, y: 77, width: 50, height: 10, rx: 3 }],
    ['path', { d: 'M35 77 C34 63 41 56 47 49 C41 52 33 55 27 51 C22 47 24 41 30 36 L44 25 L44 15 L51 21 C67 23 76 40 73 77 Z' }],
    ['circle', { cx: 43, cy: 34, r: 2.8, detail: 1 }],
    ['path', { d: 'M55 30 C62 40 65 55 64 70', detail: 1, fill: 'none' }],
  ],
  b: [
    ['rect', { x: 25, y: 79, width: 50, height: 9, rx: 3 }],
    ['path', { d: 'M38 79 L42 66 H58 L62 79 Z' }],
    ['rect', { x: 35, y: 59, width: 30, height: 7, rx: 2 }],
    ['path', { d: 'M50 19 C35 31 33 47 39 59 H61 C67 47 65 31 50 19 Z' }],
    ['circle', { cx: 50, cy: 14, r: 5 }],
    ['path', { d: 'M49 33 L57 44', detail: 1, fill: 'none' }],
  ],
  q: [
    ['rect', { x: 23, y: 78, width: 54, height: 10, rx: 3 }],
    ['path', { d: 'M31 78 L21 36 L36 57 L37 27 L46 54 L50 21 L54 54 L63 27 L64 57 L79 36 L69 78 Z' }],
    ['circle', { cx: 21, cy: 33, r: 4.5 }],
    ['circle', { cx: 37, cy: 24, r: 4.5 }],
    ['circle', { cx: 50, cy: 18, r: 4.5 }],
    ['circle', { cx: 63, cy: 24, r: 4.5 }],
    ['circle', { cx: 79, cy: 33, r: 4.5 }],
    ['line', { x1: 31, y1: 70, x2: 69, y2: 70, detail: 1 }],
  ],
  k: [
    ['rect', { x: 23, y: 78, width: 54, height: 10, rx: 3 }],
    ['path', { d: 'M31 78 C21 62 23 46 36 45 C43 44 47 49 50 55 C53 49 57 44 64 45 C77 46 79 62 69 78 Z' }],
    ['path', { d: 'M46 13 H54 V22 H62 V30 H54 V46 H46 V30 H38 V22 H46 Z' }],
    ['line', { x1: 31, y1: 70, x2: 69, y2: 70, detail: 1 }],
  ],
};

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function drawPiece(parent, type, color, x, y, size) {
  const g = el('g', {
    class: `piece piece-${color}`,
    transform: `translate(${x} ${y}) scale(${size / 100})`,
  }, parent);
  for (const [tag, attrs] of PIECE_SHAPES[type]) {
    const a = { ...attrs };
    const detail = a.detail;
    delete a.detail;
    const node = el(tag, a, g);
    if (detail) node.setAttribute('class', 'detail');
  }
  return g;
}

/** Lit la partie « placement » d'un FEN et renvoie une grille [rang 8..1][colonne a..h]. */
function parseFenBoard(fen) {
  const rows = fen.split(' ')[0].split('/');
  return rows.map((row) => {
    const out = [];
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) out.push(null);
      else out.push({ type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b' });
    }
    return out;
  });
}

export class Board {
  constructor(container) {
    this.container = container;
    this.flipped = false;
    this.size = 800;
    this.sq = this.size / 8;
    this.svg = el('svg', {
      viewBox: `0 0 ${this.size} ${this.size}`,
      class: 'board-svg',
      role: 'img',
      'aria-label': 'Échiquier',
    });
    const defs = el('defs', {}, this.svg);
    const marker = el('marker', {
      id: 'arrowhead', viewBox: '0 0 10 10', refX: '5', refY: '5',
      markerWidth: '3.2', markerHeight: '3.2', orient: 'auto-start-reverse',
    }, defs);
    el('path', { d: 'M0 0 L10 5 L0 10 z', class: 'arrow-head' }, marker);
    this.layerSquares = el('g', {}, this.svg);
    this.layerHighlight = el('g', {}, this.svg);
    this.layerCoords = el('g', { class: 'coords' }, this.svg);
    this.layerPieces = el('g', {}, this.svg);
    this.layerArrows = el('g', { class: 'arrows' }, this.svg);
    container.appendChild(this.svg);
    this.fen = null;
    this.lastMove = null;
    this.arrow = null;
    this.badge = null;
    this._drawSquares();
  }

  _xy(square) {
    const f = FILES.indexOf(square[0]);
    const r = parseInt(square[1], 10) - 1;
    const col = this.flipped ? 7 - f : f;
    const row = this.flipped ? r : 7 - r;
    return { x: col * this.sq, y: row * this.sq };
  }

  _drawSquares() {
    this.layerSquares.innerHTML = '';
    this.layerCoords.innerHTML = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const light = (row + col) % 2 === 0;
        el('rect', {
          x: col * this.sq, y: row * this.sq, width: this.sq, height: this.sq,
          class: light ? 'sq-light' : 'sq-dark',
        }, this.layerSquares);
      }
    }
    for (let i = 0; i < 8; i++) {
      const file = this.flipped ? FILES[7 - i] : FILES[i];
      const rank = this.flipped ? i + 1 : 8 - i;
      const t1 = el('text', {
        x: i * this.sq + this.sq - 6, y: this.size - 6, 'text-anchor': 'end',
        class: (7 + i) % 2 === 0 ? 'coord-on-light' : 'coord-on-dark',
      }, this.layerCoords);
      t1.textContent = file;
      const t2 = el('text', {
        x: 5, y: i * this.sq + 20,
        class: i % 2 === 0 ? 'coord-on-light' : 'coord-on-dark',
      }, this.layerCoords);
      t2.textContent = rank;
    }
  }

  setFlipped(flipped) {
    this.flipped = flipped;
    this._drawSquares();
    this.render();
  }

  /** Met à jour la position, le dernier coup, la flèche et le badge de classification. */
  set({ fen, lastMove = null, arrow = null, badge = null, inCheck = false }) {
    this.fen = fen;
    this.inCheck = inCheck;
    this.lastMove = lastMove;
    this.arrow = arrow;
    this.badge = badge;
    this.render();
  }

  render() {
    this.layerHighlight.innerHTML = '';
    this.layerPieces.innerHTML = '';
    this.layerArrows.innerHTML = '';
    if (!this.fen) return;
    if (this.lastMove) {
      for (const s of [this.lastMove.from, this.lastMove.to]) {
        const { x, y } = this._xy(s);
        el('rect', { x, y, width: this.sq, height: this.sq, class: 'sq-last' }, this.layerHighlight);
      }
    }
    const grid = parseFenBoard(this.fen);
    const turn = this.fen.split(' ')[1];
    grid.forEach((row, ri) => {
      row.forEach((p, fi) => {
        if (!p) return;
        const square = FILES[fi] + (8 - ri);
        const { x, y } = this._xy(square);
        if (p.type === 'k' && p.color === turn && this.inCheck) {
          el('circle', { cx: x + this.sq / 2, cy: y + this.sq / 2, r: this.sq * 0.48, class: 'sq-check' }, this.layerHighlight);
        }
        drawPiece(this.layerPieces, p.type, p.color, x + this.sq * 0.04, y + this.sq * 0.04, this.sq * 0.92);
      });
    });
    if (this.arrow) this._drawArrow(this.arrow.from, this.arrow.to);
    if (this.badge && this.lastMove) {
      const { x, y } = this._xy(this.lastMove.to);
      const g = el('g', { class: `board-badge cat-${this.badge.key}` }, this.layerArrows);
      el('circle', { cx: x + this.sq - 14, cy: y + 14, r: 16 }, g);
      const t = el('text', { x: x + this.sq - 14, y: y + 20, 'text-anchor': 'middle' }, g);
      t.textContent = this.badge.icon;
    }
  }

  _drawArrow(from, to) {
    const a = this._xy(from);
    const b = this._xy(to);
    const h = this.sq / 2;
    const x1 = a.x + h, y1 = a.y + h, x2 = b.x + h, y2 = b.y + h;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const shorten = 24;
    const ex = x2 - ((x2 - x1) / len) * shorten;
    const ey = y2 - ((y2 - y1) / len) * shorten;
    el('line', { x1, y1, x2: ex, y2: ey, class: 'best-arrow', 'marker-end': 'url(#arrowhead)' }, this.layerArrows);
  }
}
