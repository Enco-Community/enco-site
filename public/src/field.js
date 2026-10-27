import { VERTEX, CHAPTERS, PRESENT } from './shaders.js';

const ATLAS_COLUMNS = 16;
const GLYPHS = 95; // printable ASCII, from space to tilde
// Renderers that run WebGL on the CPU, for browsers that do not honour the performance caveat.
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

// The WebGL side of the page: owns the context, the passes and their textures. `software` is true
// where WebGL runs on the CPU, because the GPU is blocked or absent; the page then draws less.
export class Field {
  static create(canvas, text) {
    const options = { alpha: false, antialias: false, depth: false, stencil: false };
    // Where WebGL would run on the CPU, a context that refuses the "major performance caveat" is null.
    let gl = canvas.getContext('webgl2', { ...options, failIfMajorPerformanceCaveat: true });
    let software = !gl;
    gl ??= canvas.getContext('webgl2', options);
    if (!gl) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (info && SOFTWARE.test(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))) software = true;
    return new Field(canvas, gl, text, software);
  }

  constructor(canvas, gl, text, software) {
    this.canvas = canvas;
    this.gl = gl;
    this.software = software;
    // Tells when a compile running off the main thread has finished; see `ready`.
    this.parallel = gl.getExtension('KHR_parallel_shader_compile');
    this.present = finish(gl, link(gl, PRESENT));
    this.chapters = CHAPTERS.map(() => null);
    this.fence = null; // a fence after the last frame, until the GPU has finished it
    this.firstDraw = false; // whether the last frame was the first to use one of its programs
    this.triangle = gl.createVertexArray();
    gl.bindVertexArray(this.triangle);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.cellTarget = target(gl);
    this.atlas = texture(gl);
    this.mark = texture(gl);
    this.text = texture(gl);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, text.width, text.height, 0, gl.RED, gl.UNSIGNED_BYTE, text.data);
  }

  // Sizes everything from the canvas's CSS box. `cell` is the glyph cell in CSS px; `mark` places
  // the name (see `wordmark` in story.js).
  resize(cell, family, mark) {
    // On the CPU every device pixel costs, so the glyphs are drawn at CSS resolution there.
    const dpr = this.software ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    const cw = Math.max(4, Math.round(cell.width * dpr));
    const ch = Math.max(6, Math.round(cell.height * dpr));
    this.canvas.width = width;
    this.canvas.height = height;
    this.cols = Math.ceil(width / cw);
    this.rows = Math.ceil(height / ch);
    this.cellSize = [cw, ch];
    this.cellCss = [cw / dpr, ch / dpr];
    this.view = [width / dpr, height / dpr];
    this.font = { px: cell.font * dpr, family };
    this.markSpec = mark;
    allocate(this.gl, this.cellTarget, this.cols, this.rows);
    this.redraw();
  }

  // Redraws everything drawn with the font, for instance once the web font has arrived.
  redraw() {
    if (!this.cellSize) return;
    this.drawAtlas();
    this.drawMark();
  }

  drawAtlas() {
    const [cw, ch] = this.cellSize;
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_COLUMNS * cw;
    canvas.height = Math.ceil(GLYPHS / ATLAS_COLUMNS) * ch;
    const context = canvas.getContext('2d');
    context.font = `400 ${this.font.px}px ${this.font.family}`;
    context.fillStyle = '#fff';
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    const capital = context.measureText('H').actualBoundingBoxAscent;
    for (let i = 1; i < GLYPHS; i++) {
      const x = (i % ATLAS_COLUMNS) * cw + cw / 2;
      const y = Math.floor(i / ATLAS_COLUMNS) * ch + (ch + capital) / 2;
      context.fillText(String.fromCharCode(32 + i), x, y);
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  // The name, one texel per cell, rows from the top: r how much of the cell the letters cover, g how
  // deep inside a stroke it is, ba the coverage gradient biased to 0..1. Computed once per size, so
  // the opening reads one texel per cell instead of sampling around it every frame.
  drawMark() {
    const { lines, x, y, width, step } = this.markSpec;
    const { cols, rows } = this;
    const canvas = document.createElement('canvas');
    canvas.width = cols * 2;
    canvas.height = rows * 2;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.scale(2 / this.cellCss[0], 2 / this.cellCss[1]);
    context.font = `500 100px ${this.font.family}`;
    const size = (100 * width) / Math.max(...lines.map((line) => context.measureText(line).width));
    context.font = `500 ${size}px ${this.font.family}`;
    const box = context.measureText(lines.join(''));
    const height = box.actualBoundingBoxAscent - box.actualBoundingBoxDescent;
    const leading = height * 1.3;
    context.fillStyle = '#fff';
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    lines.forEach((line, i) => {
      const k = i - (lines.length - 1) / 2;
      context.fillText(line, x + k * step, y + height / 2 + k * leading);
    });

    // Coverage per cell: the mean of its 2x2 samples.
    const alpha = context.getImageData(0, 0, cols * 2, rows * 2).data;
    const cover = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        for (let i = 0; i < 4; i++) sum += alpha[((r * 2 + (i >> 1)) * cols * 2 + c * 2 + (i & 1)) * 4 + 3];
        cover[r * cols + c] = sum / (4 * 255);
      }
    }
    const at = (c, r) => cover[Math.min(Math.max(r, 0), rows - 1) * cols + Math.min(Math.max(c, 0), cols - 1)];
    // Depth samples eight directions at two radii; a cell is about twice as tall as it is wide.
    const sx = Math.floor((2 * this.cellCss[1]) / this.cellCss[0] + 0.5);
    const directions = Array.from({ length: 8 }, (_, i) => [
      Math.floor(Math.cos((i * Math.PI) / 4) * sx + 0.5),
      Math.floor(Math.sin((i * Math.PI) / 4) * 2 + 0.5),
    ]);
    const data = new Uint8Array(cols * rows * 4);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let depth = 0;
        for (const [ox, oy] of directions) depth += at(c + ox, r + oy) + at(c + 2 * ox, r + 2 * oy);
        const k = (r * cols + c) * 4;
        data[k] = Math.round(at(c, r) * 255);
        data[k + 1] = Math.round((depth / 16) * 255);
        data[k + 2] = Math.round(((at(c + 1, r) - at(c - 1, r)) * 0.5 + 0.5) * 255);
        data[k + 3] = Math.round(((at(c, r - 1) - at(c, r + 1)) * 0.5 + 0.5) * 255);
      }
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.mark);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  // Starts compiling a chapter's program, if it has not started; drawing waits until it is ready.
  prepare(id) {
    this.chapters[id] ??= link(this.gl, CHAPTERS[id]);
  }

  // Whether a chapter can draw now, without waiting: asking about a program the GPU has not worked
  // through yet would block the page until it has. A chapter is never ready in the task that
  // prepared it, so the page can show its copy first.
  ready(id) {
    const pass = this.chapters[id];
    if (!pass) return false;
    if (pass.set) return true;
    if (!signaled(this.gl, pass.fence)) return false;
    // Where the browser compiles off the main thread, the link can be through before the compile.
    if (this.parallel && !this.gl.getProgramParameter(pass.program, this.parallel.COMPLETION_STATUS_KHR)) return false;
    finish(this.gl, pass);
    return true;
  }

  // Whether the GPU is still drawing the last frame. Like any fence, it changes only between tasks.
  drawing() {
    if (!this.fence) return false;
    if (!signaled(this.gl, this.fence)) return true;
    this.gl.deleteSync(this.fence);
    this.fence = null;
    return false;
  }

  // Draws a frame. During a transition the outgoing chapter draws below the rain front and the
  // incoming one above it. Returns false while a chapter it needs is still compiling; its cells then
  // keep what they showed last.
  render(frame) {
    const gl = this.gl;
    const { from, to, mix } = frame.chapters;
    const parts = mix <= 0 ? [[from, 0]] : mix >= 1 ? [[to, 0]] : [[from, 1], [to, 2]];
    let complete = true;
    // Many drivers finish compiling a program only when it first draws.
    this.firstDraw = !this.present.drawn;
    gl.bindVertexArray(this.triangle);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cellTarget.framebuffer);
    gl.viewport(0, 0, this.cols, this.rows);
    bind(gl, 0, this.text);
    bind(gl, 1, this.mark);
    for (const [id, part] of parts) {
      this.prepare(id);
      if (!this.ready(id)) {
        complete = false;
        continue;
      }
      const pass = this.chapters[id];
      use(gl, pass, {
        ...frame.cells,
        uPart: part,
        uMix: mix,
        uText: 0,
        uMark: 1,
        uGrid: [this.cols, this.rows],
        uCell: this.cellCss,
      });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.firstDraw ||= !pass.drawn;
      pass.drawn = true;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    bind(gl, 0, this.cellTarget.texture);
    bind(gl, 1, this.atlas);
    use(gl, this.present, { ...frame.present, uCells: 0, uAtlas: 1, uCellSize: this.cellSize });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.present.drawn = true;
    gl.deleteSync(this.fence);
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    return complete;
  }
}

function signaled(gl, fence) {
  return gl.getSyncParameter(fence, gl.SYNC_STATUS) === gl.SIGNALED;
}

// Submits a program for compiling and linking without waiting for either. The fence after them
// tells when the GPU has worked through both.
function link(gl, fragment) {
  const program = gl.createProgram();
  const shaders = [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment]].map(([type, source]) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    return shader;
  });
  gl.linkProgram(program);
  return { program, shaders, fence: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), set: null, drawn: false };
}

// Waits for a program's link if it has not finished, reports a failure, and looks up its uniforms.
function finish(gl, pass) {
  const { program, shaders } = pass;
  gl.deleteSync(pass.fence);
  pass.fence = null;
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const logs = shaders.map((shader) => gl.getShaderInfoLog(shader)).filter(Boolean);
    throw new Error([gl.getProgramInfoLog(program), ...logs].filter(Boolean).join('\n'));
  }
  const set = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    set[info.name.replace(/\[0\]$/, '')] = setter(gl, info.type, gl.getUniformLocation(program, info.name));
  }
  pass.set = set;
  return pass;
}

function setter(gl, type, location) {
  switch (type) {
    case gl.FLOAT: return (v) => gl.uniform1f(location, v);
    case gl.FLOAT_VEC2: return (v) => gl.uniform2fv(location, v);
    case gl.FLOAT_VEC3: return (v) => gl.uniform3fv(location, v);
    case gl.FLOAT_VEC4: return (v) => gl.uniform4fv(location, v);
    case gl.FLOAT_MAT3: return (v) => gl.uniformMatrix3fv(location, false, v);
    case gl.INT:
    case gl.SAMPLER_2D: return (v) => gl.uniform1i(location, v);
    case gl.INT_VEC2: return (v) => gl.uniform2iv(location, v);
    case gl.INT_VEC4: return (v) => gl.uniform4iv(location, v);
    default: throw new Error(`unsupported uniform type 0x${type.toString(16)}`);
  }
}

// Uniforms the compiler removed are simply absent from `set`.
function use(gl, pass, values) {
  gl.useProgram(pass.program);
  for (const name in values) pass.set[name]?.(values[name]);
}

function texture(gl) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function target(gl) {
  return { texture: texture(gl), framebuffer: gl.createFramebuffer() };
}

function allocate(gl, { texture: t, framebuffer }, width, height) {
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function bind(gl, unit, t) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
}
