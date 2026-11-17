import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, videos } from "@/db/schema";
import { resolveCredentials } from "@/lib/server/keys";
import { getSession, json, toJobView } from "@/lib/server/http";
import { enqueue, ensureInit, freshStages, sanitizeSettings } from "@/lib/server/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Start a dubbing run for an already uploaded / imported video.
export async function POST(req: Request) {
  const session = getSession(req);
  if (!session) return json({ error: "Missing session." }, 400);
  const body = (await req.json().catch(() => null)) as { videoId?: string; settings?: unknown } | null;
  const [video] = await db.select().from(videos).where(eq(videos.id, String(body?.videoId ?? "")));
  if (!video || video.sessionId !== session) return json({ error: "Video not found." }, 404);
  if (video.status !== "ready") return json({ error: "This video is not ready for processing yet." }, 409);
  if ((await resolveCredentials(session)).source === "none") {
    return json({ error: "No API key is active. Paste your Google AI Studio key in the “Google AI key” panel to activate the service." }, 503);
  }
  await ensureInit();
  const [job] = await db
    .insert(jobs)
    .values({
      id: crypto.randomUUID(),
      videoId: video.id,
      sessionId: session,
      status: "queued",
      stages: freshStages(),
      settings: sanitizeSettings(body?.settings),
      logs: [],
    })
    .returning();
  enqueue(job.id);
  return json({ job: toJobView(job) });
}
