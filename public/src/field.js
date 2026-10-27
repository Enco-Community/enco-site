import { VERTEX, CELLS, PRESENT } from './shaders.js';

const ATLAS_COLUMNS = 16;
const GLYPHS = 95; // printable ASCII, from space to tilde

// The WebGL side of the page: owns the context, both passes and their textures.
export class Field {
  static create(canvas, text) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    return gl ? new Field(canvas, gl, text) : null;
  }

  constructor(canvas, gl, text) {
    this.canvas = canvas;
    this.gl = gl;
    this.passes = { cells: link(gl, CELLS), present: link(gl, PRESENT) };
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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

  // The name's coverage at twice the cell resolution, rows from the top.
  drawMark() {
    const { lines, x, y, width, step } = this.markSpec;
    const canvas = document.createElement('canvas');
    canvas.width = this.cols * 2;
    canvas.height = this.rows * 2;
    const context = canvas.getContext('2d');
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
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.mark);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  render(frame) {
    const gl = this.gl;
    const { cells, present } = this.passes;
    gl.bindVertexArray(this.triangle);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cellTarget.framebuffer);
    gl.viewport(0, 0, this.cols, this.rows);
    bind(gl, 0, this.text);
    bind(gl, 1, this.mark);
    use(gl, cells, { ...frame.cells, uText: 0, uMark: 1, uGrid: [this.cols, this.rows], uCell: this.cellCss });
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    bind(gl, 0, this.cellTarget.texture);
    bind(gl, 1, this.atlas);
    use(gl, present, { ...frame.present, uCells: 0, uAtlas: 1, uCellSize: this.cellSize });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

function link(gl, fragment) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  const set = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    set[info.name.replace(/\[0\]$/, '')] = setter(gl, info.type, gl.getUniformLocation(program, info.name));
  }
  return { program, set };
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
