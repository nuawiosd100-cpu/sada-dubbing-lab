"use client";

import type { VideoView } from "@/lib/types";

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

let memoryId: string | null = null;

/** Anonymous id for this browser. No account, no login: it only scopes the history. */
export function getSessionId(): string {
  const make = () => {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  };
  try {
    let id = localStorage.getItem("sada.session");
    if (!id) {
      id = make();
      localStorage.setItem("sada.session", id);
    }
    return id;
  } catch {
    return (memoryId ??= make());
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "x-session-id": getSessionId() };
  if (typeof init.body === "string") headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) }, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(String(data.error ?? `Request failed (${res.status})`), res.status, data);
  return data as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Upload a file in sequential chunks. `onProgress` reports bytes the server has
 * confirmed as stored, so the percentage shown is real. Failed chunks are retried
 * and resume from the server's offset.
 */
export async function uploadVideo(
  file: File,
  onProgress: (loaded: number, total: number, videoId: string) => void,
  signal: AbortSignal,
): Promise<VideoView> {
  const start = await api<{ video: VideoView; chunkSize: number }>("/api/uploads", {
    method: "POST",
    body: JSON.stringify({ name: file.name, size: file.size }),
    signal,
  });
  const id = start.video.id;
  onProgress(0, file.size, id);
  let offset = 0;
  let failures = 0;
  while (offset < file.size) {
    try {
      const res = await fetch(`/api/uploads/${id}?offset=${offset}`, {
        method: "PUT",
        body: file.slice(offset, offset + start.chunkSize),
        headers: { "Content-Type": "application/octet-stream", "x-session-id": getSessionId() },
        signal,
      });
      const data = (await res.json().catch(() => ({}))) as { received?: number; error?: string };
      if (res.status === 409 && typeof data.received === "number") {
        offset = data.received;
        continue;
      }
      if (!res.ok || typeof data.received !== "number") {
        const err = new ApiError(data.error ?? `Upload failed (${res.status})`, res.status, {});
        if (res.status === 404 || res.status === 413) {
          failures = 99;
        }
        throw err;
      }
      offset = data.received;
      failures = 0;
      onProgress(offset, file.size, id);
    } catch (e) {
      if (signal.aborted) throw e;
      failures++;
      if (failures > 5) throw e;
      await sleep(800 * failures);
    }
  }
  const done = await api<{ video: VideoView }>(`/api/uploads/${id}`, { method: "POST", signal });
  return done.video;
}
