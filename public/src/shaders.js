import { BLOCKS, PLUGIN_KIND, PLUGIN_OWN, TEXT_WIDTH } from './text.js';

// Two passes: one glyph per cell for whichever chapters are showing, then the glyphs at device
// resolution. Each chapter is its own small program, so a device compiles only the chapters it
// reaches, one at a time, instead of one large shader holding all of them.

export const VERTEX = `#version 300 es
layout(location = 0) in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

// What every chapter program shares. Rows count from the top. Output: r glyph index (code - 32),
// g ink strength, b accent.
const COMMON = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uText;
uniform sampler2D uMark;    // the name per cell, rows from the top: coverage, depth, coverage gradient
uniform ivec2 uGrid;        // columns, rows
uniform vec2 uCell;         // cell size in CSS px
uniform float uTime;
uniform float uBorn;        // seconds since the page opened, for the name condensing
uniform int uPart;          // 0 the whole screen; during a transition 1 below the front, 2 above it
uniform float uMix;         // how far the incoming chapter has rained in
uniform vec4 uPocket;       // the copy, in cells: left, top, right, bottom
uniform ivec4 uLedger;      // the log's first column, bottom row, and number of columns
uniform int uGate;          // the mapper's column
uniform vec3 uPlanets[3];   // centre and radius in CSS px: phone, laptop, server
uniform vec4 uGhost;        // centre and radius in CSS px; w is 1 while it passes behind its planet
uniform int uHome;          // the planet the ghost is with, or -1 between planets
uniform vec4 uSources;      // two echo sources in CSS px

out vec4 outCell;

struct Glyph { int code; float alpha; float accent; };

const Glyph NONE = Glyph(32, 0.0, 0.0);
const int RAMP[10] = int[10](32, 46, 58, 45, 61, 43, 42, 35, 37, 64);  //  .:-=+*#%@
const int EDGES[4] = int[4](45, 47, 124, 92);                          // dash, slash, bar, backslash
const float PI = 3.14159265;
const int LEDGER = ${BLOCKS.ledger.row};
const int RAW = ${BLOCKS.raw.row};
const int CLEAN = ${BLOCKS.clean.row};
const int PLUGINS = ${BLOCKS.plugins.row};
const int PLUGIN_COUNT = ${BLOCKS.plugins.rows};
const int PLUGIN_KIND = ${PLUGIN_KIND};
const int PLUGIN_OWN = ${PLUGIN_OWN};
const int WORDS = ${BLOCKS.words.row};
const int TEXT_MASK = ${TEXT_WIDTH - 1};

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

int textAt(int row, int col) {
  return int(texelFetch(uText, ivec2(col & TEXT_MASK, row), 0).r * 255.0 + 0.5);
}

int anyChar(vec2 seed) {
  return 33 + int(hash(seed) * 93.99);
}

// A character that keeps changing at its own pace.
int flicker(int col, int row, float rate) {
  vec2 id = vec2(float(col), float(row));
  return anyChar(id + floor(uTime * rate * (0.5 + hash(id + 9.1)) + hash(id) * 50.0));
}

Glyph ramp(float level, float alpha, float accent) {
  int tone = clamp(int(floor(level * 9.0 + 0.5)), 0, 9);
  if (tone == 0) return NONE;
  return Glyph(RAMP[tone], alpha, accent);
}

// Streams falling down a column: how bright the trail is at this row, 1 at the head.
float rain(int col, int row, float density, float speed, out bool head) {
  head = false;
  float best = 0.0;
  for (int layer = 0; layer < 2; layer++) {
    vec2 id = vec2(float(col), float(layer) * 37.0);
    if (hash(id + 0.13) > density) continue;
    float v = speed * mix(0.55, 1.45, hash(id + 1.7));
    float len = mix(8.0, 38.0, hash(id + 2.9));
    float span = float(uGrid.y) + len + mix(8.0, 64.0, hash(id + 4.1));
    float d = mod(uTime * v + hash(id + 5.3) * span, span) - float(row);
    if (d >= 0.0 && d < len && 1.0 - d / len > best) {
      best = 1.0 - d / len;
      head = d < 1.0;
    }
  }
  return best;
}

`;

// Each chapter defines `Glyph chapter(int col, int row)`, in page order.
const BODIES = [
`// Enco: a screen of rain, and the name condensed out of it. Every so often an echo sweeps across
// and rebuilds the letters from other characters: the same name, never the same twice.
Glyph chapter(int col, int row) {
  bool head;
  float r = rain(col, row, 0.9, 16.0, head);
  Glyph drop = NONE;
  if (r > 0.0) drop = Glyph(flicker(col, row, 7.0), head ? 0.75 : 0.06 + 0.32 * r * r, 0.0);

  vec4 mark = texelFetch(uMark, ivec2(col, row), 0);
  if (mark.r < 0.35) return drop;
  // Each column fills from the top as its first drop passes through the letters.
  float since = uBorn - (hash(vec2(float(col), 5.5)) * 1.1 + float(row) / float(uGrid.y));
  if (since < 0.0) return drop;
  if (since < 0.08) return Glyph(flicker(col, row, 20.0), 1.0, 0.0);
  float depth = mark.g;

  float period = 11.0;
  float front = (mod(uTime, period) - 1.0) / 4.0;
  float x = float(col) / float(uGrid.x);
  float set = floor(uTime / period) - (x < front ? 0.0 : 1.0);
  int style = int(mod(set + 1.0, 3.0));
  float accent = max(0.0, 1.0 - abs(x - front) * float(uGrid.x) / 3.0);

  // Outline where the stroke ends, once per edge.
  vec2 g = (mark.ba * 2.0 - 1.0) * vec2(uCell.y / uCell.x, 1.0);
  if (length(g) > 0.45) {
    float line = atan(g.y, g.x) + PI * 0.5;
    return Glyph(EDGES[int(mod(floor((line + PI * 0.125) / (PI * 0.25)), 4.0))], 0.95, accent);
  }
  float level = 0.3 + 0.7 * depth;
  if (style == 1) {
    // The name written in the log.
    int code = textAt(LEDGER + ((row + (col >> 6) * 37) & 127), col & 63);
    if (code > 32) return Glyph(code, 0.45 + 0.55 * depth, accent);
    return Glyph(46, 0.4, accent);
  }
  if (style == 2) {
    // The name written in itself.
    int letter = (col + row * 2) & 3;
    return Glyph(letter == 0 ? 101 : letter == 1 ? 110 : letter == 2 ? 99 : 111, 0.5 + 0.5 * depth, accent);
  }
  return ramp(level, 0.6 + 0.4 * level, accent);
}

`,
`// Plugins: a drifting wall of boxes, each running calls; now and then one crashes and comes back
// fresh, and nothing around it notices. Shipped plugins have solid frames, the owner's own dotted.
Glyph chapter(int col, int row) {
  const int W = 26;
  const int H = 8;
  int by = row / H;
  int ry = row - by * H;
  int x = col - int(floor(uTime * 1.5)) + ((by & 1) == 1 ? W / 2 : 0) + 100000 * W;
  int bx = x / W;
  int rx = x - bx * W;
  if (rx >= W - 3 || ry == H - 1) return NONE;
  vec2 id = vec2(float(bx), float(by));
  int right = W - 4;
  int bottom = H - 2;

  // A crash scrambles one box for a moment; the next call starts in a new instance.
  float cycle = 3.2;
  float shifted = uTime / cycle + hash(id) * 40.0;
  float phase = fract(shifted);
  bool crashed = hash(id + floor(shifted)) < 0.05 && phase < 0.4;
  if (crashed) {
    bool border = rx == 0 || rx == right || ry == 0 || ry == bottom;
    if (border && hash(vec2(float(col), float(row)) + floor(uTime * 14.0)) < 0.4) return NONE;
    return Glyph(flicker(col, row, 20.0), 0.85, 1.0 - phase / 0.4);
  }
  float fresh = hash(id + floor(shifted)) < 0.05 ? exp(-(phase - 0.4) * 6.0) : 0.0;

  int plugin = PLUGINS + int(hash(id + 0.7) * float(PLUGIN_COUNT) * 0.999);
  bool own = textAt(plugin, PLUGIN_OWN) > 32;
  bool edgeY = ry == 0 || ry == bottom;
  bool edgeX = rx == 0 || rx == right;
  if (own) {
    if (edgeX && edgeY) return Glyph(46, 0.5, fresh);
    if (edgeY && (rx & 1) == 0) return Glyph(46, 0.4, fresh);
    if (edgeY) return NONE;
    if (edgeX) return Glyph(58, 0.35, fresh);
  } else {
    if (edgeX && edgeY) return Glyph(43, 0.55, fresh);
    if (edgeY) return Glyph(45, 0.35, fresh);
    if (edgeX) return Glyph(124, 0.35, fresh);
  }
  if ((ry == 2 || ry == 3) && rx >= 2 && rx < right - 1) {
    int code = textAt(plugin, (ry == 2 ? 0 : PLUGIN_KIND) + rx - 2);
    if (code <= 32) return NONE;
    return Glyph(code, ry == 2 ? 0.85 : 0.38, fresh);
  }
  if (ry == 5 && rx >= 2 && rx <= right - 2) {
    // The call in progress.
    float progress = fract(uTime * mix(0.15, 0.6, hash(id + 2.3)) + hash(id + 3.1));
    if (rx == 2) return Glyph(91, 0.5, fresh);
    if (rx == right - 2) return Glyph(93, 0.5, fresh);
    bool done = float(rx - 3) < progress * float(right - 5);
    if (done) return Glyph(61, 0.6, fresh);
    return Glyph(46, 0.2, fresh);
  }
  return NONE;
}

`,
`// Generations: every plugin keeps a line of versions, read like a commit graph scrolling up. A new
// version branches off on trial and is either kept or dropped, and then the line goes on from there.
Glyph chapter(int col, int row) {
  const int SW = 28;
  const int L = 12;
  // Whole strands only, centred across the screen.
  int strands = max(1, uGrid.x / SW);
  int at = col - (uGrid.x - strands * SW) / 2;
  if (at < 0 || at >= strands * SW) return NONE;
  int s = at / SW;
  int x = at - s * SW;
  vec2 sid = vec2(float(s), 7.0);
  int v = row + int(floor(uTime * mix(2.0, 3.4, hash(sid)) + hash(sid + 1.0) * 900.0));
  int k = v / L;
  int j = v - k * L;
  vec2 kid = vec2(float(s), float(k));
  bool kept = hash(kid + 3.3) > 0.35;
  const int MAIN = 3;
  const int TRIAL = MAIN + 3;

  if (j == 0) {
    if (x == MAIN) return Glyph(111, 1.0, 0.0);
    // A short id, like an abbreviated hash.
    if (x >= MAIN + 3 && x < MAIN + 10) {
      int d = int(hash(kid + float(x) * 0.37) * 15.99);
      return Glyph(d < 10 ? 48 + d : 87 + d, 0.5, 0.0);
    }
    return NONE;
  }
  if (x == MAIN) return Glyph(124, 0.45, 0.0);
  if ((j == 1 && x == MAIN + 1) || (j == 2 && x == MAIN + 2)) return Glyph(92, 0.8, 0.8);
  if (j > 2 && j < 8 && x == TRIAL) {
    float shimmer = 0.6 + 0.4 * sin(uTime * 5.0 + float(j));
    return Glyph(j == 3 ? 42 : 124, 0.9, shimmer);
  }
  int label = x - (TRIAL + 3);
  if (j == 4 && label >= 0 && label < 5) return Glyph(textAt(WORDS, label), 0.8, 0.8);
  if (kept && ((j == 8 && x == MAIN + 2) || (j == 9 && x == MAIN + 1))) return Glyph(47, 0.8, 0.0);
  if (j == 8) {
    if (kept) {
      if (label >= 0 && label < 4) return Glyph(textAt(WORDS + 1, label), 0.6, 0.0);
    } else {
      if (x == TRIAL) return Glyph(120, 1.0, 0.0);
      if (label >= 0 && label < 11) return Glyph(textAt(WORDS + 2, label), 0.6, 0.0);
    }
  }
  return NONE;
}

`,
`// The log, in three columns: each entry rains down letter by letter, lands on the bottom line,
// and the stack moves up. Old entries fade but stay.
Glyph chapter(int col, int row) {
  const float P = 0.7;      // seconds per entry
  const float SPEED = 52.0; // rows per second
  int x = col - uLedger.x;
  int bottom = uLedger.y;
  if (x < 0 || row > bottom) return NONE;
  int b = x / 68;
  int c = x - b * 68;
  if (c >= 64 || b >= uLedger.z) return NONE;
  float t = uTime;
  int k = int(floor(t / P));
  int age = bottom - row;
  Glyph g = NONE;
  if (age >= 1) {
    int code = textAt(LEDGER + (((k - age) * 3 + b) & 127), c);
    if (code > 32) g = Glyph(code, max(0.16, 0.9 * exp(-float(age) * 0.03)), 0.0);
  } else {
    int code = textAt(LEDGER + ((k * 3 + b) & 127), c);
    if (code > 32 && t >= float(k) * P + hash(vec2(float(x), float(k))) * 0.5 * P) g = Glyph(code, 1.0, 0.0);
  }
  for (int m = 0; m < 4; m++) {
    int line = k + m;
    int code = textAt(LEDGER + ((line * 3 + b) & 127), c);
    if (code <= 32) continue;
    float land = float(line) * P + hash(vec2(float(x), float(line))) * 0.5 * P;
    if (t >= land) continue;
    float d = float(bottom) - (land - t) * SPEED - float(row);
    if (d >= 0.0 && d < 1.0) return Glyph(code, 1.0, 0.0);
    if (d >= 1.0 && d < 9.0 && g.alpha < 0.3) g = Glyph(flicker(col, row, 16.0), 0.32 * (1.0 - d / 9.0), 0.0);
  }
  return g;
}

`,
`// Mappers: raw arrivals stream in from the left, cross one column, and leave as plain records.
Glyph chapter(int col, int row) {
  vec2 rid = vec2(float(row), 11.0);
  int i = col - int(floor(uTime * mix(5.0, 14.0, hash(rid)) + hash(rid + 1.0) * 500.0));
  if (hash(vec2(float(row), floor(float(i) / 64.0))) > 0.6) {
    if (col == uGate) return Glyph(58, 0.3, 0.0);
    return NONE;
  }
  if (col == uGate) return Glyph(124, 0.9, 0.9);
  if (col < uGate) {
    int code = textAt(RAW + (row & 31), i);
    if (code <= 32) return NONE;
    if (hash(vec2(float(col), float(row)) + floor(uTime * 9.0)) < 0.1) code = flicker(col, row, 20.0);
    return Glyph(code, 0.32 + 0.25 * hash(vec2(float(i), float(row))), 0.0);
  }
  int code = textAt(CLEAN + (row & 31), i);
  if (code <= 32) return NONE;
  return Glyph(code, 0.9, 0.0);
}

`,
`// One planet: a sphere of characters lit from the upper left. While the ghost is with it, it
// turns and its surface is written with the conversation's log; otherwise it sleeps, dim.
Glyph planet(int i, vec2 p, bool home) {
  vec3 body = uPlanets[i];
  vec2 d = (p - body.xy) / body.z;
  float r2 = dot(d, d);
  if (r2 > 1.0) return NONE;
  vec3 n = vec3(d.x, -d.y, sqrt(1.0 - r2));
  float level = 0.12 + 0.88 * max(dot(n, normalize(vec3(-0.5, 0.6, 0.65))), 0.0);
  if (!home) return ramp(level * 0.45, 0.15 + 0.3 * level, 0.0);
  float lon = atan(n.x, n.z) + uTime * 0.35 + float(i) * 2.0;
  float lat = asin(n.y);
  int line = int(floor((lat + PI * 0.5) * 8.0));
  int c = int(floor((lon / (2.0 * PI) + 64.0) * 96.0));
  int code = textAt(LEDGER + (line & 127), c & 63);
  float rim = pow(1.0 - n.z, 3.0);
  if (code > 32) return Glyph(code, 0.25 + 0.75 * level, rim);
  return ramp(level * 0.35, 0.3, rim);
}

// Many shells: the same conversation moves between devices, and is only ever with one of them.
Glyph chapter(int col, int row) {
  vec2 p = (vec2(float(col), float(row)) + 0.5) * uCell;
  bool behind = uGhost.w > 0.5;
  vec3 home = uPlanets[uHome < 0 ? 0 : uHome];
  bool hidden = behind && uHome >= 0 && length(uGhost.xy - home.xy) < home.z;
  float d = length(p - uGhost.xy) / uGhost.z;
  if (d < 1.4 && !hidden) {
    float glow = exp(-d * d * 1.6);
    Glyph g = ramp(glow, 0.5 + 0.5 * glow, 1.0);
    if (g.alpha > 0.0) return g;
  }
  for (int i = 0; i < 3; i++) {
    vec3 body = uPlanets[i];
    Glyph g = planet(i, p, uHome == i);
    if (g.alpha > 0.0) return g;
    // The ghost's orbit around the planet it is with, drawn where the planet does not hide it.
    if (uHome == i) {
      vec2 q = (p - body.xy) / (body.z * 1.3 * vec2(1.0, 0.32));
      if (abs(length(q) - 1.0) < 0.05 && (col & 1) == 0) return Glyph(46, 0.45, 0.5);
    }
    // The device's name below it.
    int labelRow = int(floor((body.y + body.z) / uCell.y)) + 2;
    int x = col - int(floor(body.x / uCell.x)) + 3;
    if (row == labelRow && x >= 0 && x < 6) {
      int code = textAt(WORDS + 3 + i, x);
      if (code > 32) return Glyph(code, uHome == i ? 0.9 : 0.45, 0.0);
    }
  }
  // Distant stars.
  vec2 id = vec2(float(col), float(row));
  if (hash(id + 0.31) < 0.006) return Glyph(46, 0.15 + 0.2 * sin(uTime * 2.0 + hash(id) * 6.28), 0.0);
  return NONE;
}

`,
`// Echo: rings leave two points and cross. Each ring bends a little differently from the one
// before it, so no ring repeats another.
Glyph chapter(int col, int row) {
  vec2 p = (vec2(float(col), float(row)) + 0.5) * uCell;
  float level = 0.0;
  float crest = 0.0;
  for (int i = 0; i < 2; i++) {
    vec2 src = i == 0 ? uSources.xy : uSources.zw;
    vec2 e = p - src;
    float r = length(e) / (uGrid.y > 0 ? float(uGrid.y) * uCell.y : 1.0);
    float a = atan(e.y, e.x);
    float s = r * 34.0 - uTime * (i == 0 ? 1.1 : 1.4);
    float ring = floor(s / (2.0 * PI));
    float wobble = 0.7 * sin(a * 3.0 + ring * 1.3) + 0.35 * sin(a * 5.0 - ring * 0.7 + float(i));
    float wave = pow(0.5 + 0.5 * cos(s + wobble), 8.0) * exp(-r * (i == 0 ? 1.4 : 2.6));
    level += wave * (i == 0 ? 1.0 : 0.7);
    crest = max(crest, wave);
  }
  if (level > 0.62) {
    // The tallest crests spell the name, one letter at a time around the ring.
    vec2 e = p - uSources.xy;
    int letter = int(mod(floor((atan(e.y, e.x) + PI) * 9.0), 4.0));
    int code = letter == 0 ? 101 : letter == 1 ? 110 : letter == 2 ? 99 : 111;
    return Glyph(code, 0.95, 0.0);
  }
  return ramp(min(level, 1.0), 0.25 + 0.6 * min(level, 1.0), 0.0);
}

`,
];

const MAIN = `void main() {
  int col = int(gl_FragCoord.x);
  int row = uGrid.y - 1 - int(gl_FragCoord.y);
  // During a transition the incoming chapter rains in from the top, each column's front falling at
  // its own moment: the outgoing chapter draws below the front, the incoming one above it.
  float d = 0.0;
  if (uPart != 0) {
    float delay = hash(vec2(float(col), 3.7)) * 0.4;
    float front = clamp((uMix - delay) / 0.6, 0.0, 1.0) * float(uGrid.y + 24) - 12.0;
    d = front - float(row);
    if ((uPart == 2) != (d > 0.0)) discard;
  }
  Glyph g = chapter(col, row);
  if (uPart == 2) {
    if (d < 1.0) g = Glyph(flicker(col, row, 20.0), 1.0, 0.0);
    else if (d < 10.0 && g.alpha < 0.35) g = Glyph(flicker(col, row, 14.0), 0.45 * (1.0 - d / 10.0), 0.0);
  }

  // Keep the copy readable: the art fades out around it.
  vec2 p = vec2(float(col), float(row)) + 0.5;
  vec2 outside = max(max(uPocket.xy - p, p - uPocket.zw), 0.0) * vec2(uCell.x / uCell.y, 1.0);
  g.alpha *= smoothstep(0.0, 6.0, length(outside));

  outCell = vec4(float(g.code - 32) / 255.0, g.alpha, g.accent, 0.0);
}
`;

export const CHAPTERS = BODIES.map((body) => COMMON + body + MAIN);

export const PRESENT = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uCells;
uniform sampler2D uAtlas;
uniform ivec2 uCellSize;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uAccent;

out vec4 outColor;

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  ivec2 cell = px / uCellSize;
  ivec2 local = px - cell * uCellSize;
  vec4 c = texelFetch(uCells, cell, 0);
  int glyph = int(c.r * 255.0 + 0.5);
  float cover = 0.0;
  if (glyph > 0) {
    ivec2 origin = ivec2(glyph % 16, glyph / 16) * uCellSize;
    cover = texelFetch(uAtlas, origin + ivec2(local.x, uCellSize.y - 1 - local.y), 0).a;
  }
  vec3 ink = mix(uInk, uAccent, clamp(c.b * 1.4, 0.0, 1.0));
  outColor = vec4(mix(uPaper, ink, cover * c.g), 1.0);
}
`;
