import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { json, mimeFor, serveFile } from "@/lib/server/http";
import { sourcePath } from "@/lib/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Streams the original source video (the id is an unguessable UUID).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [video] = await db.select().from(videos).where(eq(videos.id, id));
  if (!video || video.status !== "ready") return json({ error: "Video not found." }, 404);
  return serveFile(req, sourcePath(id), { contentType: mimeFor(video.fileName) });
}
