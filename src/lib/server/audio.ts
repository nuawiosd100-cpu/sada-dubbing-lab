// PCM helpers for the Arabic voice track. Everything here is 24 kHz, mono, 16-bit.
import { getFfmpeg, run } from "./media";

export const RATE = 24000;
const FRAME = 240; // 10 ms

export function toSamples(buf: Buffer): Int16Array {
  const n = Math.floor(buf.length / 2);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}

export function toBuffer(s: Int16Array): Buffer {
  const b = Buffer.alloc(s.length * 2);
  for (let i = 0; i < s.length; i++) b.writeInt16LE(s[i], i * 2);
  return b;
}

function frameRms(s: Int16Array): Float32Array {
  const n = Math.floor(s.length / FRAME);
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    const o = f * FRAME;
    for (let i = 0; i < FRAME; i++) {
      const v = s[o + i];
      sum += v * v;
    }
    out[f] = Math.sqrt(sum / FRAME);
  }
  return out;
}

function quietThreshold(fr: Float32Array): number {
  if (!fr.length) return 150;
  const sorted = Float32Array.from(fr).sort();
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  return Math.max(120, p95 * 0.045);
}

export type Gap = { start: number; end: number }; // sample offsets

/** Find pauses (runs of quiet 10 ms frames) of at least `minSec`. */
export function findSilences(s: Int16Array, minSec: number): Gap[] {
  const fr = frameRms(s);
  const thr = quietThreshold(fr);
  const minFrames = Math.max(1, Math.round((minSec * RATE) / FRAME));
  const gaps: Gap[] = [];
  let runStart = -1;
  for (let f = 0; f <= fr.length; f++) {
    const quiet = f < fr.length && fr[f] < thr;
    if (quiet) {
      if (runStart < 0) runStart = f;
    } else if (runStart >= 0) {
      if (f - runStart >= minFrames) gaps.push({ start: runStart * FRAME, end: f * FRAME });
      runStart = -1;
    }
  }
  return gaps;
}

export function trimSilence(s: Int16Array, padSec = 0.03): Int16Array {
  const fr = frameRms(s);
  const thr = quietThreshold(fr);
  let a = 0;
  let b = fr.length - 1;
  while (a < fr.length && fr[a] < thr) a++;
  if (a >= fr.length) return new Int16Array(0);
  while (b > a && fr[b] < thr) b--;
  const pad = Math.round(padSec * RATE);
  return s.slice(Math.max(0, a * FRAME - pad), Math.min(s.length, (b + 1) * FRAME + pad));
}

/** Bring a clip to a consistent speech loudness, with short fades to avoid clicks. */
export function normalize(s: Int16Array, targetRms = 3200, maxPeak = 30000): Int16Array {
  if (!s.length) return s;
  const fr = frameRms(s);
  const thr = quietThreshold(fr);
  let sum = 0;
  let count = 0;
  for (const v of fr) {
    if (v >= thr) {
      sum += v * v;
      count++;
    }
  }
  let peak = 1;
  for (let i = 0; i < s.length; i++) {
    const a = Math.abs(s[i]);
    if (a > peak) peak = a;
  }
  const rms = count ? Math.sqrt(sum / count) : 0;
  let gain = rms > 1 ? targetRms / rms : 1;
  gain = Math.max(0.25, Math.min(5, gain));
  gain = Math.min(gain, maxPeak / peak);
  const out = new Int16Array(s.length);
  const fade = Math.min(Math.round(RATE * 0.008), Math.floor(s.length / 2));
  for (let i = 0; i < s.length; i++) {
    let g = gain;
    if (i < fade) g *= i / fade;
    else if (i >= s.length - fade) g *= (s.length - 1 - i) / fade;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(s[i] * g)));
  }
  return out;
}

/**
 * Split one recording that contains `weights.length` lines (read in order, with
 * pauses between them) back into one clip per line. Boundaries are chosen among
 * detected pauses by dynamic programming: each boundary should sit close to the
 * position predicted by the relative text lengths, and longer pauses are preferred.
 */
export function splitByLines(s: Int16Array, weights: number[]): Int16Array[] | null {
  const n = weights.length;
  if (n <= 1) return [s];
  const interior = (gaps: Gap[]) => gaps.filter((g) => g.start > FRAME * 5 && g.end < s.length - FRAME * 5);
  let gaps = interior(findSilences(s, 0.16));
  if (gaps.length < n - 1) gaps = interior(findSilences(s, 0.07));
  // Not enough pauses to separate the lines safely: the caller regenerates in smaller batches
  // rather than risk cutting through a word.
  if (gaps.length < n - 1) return null;

  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const cum: number[] = [];
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    acc += weights[i];
    cum.push(acc / total);
  }

  let cuts: number[];
  const silent = gaps.reduce((a, g) => a + (g.end - g.start), 0);
  const voiced = Math.max(1, s.length - silent);
  {
    // voiced audio that precedes each pause
    const before: number[] = [];
    let silentSoFar = 0;
    for (const g of gaps) {
      before.push(g.start - silentSoFar);
      silentSoFar += g.end - g.start;
    }
    const m = gaps.length;
    const cost = (k: number, j: number) => {
      const dist = Math.abs(before[j] - cum[k] * voiced) / RATE;
      const len = Math.min((gaps[j].end - gaps[j].start) / RATE, 0.9);
      return dist - 1.2 * len;
    };
    const dp: number[][] = Array.from({ length: n - 1 }, () => new Array<number>(m).fill(Infinity));
    const from: number[][] = Array.from({ length: n - 1 }, () => new Array<number>(m).fill(-1));
    for (let j = 0; j < m; j++) dp[0][j] = cost(0, j);
    for (let k = 1; k < n - 1; k++) {
      let best = Infinity;
      let bestJ = -1;
      for (let j = k; j < m; j++) {
        if (dp[k - 1][j - 1] < best) {
          best = dp[k - 1][j - 1];
          bestJ = j - 1;
        }
        if (bestJ >= 0) {
          dp[k][j] = best + cost(k, j);
          from[k][j] = bestJ;
        }
      }
    }
    let j = 0;
    for (let x = 1; x < m; x++) if (dp[n - 2][x] < dp[n - 2][j]) j = x;
    const chosen: number[] = new Array<number>(n - 1);
    for (let k = n - 2; k >= 0; k--) {
      chosen[k] = j;
      j = from[k][j];
    }
    cuts = chosen.map((idx) => Math.round((gaps[idx].start + gaps[idx].end) / 2));
  }

  const parts: Int16Array[] = [];
  let prev = 0;
  for (const c of cuts) {
    parts.push(s.slice(prev, c));
    prev = c;
  }
  parts.push(s.slice(prev));

  // Sanity check: every part should be roughly as long as its share of the text predicts.
  for (let i = 0; i < n; i++) {
    const expected = (voiced * weights[i]) / total;
    const actual = trimSilence(parts[i], 0).length;
    if (actual < expected * 0.3 || actual > expected * 3) return null;
  }
  return parts;
}

/** Speed a clip up (pitch preserved) so it fits its slot in the video. */
export async function stretch(pcm: Buffer, tempo: number, signal?: AbortSignal): Promise<Buffer> {
  const ff = await getFfmpeg();
  const r = await run(
    ff,
    ["-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", String(RATE), "-ac", "1", "-i", "pipe:0",
      "-filter:a", `atempo=${tempo.toFixed(4)}`, "-f", "s16le", "-ar", String(RATE), "-ac", "1", "pipe:1"],
    { input: pcm, binary: true, signal },
  );
  if (r.code !== 0 || !r.stdoutBuffer?.length) return pcm;
  return r.stdoutBuffer;
}

export function wavFromPcm(pcm: Buffer, rate = RATE): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
