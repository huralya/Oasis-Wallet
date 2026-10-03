// Minimal local QR generator for Oasis Wallet.
// Supports byte-mode QR Version 4 / ECC M, sufficient for Oasis and EVM addresses.
// No remote requests are made.
const G15 = 0x0537;
const G15_MASK = 0x5412;
const PAD0 = 0xec,
  PAD1 = 0x11;
const SIZE = 33; // Version 4: 4*4+17
const DATA_CODEWORDS = 64; // Version 4-M: 2 blocks * 32 data codewords
const BLOCKS = [
  { total: 50, data: 32 },
  { total: 50, data: 32 },
];

const EXP = new Array(512).fill(0),
  LOG = new Array(256).fill(0);
for (let i = 0; i < 8; i++) EXP[i] = 1 << i;
for (let i = 8; i < 256; i++) EXP[i] = EXP[i - 4] ^ EXP[i - 5] ^ EXP[i - 6] ^ EXP[i - 8];
for (let i = 0; i < 255; i++) LOG[EXP[i]] = i;
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const gexp = (n) => EXP[((n % 255) + 255) % 255];
const glog = (n) => {
  if (n < 1) throw new Error('QR log(0)');
  return LOG[n];
};

function polyMul(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      if (a[i] && b[j]) out[i + j] ^= gexp(glog(a[i]) + glog(b[j]));
  return trim(out);
}
function trim(a) {
  let i = 0;
  while (i < a.length - 1 && a[i] === 0) i++;
  return a.slice(i);
}
function rsGenerator(ec) {
  let p = [1];
  for (let i = 0; i < ec; i++) p = polyMul(p, [1, gexp(i)]);
  return p;
}
function rsRemainder(data, ec) {
  const gen = rsGenerator(ec),
    msg = data.concat(new Array(ec).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (!coef) continue;
    const logc = glog(coef);
    for (let j = 0; j < gen.length; j++) if (gen[j]) msg[i + j] ^= gexp(logc + glog(gen[j]));
  }
  return msg.slice(msg.length - ec);
}
class BitBuffer {
  constructor() {
    this.bytes = [];
    this.length = 0;
  }
  put(num, len) {
    for (let i = 0; i < len; i++) this.putBit(((num >> (len - i - 1)) & 1) !== 0);
  }
  putBit(bit) {
    const idx = Math.floor(this.length / 8);
    if (this.bytes.length <= idx) this.bytes.push(0);
    if (bit) this.bytes[idx] |= 0x80 >> (this.length % 8);
    this.length++;
  }
}
function makeCodewords(text) {
  const data = new TextEncoder().encode(text);
  if (data.length > 62) throw new Error('QR data too long');
  const b = new BitBuffer();
  b.put(0b0100, 4); // Byte mode
  b.put(data.length, 8); // version <10
  for (const x of data) b.put(x, 8);
  const bitLimit = DATA_CODEWORDS * 8;
  for (let i = 0; i < Math.min(4, bitLimit - b.length); i++) b.putBit(false);
  while (b.length % 8) b.putBit(false);
  let flip = false;
  while (b.bytes.length < DATA_CODEWORDS) {
    b.bytes.push(flip ? PAD1 : PAD0);
    flip = !flip;
  }
  const dc = [],
    ec = [];
  let off = 0;
  for (const block of BLOCKS) {
    const d = b.bytes.slice(off, off + block.data);
    off += block.data;
    dc.push(d);
    ec.push(rsRemainder(d, block.total - block.data));
  }
  const out = [];
  for (let i = 0; i < 32; i++) for (const d of dc) out.push(d[i]);
  for (let i = 0; i < 18; i++) for (const e of ec) out.push(e[i]);
  return out;
}
function bchDigit(x) {
  let n = 0;
  while (x) {
    n++;
    x >>>= 1;
  }
  return n;
}
function bchTypeInfo(data) {
  let d = data << 10;
  while (bchDigit(d) - bchDigit(G15) >= 0) d ^= G15 << (bchDigit(d) - bchDigit(G15));
  return ((data << 10) | d) ^ G15_MASK;
}
function maskFn(p, r, c) {
  switch (p) {
    case 0:
      return (r + c) % 2 === 0;
    case 1:
      return r % 2 === 0;
    case 2:
      return c % 3 === 0;
    case 3:
      return (r + c) % 3 === 0;
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7:
      return (((r * c) % 3) + ((r + c) % 2)) % 2 === 0;
    default:
      return false;
  }
}
function blankMatrix() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}
function setupProbe(m, row, col) {
  for (let r = -1; r <= 7; r++) {
    if (row + r < 0 || row + r >= SIZE) continue;
    for (let c = -1; c <= 7; c++) {
      if (col + c < 0 || col + c >= SIZE) continue;
      m[row + r][col + c] =
        (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
        (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
        (2 <= r && r <= 4 && 2 <= c && c <= 4);
    }
  }
}
function setupAlignment(m) {
  const pos = [6, 26];
  for (const row of pos)
    for (const col of pos) {
      if (m[row][col] !== null) continue;
      for (let r = -2; r <= 2; r++)
        for (let c = -2; c <= 2; c++)
          m[row + r][col + c] = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
    }
}
function setupTiming(m) {
  for (let r = 8; r < SIZE - 8; r++) if (m[r][6] === null) m[r][6] = r % 2 === 0;
  for (let c = 8; c < SIZE - 8; c++) if (m[6][c] === null) m[6][c] = c % 2 === 0;
}
function setupTypeInfo(m, test, mask) {
  const bits = bchTypeInfo(mask);
  for (let i = 0; i < 15; i++) {
    const mod = !test && ((bits >> i) & 1) === 1;
    if (i < 6) m[i][8] = mod;
    else if (i < 8) m[i + 1][8] = mod;
    else m[SIZE - 15 + i][8] = mod;
  }
  for (let i = 0; i < 15; i++) {
    const mod = !test && ((bits >> i) & 1) === 1;
    if (i < 8) m[8][SIZE - i - 1] = mod;
    else if (i < 9) m[8][15 - i] = mod;
    else m[8][15 - i - 1] = mod;
  }
  m[SIZE - 8][8] = !test;
}
function mapData(m, data, mask) {
  let inc = -1,
    row = SIZE - 1,
    bit = 7,
    idx = 0;
  for (let col = SIZE - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    while (true) {
      for (let k = 0; k < 2; k++) {
        const c = col - k;
        if (m[row][c] === null) {
          let dark = false;
          if (idx < data.length) dark = ((data[idx] >> bit) & 1) === 1;
          if (maskFn(mask, row, c)) dark = !dark;
          m[row][c] = dark;
          bit--;
          if (bit === -1) {
            idx++;
            bit = 7;
          }
        }
      }
      row += inc;
      if (row < 0 || row >= SIZE) {
        row -= inc;
        inc = -inc;
        break;
      }
    }
  }
}
function makeMatrix(codewords, mask, test = false) {
  const m = blankMatrix();
  setupProbe(m, 0, 0);
  setupProbe(m, SIZE - 7, 0);
  setupProbe(m, 0, SIZE - 7);
  setupAlignment(m);
  setupTiming(m);
  setupTypeInfo(m, test, mask);
  mapData(m, codewords, mask);
  return m;
}
function penalty(m) {
  let p = 0; // ISO/IEC 18004 penalties
  for (let r = 0; r < SIZE; r++) {
    let run = 1;
    for (let c = 1; c < SIZE; c++) {
      if (m[r][c] === m[r][c - 1]) run++;
      else {
        if (run >= 5) p += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) p += 3 + (run - 5);
  }
  for (let c = 0; c < SIZE; c++) {
    let run = 1;
    for (let r = 1; r < SIZE; r++) {
      if (m[r][c] === m[r - 1][c]) run++;
      else {
        if (run >= 5) p += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) p += 3 + (run - 5);
  }
  for (let r = 0; r < SIZE - 1; r++)
    for (let c = 0; c < SIZE - 1; c++) {
      const v = m[r][c];
      if (v === m[r + 1][c] && v === m[r][c + 1] && v === m[r + 1][c + 1]) p += 3;
    }
  const pat = [true, false, true, true, true, false, true, false, false, false, false];
  const rev = [false, false, false, false, true, false, true, true, true, false, true];
  const match = (arr, i, q) => q.every((v, j) => arr[i + j] === v);
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c <= SIZE - 11; c++) {
      const row = m[r];
      if (match(row, c, pat) || match(row, c, rev)) p += 40;
    }
  for (let c = 0; c < SIZE; c++) {
    const col = m.map((row) => row[c]);
    for (let r = 0; r <= SIZE - 11; r++) if (match(col, r, pat) || match(col, r, rev)) p += 40;
  }
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  p += Math.floor(Math.abs((dark * 100) / (SIZE * SIZE) - 50) / 5) * 10;
  return p;
}
export function qrMatrix(text) {
  const cw = makeCodewords(text);
  let best = null,
    bestP = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = makeMatrix(cw, mask, false),
      p = penalty(m);
    if (p < bestP) {
      bestP = p;
      best = m;
    }
  }
  return best;
}
export function qrSvg(text, { scale = 5, margin = 4 } = {}) {
  const m = qrMatrix(text),
    n = m.length,
    total = (n + margin * 2) * scale;
  let path = '';
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (m[r][c]) {
        const x = (c + margin) * scale,
          y = (r + margin) * scale;
        path += `M${x} ${y}h${scale}v${scale}h-${scale}z`;
      }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#08090c"/></svg>`;
}
