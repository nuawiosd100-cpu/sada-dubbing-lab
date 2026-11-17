import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, jobs, videos } from "@/db/schema";
import { cancelJob, waitForJobToStop } from "./pipeline";
import { cancelImport } from "./youtube";
import { cancelDirectImport } from "./direct";
import { DATA_DIR, jobDir, removeDir, videoDir } from "./media";
import { MIN_SEPARATION_MEMORY, memoryLimitBytes } from "./separation";
import type { JobView, VideoView } from "../types";

export const CHUNK_SIZE = 4 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 ** 3);

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Anonymous browser session id (no accounts): scopes the history to one browser. */
export function getSession(req: Request): string | null {
  const s = req.headers.get("x-session-id") ?? "";
  return /^[A-Za-z0-9_-]{12,64}$/.test(s) ? s : null;
}

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  ts: "video/mp2t",
  flv: "video/x-flv",
  wmv: "video/x-ms-wmv",
  "3gp": "video/3gpp",
  ogv: "video/ogg",
};
export const VIDEO_EXTENSIONS = Object.keys(MIME);
export const mimeFor = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

export const toVideoView = (v: typeof videos.$inferSelect): VideoView => {
  const { sessionId: _s, ...rest } = v;
  void _s;
  return { ...rest, createdAt: v.createdAt.toISOString() } as VideoView;
};

export const toJobView = (j: typeof jobs.$inferSelect): JobView => {
  const { sessionId: _s, ...rest } = j;
  void _s;
  return {
    ...rest,
    createdAt: j.createdAt.toISOString(),
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
  } as JobView;
};

function fileStream(file: string, start: number, end: number): ReadableStream<Uint8Array> {
  const rs = fs.createReadStream(file, { start, end, highWaterMark: 256 * 1024 });
  let closed = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      rs.on("data", (chunk) => {
        if (closed) return;
        controller.enqueue(new Uint8Array(chunk as Buffer));
        if ((controller.desiredSize ?? 1) <= 0) rs.pause();
      });
      rs.on("end", () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      });
      rs.on("error", (e) => {
        if (!closed) {
          closed = true;
          controller.error(e);
        }
      });
    },
    pull() {
      rs.resume();
    },
    cancel() {
      closed = true;
      rs.destroy();
    },
  });
}

/** Stream a file with HTTP Range support so the browser player can seek in long videos. */
export async function serveFile(
  req: Request,
  file: string,
  opts: { contentType: string; downloadName?: string },
): Promise<Response> {
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat || !stat.isFile()) return json({ error: "File not found." }, 404);
  const size = stat.size;
  const headers: Record<string, string> = {
    "Content-Type": opts.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
  };
  if (opts.downloadName) {
    const ascii = opts.downloadName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    headers["Content-Disposition"] = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(opts.downloadName)}`;
  }
  let start = 0;
  let end = size - 1;
  let status = 200;
  const m = /^bytes=(\d*)-(\d*)$/.exec((req.headers.get("range") ?? "").trim());
  if (m && (m[1] || m[2]) && size > 0) {
    if (!m[1]) start = Math.max(0, size - Number(m[2]));
    else {
      start = Number(m[1]);
      if (m[2]) end = Math.min(size - 1, Number(m[2]));
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(size === 0 ? 0 : end - start + 1);
  if (size === 0 || req.method === "HEAD") return new Response(null, { status, headers });
  return new Response(fileStream(file, start, end), { status, headers });
}

export async function deleteJob(jobId: string): Promise<void> {
  await cancelJob(jobId);
  await waitForJobToStop(jobId);
  await db.delete(jobs).where(eq(jobs.id, jobId));
  await removeDir(jobDir(jobId));
}

export const RETENTION_HOURS = Math.max(1, Number(process.env.RETENTION_HOURS ?? 72));
const gs = globalThis as typeof globalThis & { __lastSweep?: number };

/** Housekeeping for a public, login-free tool: remove videos older than the retention window. */
export function maybeSweep(): void {
  const now = Date.now();
  if (now - (gs.__lastSweep ?? 0) < 30 * 60_000) return;
  gs.__lastSweep = now;
  void (async () => {
    const cutoff = new Date(now - RETENTION_HOURS * 3600_000);
    const old = await db.select({ id: videos.id }).from(videos).where(lt(videos.createdAt, cutoff));
    for (const v of old) await deleteVideo(v.id);
    // Personal API keys are not kept forever either: drop any stored for more than 30 days.
    await db.delete(apiKeys).where(lt(apiKeys.createdAt, new Date(now - 30 * 86_400_000)));
  })().catch(() => {});
}

/** Reclaim space left behind by failed/cancelled runs before accepting new uploads. */
export async function reclaimDiskSpace(): Promise<void> {
  const stale = await db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.status, ["failed", "canceled"]));
  for (const j of stale) await removeDir(jobDir(j.id));
  const all = await db.select({ id: videos.id }).from(videos);
  for (const v of all) {
    for (const model of ["mrx", "tiger"] as const) {
      const dir = path.join(videoDir(v.id), `stems-${model}`);
      const meta = await fsp.stat(path.join(dir, "metadata.json")).catch(() => null);
      if (!meta) await removeDir(dir); // incomplete separation attempt
    }
  }
  // The neural models are useless on a small-memory server and can be large.
  const memory = await memoryLimitBytes().catch(() => null);
  if (memory !== null && memory < MIN_SEPARATION_MEMORY) await removeDir(path.join(DATA_DIR, "models"));
}

export async function deleteVideo(videoId: string): Promise<void> {
  cancelImport(videoId);
  cancelDirectImport(videoId);
  const related = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.videoId, videoId));
  for (const j of related) {
    await cancelJob(j.id);
    await waitForJobToStop(j.id);
    await removeDir(jobDir(j.id));
  }
  await db.delete(videos).where(eq(videos.id, videoId)); // jobs + transcripts cascade
  await removeDir(videoDir(videoId));
}
