import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, videos } from "@/db/schema";
import { deleteVideo, getSession, json, maybeSweep, toJobView, toVideoView } from "@/lib/server/http";
import { ensureInit } from "@/lib/server/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Everything that belongs to this browser session: source videos + dubbing runs.
export async function GET(req: Request) {
  const session = getSession(req);
  if (!session) return json({ videos: [], jobs: [] });
  await ensureInit();
  maybeSweep();
  const [v, j] = await Promise.all([
    db.select().from(videos).where(eq(videos.sessionId, session)).orderBy(desc(videos.createdAt)),
    db.select().from(jobs).where(eq(jobs.sessionId, session)).orderBy(desc(jobs.createdAt)),
  ]);
  return json({ videos: v.map(toVideoView), jobs: j.map(toJobView) });
}

// "Clear all": delete every video, result and cached file of this session.
export async function DELETE(req: Request) {
  const session = getSession(req);
  if (!session) return json({ error: "Missing session." }, 400);
  const rows = await db.select({ id: videos.id }).from(videos).where(eq(videos.sessionId, session));
  for (const r of rows) await deleteVideo(r.id);
  return json({ deleted: rows.length });
}
