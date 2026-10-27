// Development aid: renders one still of any chapter over the page, at a chosen time, so a chapter
// can be judged without scrolling or waiting. From the console:
//   const { still, ascii } = await import('/tools/inspect.js');
//   await still({ position: 2, time: 8 }); // 2.5 is halfway through the rain into chapter 3
//   ascii();                               // the same still as plain text
import { Field } from '../src/field.js';
import { textTexture } from '../src/text.js';
import { Story, wordmark } from '../src/story.js';
import { NARROW, cellFor, compose, palette } from '../src/main.js';

let field = null;

export async function still({ position = 0, time = 6 } = {}) {
  const narrow = matchMedia(NARROW).matches;
  if (!field) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100lvh;pointer-events:none';
    document.querySelector('.field').insertAdjacentElement('afterend', canvas);
    canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false });
    field = Field.create(canvas, textTexture());
    field.resize(cellFor(innerHeight), '"IBM Plex Mono", monospace', wordmark([innerWidth, innerHeight], narrow));
  }
  const story = new Story([...document.querySelectorAll('[data-scene]')]);
  story.measure();
  story.position = position;
  field.render(compose(field, story, { time, born: time }, palette(), narrow));
}

// The last still as plain text, one line per row of cells, top first.
export function ascii(left = 0, width = Infinity) {
  const gl = field.gl;
  const pixels = new Uint8Array(field.cols * field.rows * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, field.cellTarget.framebuffer);
  gl.readPixels(0, 0, field.cols, field.rows, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const lines = [];
  for (let row = field.rows - 1; row >= 0; row--) {
    let line = '';
    for (let col = left; col < Math.min(field.cols, left + width); col++) {
      const i = (row * field.cols + col) * 4;
      line += pixels[i + 1] > 0 ? String.fromCharCode(32 + pixels[i]) : ' ';
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}
