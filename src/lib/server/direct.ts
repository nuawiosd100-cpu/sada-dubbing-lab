// Import a video from a direct download link. The bytes go into the same store as
// uploads and YouTube imports, then the same probe/dub pipeline takes over.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { probe, sourcePath, videoDir } from "./media";
import type { DirectLinkInfo } from "../types";

const MAX_LINK_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 ** 3);
export const LINK_HINT =
  "Check that the link is public, points directly at a video file and has not expired. You can also download the file yourself and use the “Upload from computer” tab.";

export class DirectLinkError extends Error {
  hint = LINK_HINT;
}

/** Block local/private targets by default so a pasted URL cannot reach the server's own network. */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa")) return true;
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h)?.[1] ?? h;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return true;
  }
  return h === "::1" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
}

function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new DirectLinkError("Paste a full http:// or https:// link to the video file.");
  }
  if (!/^https?:$/.test(u.protocol)) throw new DirectLinkError("Only http:// and https:// download links are supported.");
  if (u.username || u.password) throw new DirectLinkError("Links that contain a username or password are not supported.");
  const allowPrivate = process.env.ALLOW_PRIVATE_LINKS === "1";
  if (!allowPrivate && isPrivateHost(u.hostname)) {
    throw new DirectLinkError("Links to localhost or a private network address are blocked. Set ALLOW_PRIVATE_LINKS=1 on the server if this is intentional.");
  }
  return u;
}

function checkFinal(url: string): void {
  assertPublicUrl(url);
}

function fileNameFor(u: URL, disposition: string | null): string {
  const star = disposition && /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = disposition && /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  let name = star ? decodeURIComponent(star) : plain ? decodeURIComponent(plain) : decodeURIComponent(path.posix.basename(u.pathname));
  name = path.basename(name).replace(/[\r\n]/g, "").slice(0, 180);
  return name || "downloaded-video";
}

/** Read the real headers (with a ranged GET fallback for servers that refuse HEAD). */
export async function analyzeDirect(input: string): Promise<DirectLinkInfo> {
  const target = assertPublicUrl(input);
  let res: Response;
  try {
    res = await fetch(target, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(25_000) });
    checkFinal(res.url);
  } catch (e) {
    if (e instanceof DirectLinkError) throw e;
    throw new DirectLinkError(`The link could not be reached: ${(e as Error).message}`);
  }

  if (!res.ok) {
    try {
      const ranged = await fetch(target, { headers: { Range: "bytes=0-0" }, redirect: "follow", signal: AbortSignal.timeout(25_000) });
      checkFinal(ranged.url);
      if (!ranged.ok) throw new DirectLinkError(`The link did not respond (HTTP ${ranged.status}).`);
      await ranged.body?.cancel();
      res = ranged;
    } catch (e) {
      if (e instanceof DirectLinkError) throw e;
      throw new DirectLinkError(`The link could not be reached: ${(e as Error).message}`);
    }
  }

  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? null;
  if (contentType && /^text\/html$/i.test(contentType)) {
    throw new DirectLinkError("This link serves a web page, not a video file. Paste a direct link to the media itself.");
  }
  const total = /\/(\d+)/.exec(res.headers.get("content-range") ?? "")?.[1] ?? res.headers.get("content-length") ?? "";
  const size = Number(total) || null;
  const final = res.url ? new URL(res.url) : target;
  return { url: target.toString(), name: fileNameFor(final, res.headers.get("content-disposition")), size, contentType };
}

type DirectState = { imports: Map<string, AbortController>; userCanceled: Set<string> };
const g = globalThis as typeof globalThis & { __directState?: DirectState };
const st: DirectState = (g.__directState ??= { imports: new Map(), userCanceled: new Set() });

/** Download in the background; real progress is written to the video row. */
export function startDirectImport(videoId: string, info: DirectLinkInfo): void {
  const abort = new AbortController();
  st.imports.set(videoId, abort);
  void (async () => {
    let lastWrite = 0;
    const update = (progress: number, detail: string, force = false) => {
      const now = Date.now();
      if (!force && now - lastWrite < 700) return;
      lastWrite = now;
      void db.update(videos).set({ progress, statusDetail: detail }).where(eq(videos.id, videoId)).catch(() => {});
    };
    const tmp = `${sourcePath(videoId)}.part`;
    try {
      await fsp.mkdir(videoDir(videoId), { recursive: true });
      update(0, "Preparing the download", true);
      const target = assertPublicUrl(info.url);
      const res = await fetch(target, { signal: abort.signal, redirect: "follow" });
      checkFinal(res.url);
      if (!res.ok || !res.body) throw new DirectLinkError(`The link returned HTTP ${res.status}.`);
      const total = Number(res.headers.get("content-length")) || info.size || 0;
      if (total > MAX_LINK_BYTES) throw new DirectLinkError("This file is larger than the server's upload limit.");

      let done = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          done += (chunk as Buffer).length;
          if (done > MAX_LINK_BYTES) {
            cb(new DirectLinkError("The download exceeded the server's upload limit."));
            return;
          }
          if (total > 0) update(Math.min(1, done / total), `Downloading · ${(done / 1e6).toFixed(1)} of ${(total / 1e6).toFixed(1)} MB`);
          cb(null, chunk);
        },
      });
      await streamPipeline(Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream), counter, fs.createWriteStream(tmp));
      update(1, "Inspecting the downloaded file", true);
      await fsp.rename(tmp, sourcePath(videoId));
      const p = await probe(sourcePath(videoId));
      if (!p.hasVideo || !p.hasAudio) throw new DirectLinkError("The downloaded file has no usable video and audio track.");
      const size = (await fsp.stat(sourcePath(videoId))).size;
      await db
        .update(videos)
        .set({
          status: "ready",
          progress: 1,
          statusDetail: null,
          error: null,
          fileName: info.name,
          sizeBytes: size,
          receivedBytes: size,
          durationSec: p.durationSec,
          width: p.width,
          height: p.height,
          videoCodec: p.videoCodec,
          audioCodec: p.audioCodec,
          audioChannels: p.audioChannels,
        })
        .where(eq(videos.id, videoId));
    } catch (e) {
      if (!st.userCanceled.has(videoId)) {
        await fsp.rm(tmp, { force: true }).catch(() => {});
        const msg = e instanceof Error ? e.message : String(e);
        await db
          .update(videos)
          .set({ status: "failed", statusDetail: null, error: `${msg} ${LINK_HINT}` })
          .where(eq(videos.id, videoId))
          .catch(() => {});
      }
    } finally {
      st.userCanceled.delete(videoId);
      st.imports.delete(videoId);
    }
  })();
}

export function cancelDirectImport(videoId: string): void {
  st.userCanceled.add(videoId);
  st.imports.get(videoId)?.abort();
}
