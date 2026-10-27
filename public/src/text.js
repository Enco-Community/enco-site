// Every string the art draws, packed into one texture of 512-character rows. The entry kinds,
// plugin names and protocol fields are real; ids, positions and messages are made up and stay
// the same on every visit.

export const TEXT_WIDTH = 512;
export const BLOCKS = {
  ledger: { row: 0, rows: 128 }, // one log entry per row
  raw: { row: 128, rows: 32 },   // what arrives from outside, one long stream per row
  clean: { row: 160, rows: 32 }, // the same arrivals after a mapper
  plugins: { row: 192, rows: 17 }, // one per row: name, kind at column 24, a mark at 40 if not shipped
  words: { row: 209, rows: 6 },    // labels the art needs
};
export const PLUGIN_KIND = 24;
export const PLUGIN_OWN = 40;
export const WORDS = ['trial', 'kept', 'rolled back', 'phone', 'laptop', 'server'];
// Enco ships the first eight. The rest are the kind of plugin an owner, or Enco itself, writes.
const PLUGINS = [
  ['openai-compatible', 'provider'], ['gemini', 'provider'], ['deepseek', 'provider'],
  ['typesafe', 'decision'], ['composer', 'context'], ['web', 'tools'],
  ['telegram', 'channel'], ['discord', 'channel'],
  ['calendar', 'tools', 1], ['weather', 'tools', 1], ['notes', 'tools', 1], ['rss', 'tools', 1],
  ['mail', 'channel', 1], ['translate', 'tools', 1], ['smart-home', 'tools', 1],
  ['pdf-reader', 'tools', 1], ['expenses', 'tools', 1],
];
const ROWS = 216;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CHANNELS = ['telegram', 'discord', 'cli'];
const CAPABILITIES = ['web_search', 'web_fetch', 'memory_search', 'read_file', 'shell'];
const OUTCOMES = ['ok', 'ok', 'ok', 'ok', 'failed', 'unknown'];

// Each pair is one arrival: the bytes as they came, then what a mapper made of them.
const ARRIVALS = [
  ['{"update_id":881234,"message":{"message_id":512,"from":{"id":4412,"first_name":"Li"},"chat":{"id":4412,"type":"private"},"date":1761400000,"text":"what is on tomorrow?"}}',
    'message  telegram  from=owner  text="what is on tomorrow?"'],
  ['{"op":0,"s":42,"t":"MESSAGE_CREATE","d":{"id":"1301288812","channel_id":"1299004417","author":{"id":"8812","username":"li"},"content":"summarize this page"}}',
    'message  discord  from=owner  text="summarize this page"'],
  ['HTTP/1.1 200 OK\\r\\ncontent-type: text/html\\r\\n\\r\\n<html><head><title>Rust 1.99 released</title></head><body><article><h1>Rust 1.99</h1><p>The Rust team is happy',
    'page  title="Rust 1.99 released"  words=1240'],
  ['{"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"3 events tomorrow: 09:30 standup"}],"isError":false}}',
    'tool_result  ok  text="3 events tomorrow: 09:30 standup"'],
  ['{"op":11}', 'heartbeat'],
  ['{"update_id":881235,"edited_message":{"message_id":513,"chat":{"id":4412},"text":"what is on friday?"}}',
    'edit  telegram  message=513  text="what is on friday?"'],
  ['data: {"choices":[{"delta":{"content":"Tomorrow you have"}}]}\\n\\ndata: {"choices":[{"delta":{"content":" three meetings"}}]}',
    'reply  text="Tomorrow you have three meetings"'],
];

export function textTexture() {
  const random = generator(0x2545f491);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const rows = new Array(ROWS).fill('');

  const ledger = ledgerEntries(random, pick, BLOCKS.ledger.rows);
  ledger.forEach((entry, i) => (rows[BLOCKS.ledger.row + i] = entry));

  for (let i = 0; i < BLOCKS.raw.rows; i++) {
    let raw = '';
    let clean = '';
    while (raw.length < TEXT_WIDTH) {
      const [r, c] = pick(ARRIVALS);
      // Both streams advance together, so an arrival and its translation share columns.
      const width = Math.max(r.length, c.length) + 6 + Math.floor(random() * 24);
      raw += r.padEnd(width);
      clean += c.padEnd(width);
    }
    rows[BLOCKS.raw.row + i] = raw;
    rows[BLOCKS.clean.row + i] = clean;
  }
  PLUGINS.forEach(([name, kind, own], i) => {
    rows[BLOCKS.plugins.row + i] = name.padEnd(PLUGIN_KIND) + kind.padEnd(PLUGIN_OWN - PLUGIN_KIND) + (own ? '*' : '');
  });
  WORDS.forEach((word, i) => (rows[BLOCKS.words.row + i] = word));

  const data = new Uint8Array(TEXT_WIDTH * ROWS).fill(32);
  rows.forEach((row, r) => {
    for (let c = 0; c < Math.min(row.length, TEXT_WIDTH); c++) data[r * TEXT_WIDTH + c] = row.charCodeAt(c);
  });
  return { width: TEXT_WIDTH, height: ROWS, data };
}

function ledgerEntries(random, pick, count) {
  const id = (length) => Array.from({ length }, () => pick(CROCKFORD)).join('');
  let seq = 4812;
  let generation = 37;
  const entries = [];
  const write = (kind, fields) => entries.push(`1:${String(seq++).padStart(6, '0')}  ${kind.padEnd(19)}${fields}`);
  while (entries.length < count) {
    write('event_consumed', `source=channel/${pick(CHANNELS)}`);
    write('run_started', `run=01J${id(7)}`);
    const rounds = 1 + Math.floor(random() * 2);
    for (let round = 0; round < rounds; round++) {
      write('round_started', 'safe_mode=false');
      write('attempt_started', `plan=${id(8).toLowerCase()}  composer=g${generation}`);
      write('attempt_settled', 'result=ok');
      if (random() < 0.8) {
        write('tool_call_started', `capability=${pick(CAPABILITIES)}`);
        write('tool_call_settled', `outcome=${pick(OUTCOMES)}`);
      }
      write('round_ended', `end=${round === rounds - 1 ? 'replied' : 'tool_calls'}`);
    }
    write('run_ended', 'end=completed');
    if (random() < 0.3) generation++;
  }
  return entries.slice(0, count);
}

function generator(seed) {
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}
