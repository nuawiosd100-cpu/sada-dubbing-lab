import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { deleteJob, getSession, json, toJobView } from "@/lib/server/http";
import { cancelJob, waitForJobToStop } from "@/lib/server/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function load(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!job || job.sessionId !== getSession(req)) return null;
  return job;
}

export async function GET(req: Request, ctx: Ctx) {
  const job = await load(req, ctx);
  if (!job) return json({ error: "Job not found." }, 404);
  return json({ job: toJobView(job) });
}

// Cancel a queued / running job (its finished steps stay cached for a later resume).
export async function PATCH(req: Request, ctx: Ctx) {
  const job = await load(req, ctx);
  if (!job) return json({ error: "Job not found." }, 404);
  await cancelJob(job.id);
  await waitForJobToStop(job.id);
  const [fresh] = await db.select().from(jobs).where(eq(jobs.id, job.id));
  return json({ job: toJobView(fresh) });
}

// Remove a run and its rendered file from the history.
export async function DELETE(req: Request, ctx: Ctx) {
  const job = await load(req, ctx);
  if (!job) return json({ error: "Job not found." }, 404);
  await deleteJob(job.id);
  return json({ deleted: true });
}
