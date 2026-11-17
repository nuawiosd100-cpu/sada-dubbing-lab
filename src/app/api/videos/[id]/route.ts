import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { deleteVideo, getSession, json, toVideoView } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const [video] = await db.select().from(videos).where(eq(videos.id, id));
  if (!video || video.sessionId !== getSession(req)) return json({ error: "Video not found." }, 404);
  return json({ video: toVideoView(video) });
}

// Delete the source video, every dubbed result made from it and all cached audio.
export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const [video] = await db.select().from(videos).where(eq(videos.id, id));
  if (!video || video.sessionId !== getSession(req)) return json({ error: "Video not found." }, 404);
  await deleteVideo(id);
  return json({ deleted: true });
}
