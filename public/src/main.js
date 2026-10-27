import { Field } from './field.js';
import { Pace } from './pace.js';
import { CHAPTERS } from './shaders.js';
import { Story, layout, ghost, wordmark } from './story.js';
import { textTexture } from './text.js';

const root = document.documentElement;
const stillness = matchMedia('(prefers-reduced-motion: reduce)');
// Phones, and tablets held upright: the art sits above and the copy below. styles.css repeats it.
export const NARROW = '(max-width: 760px), (max-aspect-ratio: 4/5)';
const narrow = matchMedia(NARROW);
const FAMILY = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
const ROWS = 88; // about this many rows of glyphs on any screen
// The shortest time between frames, in ms: the usual one, and the one where WebGL runs on the CPU
// and shares its cores with everything else. `Pace` lengthens it on a device that cannot keep up.
const INTERVAL = { usual: 1000 / 60, software: 1000 / 24 };
const META = {
  en: {
    title: 'Enco: a personal assistant that runs locally',
    description: 'A personal assistant that runs locally. Lightweight, free, and able to build itself. Always on.',
  },
  'zh-CN': {
    title: 'Enco：本地运行的私人助理',
    description: '本地运行的私人助理。轻盈，自由，自我构建。永远在线。',
  },
};

controls();

const canvas = document.querySelector('.field');
let field = null;
try {
  field = Field.create(canvas, textTexture());
} catch (error) {
  console.error(error);
}
if (field) animate(field);
else root.classList.add('no-field');

function controls() {
  const store = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  };
  const sync = () => {
    for (const button of document.querySelectorAll('[data-lang]')) {
      button.setAttribute('aria-pressed', String(button.dataset.lang === root.lang));
    }
    for (const button of document.querySelectorAll('[data-theme-choice]')) {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === root.dataset.theme));
    }
    const meta = META[root.lang] ?? META.en;
    document.title = meta.title;
    document.querySelector('meta[name="description"]').content = meta.description;
  };
  document.addEventListener('click', (event) => {
    const lang = event.target.closest('[data-lang]');
    if (lang) {
      root.lang = lang.dataset.lang;
      store('enco.lang', root.lang);
    }
    const theme = event.target.closest('[data-theme-choice]');
    if (theme) {
      root.dataset.theme = theme.dataset.themeChoice;
      store('enco.theme', root.dataset.theme);
    }
    if (lang || theme) sync();
  });
  // Follow the system until the reader picks a theme here.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
    let chosen = null;
    try {
      chosen = localStorage.getItem('enco.theme');
    } catch {}
    if (!chosen) {
      root.dataset.theme = event.matches ? 'dark' : 'light';
      sync();
    }
  });
  sync();
}

// The glyph cell for this viewport, in CSS px.
export function cellFor(height) {
  const h = Math.min(Math.max(Math.round(height / ROWS), 8), 12);
  return { width: h * 0.54, height: h, font: h * 0.88 };
}

// The copy of `section`, as a box in cells: left, top, right, bottom.
export function pocketOf(section, cell) {
  const box = section.querySelector('.copy').getBoundingClientRect();
  return [box.left / cell[0], box.top / cell[1], box.right / cell[0], box.bottom / cell[1]];
}

function animate(field) {
  const story = new Story([...document.querySelectorAll('[data-scene]')]);
  const clock = { time: 0, born: 0 };
  let colors = palette();
  let target = colors;
  let frame = 0;
  let dirty = true;
  const pace = new Pace(field.software ? INTERVAL.software : INTERVAL.usual);

  const resize = () => {
    field.resize(cellFor(window.innerHeight), FAMILY, wordmark([innerWidth, innerHeight], narrow.matches));
    story.measure();
    story.read(window.scrollY);
    dirty = true;
  };
  // Sized now, before the first frame; the observer follows later changes.
  resize();
  new ResizeObserver(resize).observe(canvas);
  document.fonts?.load(`400 20px "IBM Plex Mono"`).then(() => {
    field.redraw();
    dirty = true;
  }, () => {});
  addEventListener('scroll', () => {
    story.read(window.scrollY);
    dirty = true;
  }, { passive: true });
  new MutationObserver(() => {
    target = palette();
    dirty = true;
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  const tick = (now) => {
    frame = requestAnimationFrame(tick);
    const elapsed = pace.due(now, field.drawing(), !field.firstDraw);
    if (elapsed === null) return;
    const still = stillness.matches;
    if (still && !dirty && colors === target) return;
    const dt = Math.min(elapsed / 1000, 0.1);

    if (still) clock.time = 18;
    else clock.time += dt;
    story.step(dt, still);
    colors = blend(colors, target, still ? 1 : 1 - Math.exp(-dt * 7));
    const drawn = field.render(compose(field, story, clock, colors, narrow.matches));
    pace.drew(now);
    // The name condenses only once it can be drawn, however long its program took to compile.
    if (still) clock.born = 18;
    else if (drawn) clock.born += dt;
    // Once the reader's chapter draws, the ones on either side compile ahead of them.
    if (drawn) {
      const near = Math.round(story.position);
      for (let id = Math.max(0, near - 1); id <= Math.min(CHAPTERS.length - 1, near + 1); id++) field.prepare(id);
    }
    dirty = false;
  };

  const start = () => {
    if (frame) return;
    pace.restart();
    frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    stop();
    root.classList.add('no-field');
  });
  start();
}

// Everything one frame needs, from the story's position and the clock.
export function compose(field, story, clock, colors, isNarrow) {
  const pocket = pocketOf(story.current(), field.cellCss);
  const places = layout(field.view, [field.cols, field.rows], pocket, isNarrow);
  return {
    chapters: story.chapters(),
    cells: {
      uTime: clock.time,
      uBorn: clock.born,
      uPocket: pocket,
      uLedger: places.uLedger,
      uGate: places.uGate,
      uPlanets: places.uPlanets,
      uSources: places.uSources,
      ...ghost(places.planets, clock.time),
    },
    present: { uPaper: colors.paper, uInk: colors.ink, uAccent: colors.accent },
  };
}

export function palette() {
  const style = getComputedStyle(root);
  const color = (name) => {
    const hex = style.getPropertyValue(name).trim().replace('#', '');
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  };
  return { paper: color('--paper'), ink: color('--ink'), accent: color('--accent') };
}

// Moves `from` toward `to`; returns `to` itself once close, which ends the transition.
function blend(from, to, amount) {
  let distance = 0;
  const mix = (a, b) => a.map((v, i) => {
    distance = Math.max(distance, Math.abs(b[i] - v));
    return v + (b[i] - v) * amount;
  });
  const next = {
    paper: mix(from.paper, to.paper),
    ink: mix(from.ink, to.ink),
    accent: mix(from.accent, to.accent),
  };
  return distance < 0.004 ? to : next;
}
