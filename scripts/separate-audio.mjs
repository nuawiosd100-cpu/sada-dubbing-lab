// Local cinematic source-separation worker. Runs outside the Next.js bundle so ONNX
// native code, model sessions and large audio buffers have their own process lifetime.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const input = arg("input");
const outDir = arg("out");
const model = arg("model", "mrx");
const ffmpeg = arg("ffmpeg", "ffmpeg");
const duration = Number(arg("duration", "0"));
const RATE = 44100;
const STEP = 20; // seconds of soundtrack per outer chunk
const CONTEXT = 2; // extra audio on each side, discarded after inference
const OVERLAP = 0.05; // core overlap used for click-free crossfades
const OVERLAP_N = Math.round(RATE * OVERLAP);
const STEMS = ["dialogue", "effects", "music"];

if (!input || !outDir || !duration || !["mrx", "tiger"].includes(model)) {
  console.error("Usage: separate-audio.mjs --input file --out dir --duration seconds --model mrx|tiger --ffmpeg path");
  process.exit(2);
}

process.env.AUDIO_NEURAL_CACHE = arg("cache", path.join(process.cwd(), ".data", "models"));
process.env.OMP_NUM_THREADS ||= "4";

const emit = (data) => process.stdout.write(`${JSON.stringify(data)}\n`);

async function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.split(/\r?\n/).filter(Boolean).slice(-4).join(" | ") || `${command} exited ${code}`)));
  });
}

function pcmBuffer(samples) {
  const out = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    out.writeInt16LE(Math.round(v * (v < 0 ? 32768 : 32767)), i * 2);
  }
  return out;
}

/** Writes one stem, crossfading the 50 ms overlap between outer chunks. */
class StemWriter {
  constructor(file) {
    this.stream = fs.createWriteStream(file);
    this.carry = new Float32Array(0);
  }
  async raw(samples) {
    if (!samples.length) return;
    const buf = pcmBuffer(samples);
    if (!this.stream.write(buf)) await new Promise((resolve) => this.stream.once("drain", resolve));
  }
  async write(samples, isLast) {
    let start = 0;
    if (this.carry.length && samples.length) {
      const n = Math.min(this.carry.length, samples.length);
      const blended = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        blended[i] = this.carry[i] * (1 - t) + samples[i] * t;
      }
      await this.raw(blended);
      start = n;
    }
    const keep = isLast ? 0 : Math.min(OVERLAP_N, Math.max(0, samples.length - start));
    const end = samples.length - keep;
    if (end > start) await this.raw(samples.subarray(start, end));
    this.carry = keep ? samples.slice(end) : new Float32Array(0);
  }
  async finish() {
    await this.raw(this.carry);
    this.carry = new Float32Array(0);
    await new Promise((resolve, reject) => {
      this.stream.once("error", reject);
      this.stream.end(resolve);
    });
  }
}

async function main() {
  await fsp.mkdir(outDir, { recursive: true });
  const rawPaths = Object.fromEntries(STEMS.map((s) => [s, path.join(outDir, `${s}.pcm`)]));
  const flacPaths = Object.fromEntries(STEMS.map((s) => [s, path.join(outDir, `${s}.flac`)]));
  for (const s of STEMS) {
    await fsp.rm(rawPaths[s], { force: true });
    await fsp.rm(flacPaths[s], { force: true });
  }
  await fsp.rm(path.join(outDir, "metadata.json"), { force: true });

  const { default: separate } = await import("@audio/neural-separate");
  const { load } = await import("@audio/neural-runtime");
  const sessions = new Map();
  const session = async (spec) => {
    const key = String(spec);
    if (!sessions.has(key)) {
      emit({ type: "model", model, message: `Loading ${model} cinematic separation model` });
      const native = await load(spec, {
        backend: "node",
        sessionOptions: { enableCpuMemArena: false, enableMemPattern: false },
      });
      // separate() calls free() after every invocation. Keep the native session alive across
      // outer movie chunks and release it explicitly after the final chunk instead.
      sessions.set(key, {
        native,
        shared: {
          run: (feeds, outputNames) => native.run(feeds, outputNames),
          inputs: native.inputs,
          outputs: native.outputs,
          backend: native.backend,
          free: () => {},
        },
      });
    }
    return sessions.get(key).shared;
  };

  const total = Math.max(1, Math.ceil(duration / STEP));
  const writers = Object.fromEntries(STEMS.map((s) => [s, new StemWriter(rawPaths[s])]));
  const chunkPath = path.join(outDir, "input-chunk.f32");

  for (let i = 0; i < total; i++) {
    const nominalStart = i * STEP;
    const nominalEnd = Math.min(duration, (i + 1) * STEP);
    const isLast = i === total - 1;
    const coreStart = i === 0 ? 0 : Math.max(0, nominalStart - OVERLAP / 2);
    const coreEnd = isLast ? duration : Math.min(duration, nominalEnd + OVERLAP / 2);
    const readStart = Math.max(0, coreStart - CONTEXT);
    const readEnd = Math.min(duration, coreEnd + CONTEXT);
    await run(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-ss", readStart.toFixed(4), "-t", (readEnd - readStart).toFixed(4), "-i", input,
      "-vn", "-map", "0:a:0", "-ac", "1", "-ar", String(RATE), "-f", "f32le", chunkPath,
    ]);
    const bytes = await fsp.readFile(chunkPath);
    const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4));
    const result = await separate([samples], {
      sampleRate: RATE,
      model,
      session,
      progress: (p) => emit({ type: "chunk", outer: i + 1, total, inner: p.chunk, innerTotal: p.totalChunks }),
    });
    const trimStart = Math.max(0, Math.round((coreStart - readStart) * RATE));
    const trimEnd = Math.min(samples.length, Math.round((coreEnd - readStart) * RATE));
    for (const stem of STEMS) {
      const source = result.stems[stem]?.[0];
      if (!source) throw new Error(`The ${model} model did not return the ${stem} stem.`);
      await writers[stem].write(source.subarray(trimStart, trimEnd), isLast);
    }
    emit({ type: "outer-done", outer: i + 1, total });
    await fsp.rm(chunkPath, { force: true });
  }
  for (const stem of STEMS) await writers[stem].finish();
  await fsp.rm(chunkPath, { force: true });

  for (const stem of STEMS) {
    await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "s16le", "-ar", String(RATE), "-ac", "1", "-i", rawPaths[stem], "-c:a", "flac", "-compression_level", "5", flacPaths[stem]]);
    await fsp.rm(rawPaths[stem], { force: true });
  }
  for (const active of sessions.values()) active.native.free();
  const metadata = { model, sampleRate: RATE, channels: 1, durationSec: duration, stems: STEMS, createdAt: new Date().toISOString() };
  await fsp.writeFile(path.join(outDir, "metadata.json"), JSON.stringify(metadata, null, 2));
  emit({ type: "done", metadata });
}

main().catch((error) => {
  emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
  console.error(error);
  process.exitCode = 1;
});
