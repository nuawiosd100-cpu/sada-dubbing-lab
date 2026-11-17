import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, videos } from "@/db/schema";
import { json, serveFile } from "@/lib/server/http";
import { outputPath } from "@/lib/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Streams the finished Arabic-dubbed MP4 (for the player, or as a download with ?download=1).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!job || job.status !== "completed") return json({ error: "Result not found." }, 404);
  let downloadName: string | undefined;
  if (new URL(req.url).searchParams.get("download")) {
    const [video] = await db.select().from(videos).where(eq(videos.id, job.videoId));
    const base = (video?.title ?? "video").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim().slice(0, 120) || "video";
    downloadName = `${base} (${job.settings.targetLanguage === "en" ? "English" : "Arabic"} dub - ${job.settings.voice}).mp4`;
  }
  return serveFile(req, outputPath(id), { contentType: "video/mp4", downloadName });
}
