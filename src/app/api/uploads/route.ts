import crypto from "node:crypto";
import fsp from "node:fs/promises";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { CHUNK_SIZE, MAX_UPLOAD_BYTES, VIDEO_EXTENSIONS, getSession, json, reclaimDiskSpace, toVideoView } from "@/lib/server/http";
import { DATA_DIR, sourcePath, videoDir } from "@/lib/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Start a chunked upload. The file is then sent in 4 MB pieces (see ./[id]/route.ts),
// which keeps memory flat and works for multi-gigabyte movies.
export async function POST(req: Request) {
  const session = getSession(req);
  if (!session) return json({ error: "Missing session." }, 400);
  const body = (await req.json().catch(() => null)) as { name?: unknown; size?: unknown } | null;
  const name = String(body?.name ?? "").replace(/[\\/\u0000-\u001f]/g, "_").slice(-180).trim();
  const size = Number(body?.size);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!name || !VIDEO_EXTENSIONS.includes(ext)) {
    return json({ error: `Unsupported file type. Supported video formats: ${VIDEO_EXTENSIONS.join(", ")}.` }, 400);
  }
  if (!Number.isFinite(size) || size <= 0) return json({ error: "The file is empty." }, 400);
  if (size > MAX_UPLOAD_BYTES) {
    return json({ error: `The file is larger than the server limit of ${(MAX_UPLOAD_BYTES / 1024 ** 3).toFixed(0)} GB.` }, 413);
  }
  // Clear leftovers from old failed runs first — they are not downloadable results.
  await reclaimDiskSpace().catch(() => {});
  // Make sure the disk can hold the source and a rendered copy. Keep the headroom
  // proportional to the file: a fixed reserve would reject every upload on a
  // small-volume server even when the file itself fits comfortably.
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const disk = await fsp.statfs(DATA_DIR).catch(() => null);
  if (disk) {
    const free = Number(disk.bavail) * Number(disk.bsize);
    const needed = size * 1.8 + 64 * 1024 ** 2;
    if (needed > free) {
      return json(
        { error: `Not enough free disk space for a ${(size / 1024 ** 3).toFixed(2)} GB file right now (${(free / 1024 ** 3).toFixed(2)} GB free). Delete older videos from your history, or try a shorter/smaller file.` },
        507,
      );
    }
  }
  const id = crypto.randomUUID();
  await fsp.mkdir(videoDir(id), { recursive: true });
  await fsp.writeFile(sourcePath(id), Buffer.alloc(0));
  const [video] = await db
    .insert(videos)
    .values({
      id,
      sessionId: session,
      source: "upload",
      title: name.replace(/\.[^.]+$/, ""),
      fileName: name,
      sizeBytes: size,
      status: "uploading",
    })
    .returning();
  return json({ video: toVideoView(video), chunkSize: CHUNK_SIZE });
}
