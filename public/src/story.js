const CHAPTERS = 7;

// Which chapters are showing as the page scrolls. Each section holds its own chapter while it is
// near the middle of the screen; the next one rains in while the copy blocks pass each other.
export class Story {
  constructor(sections) {
    if (sections.length !== CHAPTERS) throw new Error(`${sections.length} sections for ${CHAPTERS} chapters`);
    this.sections = sections;
    this.anchors = [];
    this.target = 0;
    this.position = 0;
    this.velocity = 0;
  }

  // Scroll offsets at which each section sits centred in the viewport.
  measure() {
    const middle = window.innerHeight / 2;
    this.anchors = this.sections.map((section) => {
      const box = section.getBoundingClientRect();
      return box.top + window.scrollY + box.height / 2 - middle;
    });
  }

  read(scrollY) {
    const a = this.anchors;
    this.target = a.length - 1;
    if (scrollY <= a[0]) this.target = 0;
    else {
      for (let i = 0; i < a.length - 1; i++) {
        if (scrollY < a[i + 1]) {
          this.target = i + (scrollY - a[i]) / (a[i + 1] - a[i]);
          break;
        }
      }
    }
  }

  // A critically damped spring, so fast scrolling still lands softly.
  step(dt, immediate) {
    if (immediate) {
      this.position = this.target;
      this.velocity = 0;
      return;
    }
    const w = 5;
    this.velocity += (w * w * (this.target - this.position) - 2 * w * this.velocity) * dt;
    this.position += this.velocity * dt;
  }

  chapters() {
    const p = Math.min(Math.max(this.position, 0), CHAPTERS - 1);
    const from = Math.min(Math.floor(p), CHAPTERS - 2);
    const mix = smooth(0.3, 0.7, p - from);
    return { from, to: from + 1, mix };
  }

  // The section whose copy the art should keep clear of.
  current() {
    return this.sections[Math.round(Math.min(Math.max(this.position, 0), CHAPTERS - 1))];
  }
}

// Where the opening's name sits, in CSS px: its lines, their centre, the widest line's width, and
// how far each line steps right of the one above. A phone is too narrow for one line, so the name
// stacks in two, staggered.
export function wordmark([w, h], narrow) {
  if (!narrow) return { lines: ['enco'], x: w / 2, y: h * 0.4, width: w * 0.88, step: 0 };
  const width = Math.min(w * 0.74, h * 0.34);
  return { lines: ['en', 'co'], x: w / 2, y: h * 0.33, width, step: width * 0.24 };
}

// Where each chapter puts its pieces for this viewport. `pocket` is the copy's box in cells.
export function layout(view, grid, pocket, narrow) {
  const [w, h] = view;
  const [cols, rows] = grid;
  const left = narrow ? 0 : (pocket[2] / cols) * w + 40;
  const span = w - 40 - left;
  // Phone, laptop and server: two smaller planets high, the larger one low between them.
  const unit = Math.min(w, h * 0.46);
  const planets = narrow
    ? [[w * 0.27, h * 0.17, unit * 0.19], [w * 0.5, h * 0.47, unit * 0.29], [w * 0.75, h * 0.21, unit * 0.2]]
    : [[left + span * 0.2, h * 0.32, h * 0.14], [left + span * 0.52, h * 0.64, h * 0.2], [left + span * 0.82, h * 0.3, h * 0.15]];
  return {
    uLedger: ledger(cols, rows, pocket, narrow),
    uGate: Math.round(cols * (narrow ? 0.5 : 0.64)),
    uPlanets: planets.flat(),
    uSources: narrow ? [w * 0.5, h * 0.22, w * 0.82, h * 0.42] : [w * 0.68, h * 0.46, w * 0.9, h * 0.82],
    planets,
  };
}

// The log's first column, bottom row, and how many 68-column blocks fit beside the copy.
function ledger(cols, rows, pocket, narrow) {
  const left = narrow ? 1 : Math.round(pocket[2]) + 4;
  const bottom = narrow ? Math.max(4, Math.round(pocket[1]) - 3) : rows - 2;
  return [left, bottom, Math.max(1, Math.floor((cols - left + 4) / 68)), 0];
}

// The ghost circles one planet, then crosses to the next; between crossings it is with exactly
// one of them.
export function ghost(planets, time) {
  const phase = time / 7;
  const from = Math.floor(phase) % 3;
  const to = (from + 1) % 3;
  const f = smooth(0.62, 1, phase - Math.floor(phase));
  const angle = time * 1.6;
  const orbit = (i) => {
    const [x, y, r] = planets[i];
    return [x + Math.cos(angle) * r * 1.3, y + Math.sin(angle) * r * 1.3 * 0.32];
  };
  const a = orbit(from);
  const b = orbit(to);
  const lift = Math.sin(Math.PI * f) * planets[1][2] * 0.9;
  return {
    uGhost: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f - lift, planets[1][2] * 0.22, Math.sin(angle) < 0 ? 1 : 0],
    uHome: f === 0 ? from : f === 1 ? to : -1,
  };
}

function smooth(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}
