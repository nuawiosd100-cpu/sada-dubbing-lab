import crypto from "node:crypto";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { getSession, json, toVideoView } from "@/lib/server/http";
import { ensureInit } from "@/lib/server/pipeline";
import { UPLOAD_HINT, analyze, parseQuality, startImport } from "@/lib/server/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// action "analyze": read the real video details from YouTube.
// action "import":  download the real video + audio into the same store as uploads.
export async function POST(req: Request) {
  const session = getSession(req);
  if (!session) return json({ error: "Missing session." }, 400);
  const body = (await req.json().catch(() => null)) as { action?: string; url?: string; confirmRights?: boolean; quality?: string } | null;
  const url = String(body?.url ?? "");
  try {
    const info = await analyze(url);
    if (info.isLive) {
      return json({ error: "Live streams and premieres can only be imported after they finish.", hint: UPLOAD_HINT }, 422);
    }
    if (body?.action !== "import") return json({ info });
    if (body.confirmRights !== true) {
      return json({ error: "Please confirm that you own this video or have permission to download and process it." }, 400);
    }
    await ensureInit();
    const id = crypto.randomUUID();
    const [video] = await db
      .insert(videos)
      .values({
        id,
        sessionId: session,
        source: "youtube",
        sourceUrl: info.url,
        title: info.title.slice(0, 200),
        fileName: `youtube-${info.id}.mp4`,
        status: "importing",
        statusDetail: "Starting the download",
        durationSec: info.durationSec,
      })
      .returning();
    startImport(id, info.url, parseQuality(body?.quality));
    return json({ video: toVideoView(video), info });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "YouTube import failed.", hint: UPLOAD_HINT }, 422);
  }
}
