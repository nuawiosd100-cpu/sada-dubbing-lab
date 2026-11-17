// YouTube import through yt-dlp. Only publicly accessible videos are fetched:
// no cookies, no account sign-in, no DRM or restriction bypass.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { BIN_DIR, download, getFfmpeg, probe, run, sourcePath, videoDir, type RunOpts, type RunResult } from "./media";
import { YOUTUBE_QUALITIES, type YouTubeInfo, type YouTubeQuality } from "../types";

type YtState = { imports: Map<string, AbortController>; bin: Promise<string> | null; jsFlag: boolean };
const gy = globalThis as typeof globalThis & { __ytState?: YtState };
const st: YtState = (gy.__ytState ??= { imports: new Map(), bin: null, jsFlag: true });

const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"]);
export const UPLOAD_HINT =
  "If you own this video or have permission to use it, download the file yourself (for your own uploads: YouTube Studio → Content → ⋮ → Download) and use the “Upload from computer” tab instead.";

export class YouTubeError extends Error {
  hint = UPLOAD_HINT;
}

/** Accept only real YouTube links and rebuild a canonical URL from the video id. */
export function parseYouTubeUrl(input: string): { id: string; url: string } | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!/^https?:$/.test(u.protocol) || !HOSTS.has(host)) return null;
  let id: string | null = null;
  if (host.endsWith("youtu.be")) id = u.pathname.slice(1).split("/")[0];
  else if (u.pathname === "/watch") id = u.searchParams.get("v");
  else id = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname)?.[1] ?? null;
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}

const localBin = () => path.join(BIN_DIR, "yt-dlp");
export const ytDlpInstalled = () => fs.existsSync(localBin());

async function resolveYtDlp(): Promise<string> {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  try {
    if ((await run("yt-dlp", ["--version"])).code === 0) return "yt-dlp";
  } catch {
    /* not on PATH */
  }
  const bin = localBin();
  const stat = await fsp.stat(bin).catch(() => null);
  const fresh = stat && Date.now() - stat.mtimeMs < 14 * 86_400_000;
  if (!fresh) {
    const asset =
      process.platform === "linux"
        ? process.arch === "arm64"
          ? "yt-dlp_linux_aarch64"
          : "yt-dlp_linux"
        : process.platform === "darwin"
          ? "yt-dlp_macos"
          : null;
    if (!asset) throw new YouTubeError("YouTube import is not supported on this server's operating system.");
    try {
      await download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, bin);
    } catch (e) {
      if (!stat) throw new YouTubeError(`The YouTube import component could not be installed on the server: ${(e as Error).message}`);
    }
  }
  const check = await run(bin, ["--version"]).catch(() => null);
  if (!check || check.code !== 0) throw new YouTubeError("The YouTube import component is installed but could not be started on this server.");
  return bin;
}

function ensureYtDlp(): Promise<string> {
  if (!st.bin) {
    st.bin = resolveYtDlp().catch((e) => {
      st.bin = null;
      throw e;
    });
  }
  return st.bin;
}

async function ytRun(args: string[], opts: RunOpts = {}): Promise<RunResult> {
  const bin = await ensureYtDlp();
  const base = ["--ignore-config", "--no-playlist", "--no-cache-dir"];
  const js = () => (st.jsFlag ? ["--js-runtimes", `node:${process.execPath}`] : []);
  let r = await run(bin, [...base, ...js(), ...args], opts);
  if (r.code !== 0 && st.jsFlag && /no such option: --js-runtimes/i.test(r.stderr)) {
    st.jsFlag = false;
    r = await run(bin, [...base, ...args], opts);
  }
  return r;
}

export function explainYouTubeError(stderr: string): string {
  const has = (re: RegExp) => re.test(stderr);
  if (has(/confirm you.re not a bot|HTTP Error 429|Too Many Requests/i))
    return "YouTube refused this server's request with its anti-bot check (it asks automated visitors to sign in). The app does not bypass that restriction.";
  if (has(/Private video|video is private/i)) return "This video is private. Only videos that are publicly accessible without signing in can be imported.";
  if (has(/confirm your age|age.restricted/i)) return "This video is age-restricted and needs a signed-in YouTube account, which the app does not use.";
  if (has(/members-only|Join this channel|requires payment|rental|purchase/i)) return "This video requires a channel membership or a purchase.";
  if (has(/DRM/i)) return "This video is DRM-protected. Protected content can't be imported.";
  if (has(/not available in your country|geo.?restrict|blocked it in your country/i)) return "This video is not available in the server's region.";
  if (has(/live event will begin|Premieres in|is live|live stream/i)) return "Live streams and premieres can only be imported after they finish and are published as regular videos.";
  if (has(/Video unavailable|has been removed|does not exist|has been terminated/i)) return "YouTube reports that this video is unavailable or has been removed.";
  if (has(/Requested format is not available|No video formats found|Only images are available/i)) return "YouTube did not offer this server a downloadable video format for this video.";
  if (has(/timed out|Connection reset|getaddrinfo|Unable to download webpage/i)) return "The server could not reach YouTube (network error).";
  const line = stderr.split(/\r?\n/).reverse().find((l) => /ERROR/i.test(l));
  return line
    ? line.replace(/^ERROR:\s*/i, "").replace(/\[youtube\]\s*\S+:\s*/i, "").slice(0, 300)
    : "YouTube import failed for an unknown reason.";
}

export async function analyze(url: string): Promise<YouTubeInfo> {
  const parsed = parseYouTubeUrl(url);
  if (!parsed) throw new YouTubeError("That doesn't look like a YouTube video link. Paste a link such as https://www.youtube.com/watch?v=…");
  const r = await ytRun(["-J", "--no-warnings", parsed.url], { signal: AbortSignal.timeout(90_000) });
  if (r.code !== 0) throw new YouTubeError(explainYouTubeError(r.stderr));
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(r.stdout);
  } catch {
    throw new YouTubeError("YouTube returned video details that could not be read.");
  }
  const isLive = j.is_live === true || j.live_status === "is_live" || j.live_status === "is_upcoming";
  return {
    id: parsed.id,
    url: parsed.url,
    title: String(j.title ?? "YouTube video"),
    uploader: j.uploader ? String(j.uploader) : j.channel ? String(j.channel) : null,
    durationSec: typeof j.duration === "number" ? j.duration : null,
    thumbnail: typeof j.thumbnail === "string" ? j.thumbnail : null,
    isLive,
  };
}

/** Accept only the qualities the interface offers, defaulting to the previous best-up-to-1080p behaviour. */
export function parseQuality(value: unknown): YouTubeQuality {
  return YOUTUBE_QUALITIES.some((q) => q.id === value) ? (value as YouTubeQuality) : "best";
}

/** yt-dlp format selection: prefer an H.264/AAC progressive-friendly pair, capped at the chosen height. */
export function formatForQuality(quality: YouTubeQuality): string {
  const cap = quality === "best" ? 1080 : Number(quality);
  return (
    `bv*[vcodec^=avc1][height<=${cap}]+ba[acodec^=mp4a]` +
    `/bv*[height<=${cap}]+ba/b[height<=${cap}]/b`
  );
}

/** Download in the background; real progress is written to the video row. */
export function startImport(videoId: string, url: string, quality: YouTubeQuality = "best"): void {
  const abort = new AbortController();
  st.imports.set(videoId, abort);
  void (async () => {
    let lastWrite = 0;
    let stream = 0;
    let buf = "";
    const update = (progress: number, detail: string, force = false) => {
      const now = Date.now();
      if (!force && now - lastWrite < 700) return;
      lastWrite = now;
      void db.update(videos).set({ progress, statusDetail: detail }).where(eq(videos.id, videoId)).catch(() => {});
    };
    try {
      const dir = videoDir(videoId);
      await fsp.mkdir(dir, { recursive: true });
      update(0, "Preparing the YouTube import", true);
      const ff = await getFfmpeg();
      const r = await ytRun(
        ["-f", formatForQuality(quality), "--merge-output-format", "mp4", "--ffmpeg-location", ff, "--newline", "--progress-template",
          "download:PROG|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s",
          "-o", path.join(dir, "yt.%(ext)s"), url],
        {
          signal: abort.signal,
          onStdout: (chunk) => {
            buf += chunk;
            const lines = buf.split(/\r?\n/);
            buf = lines.pop() ?? "";
            for (const line of lines) {
              if (/^\[download\] Destination:/.test(line)) stream++;
              else if (line.startsWith("PROG|")) {
                const [, d, t, e] = line.split("|");
                const done = Number(d);
                const total = Number(t) || Number(e);
                if (total > 0) {
                  update(
                    Math.min(1, done / total),
                    `Downloading ${stream <= 1 ? "video" : "audio"} stream · ${(done / 1e6).toFixed(1)} of ${(total / 1e6).toFixed(1)} MB`,
                  );
                }
              } else if (/^\[Merger\]/.test(line)) update(1, "Merging video and audio", true);
            }
          },
        },
      );
      if (r.code !== 0) throw new YouTubeError(explainYouTubeError(r.stderr));
      const produced = (await fsp.readdir(dir)).find((f) => /^yt\.[a-z0-9]+$/i.test(f) && !f.endsWith(".part"));
      if (!produced) throw new YouTubeError("YouTube did not return a video file.");
      await fsp.rename(path.join(dir, produced), sourcePath(videoId));
      const info = await probe(sourcePath(videoId));
      if (!info.hasVideo || !info.hasAudio) throw new YouTubeError("The imported file has no usable video and audio track.");
      const size = (await fsp.stat(sourcePath(videoId))).size;
      await db
        .update(videos)
        .set({
          status: "ready",
          progress: 1,
          statusDetail: null,
          error: null,
          fileName: `youtube-${videoId.slice(0, 8)}.${produced.split(".").pop()}`,
          sizeBytes: size,
          receivedBytes: size,
          durationSec: info.durationSec,
          width: info.width,
          height: info.height,
          videoCodec: info.videoCodec,
          audioCodec: info.audioCodec,
          audioChannels: info.audioChannels,
        })
        .where(eq(videos.id, videoId));
    } catch (e) {
      if (!abort.signal.aborted) {
        const msg = e instanceof Error ? e.message : String(e);
        await db
          .update(videos)
          .set({ status: "failed", statusDetail: null, error: `${msg} ${UPLOAD_HINT}` })
          .where(eq(videos.id, videoId))
          .catch(() => {});
      }
    } finally {
      st.imports.delete(videoId);
    }
  })();
}

export function cancelImport(videoId: string): void {
  st.imports.get(videoId)?.abort();
}
