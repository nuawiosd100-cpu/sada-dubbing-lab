import fsp from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { getSession, json, toVideoView } from "@/lib/server/http";
import { probe, sourcePath } from "@/lib/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function load(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const [video] = await db.select().from(videos).where(eq(videos.id, id));
  if (!video || video.sessionId !== getSession(req)) return null;
  return video;
}

// Append one chunk. `offset` must equal the bytes already stored, which makes
// retries safe: on a mismatch the client is told where to resume.
export async function PUT(req: Request, ctx: Ctx) {
  const video = await load(req, ctx);
  if (!video) return json({ error: "Upload not found." }, 404);
  if (video.status !== "uploading") return json({ error: "This upload is already finished." }, 409);
  const offset = Number(new URL(req.url).searchParams.get("offset"));
  const file = sourcePath(video.id);
  const have = (await fsp.stat(file).catch(() => null))?.size ?? 0;
  if (offset !== have) return json({ error: "Offset mismatch.", received: have }, 409);
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return json({ error: "Empty chunk.", received: have }, 400);
  if (have + buf.length > video.sizeBytes) return json({ error: "More data was sent than announced." }, 413);
  await fsp.appendFile(file, buf);
  const received = have + buf.length;
  await db.update(videos).set({ receivedBytes: received, progress: received / video.sizeBytes }).where(eq(videos.id, video.id));
  return json({ received });
}

// Finish the upload: verify the size and inspect the file with FFmpeg.
export async function POST(req: Request, ctx: Ctx) {
  const video = await load(req, ctx);
  if (!video) return json({ error: "Upload not found." }, 404);
  if (video.status === "ready") return json({ video: toVideoView(video) });
  const file = sourcePath(video.id);
  const have = (await fsp.stat(file).catch(() => null))?.size ?? 0;
  if (have !== video.sizeBytes) return json({ error: "The upload is incomplete.", received: have }, 409);

  const fail = async (error: string) => {
    const [v] = await db.update(videos).set({ status: "failed", error }).where(eq(videos.id, video.id)).returning();
    return json({ video: toVideoView(v), error }, 422);
  };
  let info;
  try {
    info = await probe(file);
  } catch (e) {
    return fail(`The server could not inspect this file: ${(e as Error).message}`);
  }
  if (!info.hasVideo) return fail("This file does not contain a video stream the server can read.");
  if (!info.hasAudio) return fail("This video has no audio track, so there is no dialogue to dub.");
  if (!info.durationSec) return fail("The server could not determine this video's duration.");

  const [v] = await db
    .update(videos)
    .set({
      status: "ready",
      progress: 1,
      receivedBytes: have,
      error: null,
      durationSec: info.durationSec,
      width: info.width,
      height: info.height,
      videoCodec: info.videoCodec,
      audioCodec: info.audioCodec,
      audioChannels: info.audioChannels,
    })
    .where(eq(videos.id, video.id))
    .returning();
  return json({ video: toVideoView(v) });
}
