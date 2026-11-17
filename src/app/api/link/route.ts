import crypto from "node:crypto";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { getSession, json, toVideoView } from "@/lib/server/http";
import { ensureInit } from "@/lib/server/pipeline";
import { analyzeDirect, LINK_HINT, startDirectImport } from "@/lib/server/direct";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// action "analyze": read the headers of a direct media link.
// action "import":  download it into the same store as uploads/YouTube imports.
export async function POST(req: Request) {
  const session = getSession(req);
  if (!session) return json({ error: "Missing session." }, 400);
  const body = (await req.json().catch(() => null)) as { action?: string; url?: string; confirmRights?: boolean } | null;
  const url = String(body?.url ?? "");
  try {
    const info = await analyzeDirect(url);
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
        source: "link",
        sourceUrl: info.url,
        title: info.name.slice(0, 200),
        fileName: info.name,
        status: "importing",
        statusDetail: "Starting the download",
      })
      .returning();
    startDirectImport(id, info);
    return json({ video: toVideoView(video), info });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Direct link import failed.", hint: LINK_HINT }, 422);
  }
}
