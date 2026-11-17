"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DIALECTS, VOICES } from "@/lib/voices";
import { YOUTUBE_QUALITIES, type DirectLinkInfo, type JobSettings, type VideoView, type YouTubeInfo, type YouTubeQuality } from "@/lib/types";
import { ApiError, api, getSessionId } from "./api";
import { StemMixer } from "./StemMixer";
import { Bar, Chip, Icon, Panel, Slider, Spinner, Toggle, btn, fmtBytes, fmtDuration } from "./ui";

export type UploadState = {
  name: string;
  loaded: number;
  total: number;
  startedAt: number;
  videoId: string | null;
  phase: "uploading" | "verifying" | "error";
  error?: string;
};

const ACCEPT = ".mp4,.m4v,.mov,.webm,.mkv,.avi,.mpg,.mpeg,.ts,.flv,.wmv,.3gp,.ogv,video/*";

// ------------------------------------------------------------------ source --

export function SourcePanel({
  video,
  upload,
  onFile,
  onCancelUpload,
  onImported,
  onClear,
  onDelete,
}: {
  video: VideoView | null;
  upload: UploadState | null;
  onFile: (f: File) => void;
  onCancelUpload: () => void;
  onImported: (v: VideoView) => void;
  onClear: () => void;
  onDelete: (id: string, ask?: boolean) => void;
}) {
  const [tab, setTab] = useState<"upload" | "youtube" | "link">("upload");
  const [drag, setDrag] = useState(false);
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<YouTubeInfo | null>(null);
  const [quality, setQuality] = useState<YouTubeQuality>(() => {
    try {
      const saved = localStorage.getItem("sada.youtubeQuality");
      return YOUTUBE_QUALITIES.some((q) => q.id === saved) ? (saved as YouTubeQuality) : "best";
    } catch {
      return "best";
    }
  });
  const [rights, setRights] = useState(false);
  const [ytBusy, setYtBusy] = useState<"analyze" | "import" | null>(null);
  const [ytError, setYtError] = useState<{ error: string; hint?: string } | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkInfo, setLinkInfo] = useState<DirectLinkInfo | null>(null);
  const [linkRights, setLinkRights] = useState(false);
  const [linkBusy, setLinkBusy] = useState<"analyze" | "import" | null>(null);
  const [linkError, setLinkError] = useState<{ error: string; hint?: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem("sada.youtubeQuality", quality);
    } catch {
      /* ignore */
    }
  }, [quality]);

  const toErr = (e: unknown) => ({
    error: e instanceof Error ? e.message : "Something went wrong.",
    hint: e instanceof ApiError && typeof e.data.hint === "string" ? e.data.hint : undefined,
  });

  const callYouTube = async (action: "analyze" | "import") => {
    setYtBusy(action);
    setYtError(null);
    if (action === "analyze") setInfo(null);
    try {
      const d = await api<{ info: YouTubeInfo; video?: VideoView }>("/api/youtube", {
        method: "POST",
        body: JSON.stringify({ action, url, confirmRights: rights, quality }),
      });
      if (action === "analyze") setInfo(d.info);
      else if (d.video) {
        onImported(d.video);
        setInfo(null);
        setUrl("");
        setRights(false);
      }
    } catch (e) {
      setYtError(toErr(e));
    } finally {
      setYtBusy(null);
    }
  };

  const callLink = async (action: "analyze" | "import") => {
    setLinkBusy(action);
    setLinkError(null);
    if (action === "analyze") setLinkInfo(null);
    try {
      const d = await api<{ info: DirectLinkInfo; video?: VideoView }>("/api/link", {
        method: "POST",
        body: JSON.stringify({ action, url: linkUrl, confirmRights: linkRights }),
      });
      if (action === "analyze") setLinkInfo(d.info);
      else if (d.video) {
        onImported(d.video);
        setLinkInfo(null);
        setLinkUrl("");
        setLinkRights(false);
      }
    } catch (e) {
      setLinkError(toErr(e));
    } finally {
      setLinkBusy(null);
    }
  };

  let body: ReactNode;

  if (video) {
    const pct = Math.round(video.progress * 100);
    body = (
      <div className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="relative grid aspect-video w-full shrink-0 place-items-center overflow-hidden rounded-xl bg-black ring-1 ring-ink-700 sm:w-56">
            <Icon name="film" className="h-8 w-8 text-ink-600" />
            {video.status === "ready" && (
              <video
                key={video.id}
                src={`/api/videos/${video.id}/file#t=0.5`}
                className="absolute inset-0 h-full w-full object-contain"
                controls
                muted
                playsInline
                preload="metadata"
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink-100" title={video.title}>
              {video.title}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip tone={video.source === "upload" ? "neutral" : "coral"}>
                {video.source === "youtube" ? "YouTube import" : video.source === "link" ? "Direct link" : "Computer upload"}
              </Chip>
              {video.durationSec != null && <Chip>{fmtDuration(video.durationSec)}</Chip>}
              {video.width && video.height && <Chip>{video.width}×{video.height}</Chip>}
              {video.sizeBytes > 0 && <Chip>{fmtBytes(video.sizeBytes)}</Chip>}
              {video.videoCodec && <Chip>{video.videoCodec.toUpperCase()}{video.audioCodec ? ` + ${video.audioCodec.toUpperCase()}` : ""}</Chip>}
              {video.language && <Chip tone="mint"><Icon name="globe" className="h-3 w-3" />{video.language}</Chip>}
            </div>

            {video.status === "importing" && (
              <div className="mt-4 space-y-2">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-ink-300">{video.statusDetail ?? "Importing the source video"}</span>
                  <span className="font-mono text-gold-300">{pct}%</span>
                </div>
                <Bar value={video.progress} />
              </div>
            )}
            {video.status === "ready" && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-mint-300">
                <Icon name="check" className="h-3.5 w-3.5" /> Stored on the server and ready to dub. You can re-dub it as often as you like without uploading again.
              </p>
            )}
            {video.status === "failed" && (
              <div className="mt-3 rounded-xl border border-coral-400/30 bg-coral-400/10 p-3 text-xs leading-relaxed text-coral-300">
                <p className="flex items-start gap-2"><Icon name="alert" className="mt-0.5 h-3.5 w-3.5" /><span>{video.error ?? "This video could not be prepared."}</span></p>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {video.status === "failed" ? (
            <button
              type="button"
              className={btn.primary}
              onClick={() => {
                onDelete(video.id, false);
                setTab("upload");
              }}
            >
              <Icon name="upload" /> Upload from computer instead
            </button>
          ) : (
            <button type="button" className={btn.ghost} onClick={onClear} disabled={video.status === "importing"}>
              <Icon name="x" /> Clear &amp; choose another video
            </button>
          )}
          <button type="button" className={btn.danger} onClick={() => onDelete(video.id, video.status === "ready")}>
            <Icon name="trash" /> {video.status === "importing" ? "Cancel import" : "Delete from server"}
          </button>
        </div>
      </div>
    );
  } else if (upload) {
    const pct = upload.total ? (upload.loaded / upload.total) * 100 : 0;
    const elapsed = Math.max(0.5, (Date.now() - upload.startedAt) / 1000);
    const speed = upload.loaded / elapsed;
    const eta = speed > 0 ? (upload.total - upload.loaded) / speed : 0;
    body = (
      <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink-100">{upload.name}</p>
            <p className="mt-1 text-xs text-ink-400">
              {upload.phase === "error"
                ? "Upload stopped"
                : upload.phase === "verifying"
                  ? "Upload complete — the server is inspecting the file with FFmpeg…"
                  : `${fmtBytes(upload.loaded)} of ${fmtBytes(upload.total)} stored on the server · ${fmtBytes(speed)}/s · about ${fmtDuration(eta)} left`}
            </p>
          </div>
          <span className="font-mono text-2xl font-medium tabular-nums text-gold-300">{pct.toFixed(pct < 100 && upload.total > 2e8 ? 1 : 0)}%</span>
        </div>
        <div className="mt-4">
          <Bar value={upload.phase === "verifying" ? null : pct / 100} />
        </div>
        {upload.phase === "error" && (
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-coral-300">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5" /> {upload.error}
          </p>
        )}
        <div className="mt-4">
          <button type="button" className={btn.ghost} onClick={onCancelUpload}>
            <Icon name="x" /> {upload.phase === "error" ? "Dismiss" : "Cancel upload"}
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <div>
        <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-ink-900 p-1 ring-1 ring-ink-700" role="tablist">
          {(["upload", "youtube", "link"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-medium transition sm:text-sm ${
                tab === t ? "bg-ink-700 text-ink-100 shadow" : "text-ink-400 hover:text-ink-200"
              }`}
            >
              <Icon name={t === "upload" ? "upload" : t === "youtube" ? "film" : "download"} />
              {t === "upload" ? "Upload file" : t === "youtube" ? "YouTube URL" : "Direct link"}
            </button>
          ))}
        </div>

        {tab === "upload" ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files?.[0];
              if (f) onFile(f);
            }}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") input.current?.click();
            }}
            role="button"
            tabIndex={0}
            className={`grid place-items-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
              drag ? "border-gold-400 bg-gold-400/10" : "border-ink-600 bg-ink-900/50 hover:border-ink-500 hover:bg-ink-800/60"
            }`}
          >
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gold-400/10 text-gold-400 ring-1 ring-gold-400/25">
              <Icon name="upload" className="h-6 w-6" />
            </span>
            <p className="mt-4 text-sm font-semibold text-ink-100">Drag &amp; drop a video here</p>
            <p className="mt-1 text-xs text-ink-400">or click to browse your computer</p>
            <p className="mt-4 text-[11px] text-ink-500">MP4, MOV, MKV, WebM, AVI and more · long movies and episodes supported · sent in resumable 4 MB pieces</p>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = "";
              }}
            />
          </div>
        ) : tab === "youtube" ? (
          <div className="space-y-4">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (url.trim()) void callYouTube("analyze");
              }}
            >
              <div className="relative flex-1">
                <Icon name="link" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
                <input
                  type="url"
                  inputMode="url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setInfo(null);
                    setYtError(null);
                  }}
                  placeholder="https://www.youtube.com/watch?v=…"
                  className="w-full rounded-xl border border-ink-600 bg-ink-900 py-2.5 pl-10 pr-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-gold-400 focus:outline-none"
                />
              </div>
              <button type="submit" className={btn.ghost} disabled={!url.trim() || ytBusy !== null}>
                {ytBusy === "analyze" ? <Spinner /> : <Icon name="spark" />} Analyze video
              </button>
            </form>

            <label className="flex flex-col gap-2 rounded-xl border border-ink-700 bg-ink-800/60 p-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-center gap-2 text-xs font-medium text-ink-200"><Icon name="sliders" className="h-3.5 w-3.5 text-gold-400" /> Download quality</span>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as YouTubeQuality)}
                aria-label="YouTube download quality"
                className="rounded-xl border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-ink-100 focus:border-gold-400 focus:outline-none"
              >
                {YOUTUBE_QUALITIES.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
              </select>
            </label>

            {ytBusy === "analyze" && <p className="text-xs text-ink-400">Asking YouTube for the video details (the first request also installs the import component, which can take a little longer)…</p>}

            {info && (
              <div className="rise rounded-xl border border-ink-700 bg-ink-800/60 p-4">
                <div className="flex gap-4">
                  {info.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={info.thumbnail} alt="" className="h-20 w-36 shrink-0 rounded-lg object-cover ring-1 ring-ink-700" referrerPolicy="no-referrer" />
                  )}
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm font-semibold text-ink-100">{info.title}</p>
                    <p className="mt-1 text-xs text-ink-400">
                      {info.uploader ?? "Unknown channel"} · {fmtDuration(info.durationSec)}
                    </p>
                  </div>
                </div>
                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg bg-ink-900/70 p-3 text-xs leading-relaxed text-ink-300">
                  <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#ffbf47]" />
                  <span>I own this video or have permission from the rights holder to download and process it.</span>
                </label>
                <button type="button" className={`${btn.primary} mt-3 w-full`} disabled={!rights || ytBusy !== null} onClick={() => void callYouTube("import")}>
                  {ytBusy === "import" ? <Spinner /> : <Icon name="download" />} Import video &amp; audio
                </button>
              </div>
            )}

            {ytError && (
              <div className="rise rounded-xl border border-coral-400/30 bg-coral-400/10 p-4 text-xs leading-relaxed">
                <p className="flex items-start gap-2 font-medium text-coral-300">
                  <Icon name="alert" className="mt-0.5 h-3.5 w-3.5" /> {ytError.error}
                </p>
                {ytError.hint && <p className="mt-2 text-ink-300">{ytError.hint}</p>}
                <button type="button" className={`${btn.small} mt-3`} onClick={() => setTab("upload")}>
                  <Icon name="upload" className="h-3.5 w-3.5" /> Switch to computer upload
                </button>
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-ink-500">
              Only publicly available videos are imported, using no account, cookies or restriction bypass. Private, age-restricted, members-only and DRM-protected videos are refused.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (linkUrl.trim()) void callLink("analyze");
              }}
            >
              <div className="relative flex-1">
                <Icon name="download" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
                <input
                  type="url"
                  inputMode="url"
                  value={linkUrl}
                  onChange={(e) => {
                    setLinkUrl(e.target.value);
                    setLinkInfo(null);
                    setLinkError(null);
                  }}
                  placeholder="https://example.com/my-video.mp4"
                  className="w-full rounded-xl border border-ink-600 bg-ink-900 py-2.5 pl-10 pr-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-gold-400 focus:outline-none"
                />
              </div>
              <button type="submit" className={btn.ghost} disabled={!linkUrl.trim() || linkBusy !== null}>
                {linkBusy === "analyze" ? <Spinner /> : <Icon name="spark" />} Check link
              </button>
            </form>

            {linkBusy === "analyze" && <p className="text-xs text-ink-400">Checking the link headers on the server…</p>}

            {linkInfo && (
              <div className="rise rounded-xl border border-ink-700 bg-ink-800/60 p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-mint-400/15 text-mint-300"><Icon name="download" /></span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-100" title={linkInfo.name}>{linkInfo.name}</p>
                    <p className="mt-1 break-all text-xs text-ink-400">{linkInfo.url}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {linkInfo.size != null && <Chip>{fmtBytes(linkInfo.size)}</Chip>}
                      {linkInfo.contentType && <Chip tone="mint">{linkInfo.contentType}</Chip>}
                    </div>
                  </div>
                </div>
                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg bg-ink-900/70 p-3 text-xs leading-relaxed text-ink-300">
                  <input type="checkbox" checked={linkRights} onChange={(e) => setLinkRights(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#ffbf47]" />
                  <span>I own this video or have permission from the rights holder to download and process it.</span>
                </label>
                <button type="button" className={`${btn.primary} mt-3 w-full`} disabled={!linkRights || linkBusy !== null} onClick={() => void callLink("import")}>
                  {linkBusy === "import" ? <Spinner /> : <Icon name="download" />} Import video &amp; audio
                </button>
              </div>
            )}

            {linkError && (
              <div className="rise rounded-xl border border-coral-400/30 bg-coral-400/10 p-4 text-xs leading-relaxed">
                <p className="flex items-start gap-2 font-medium text-coral-300">
                  <Icon name="alert" className="mt-0.5 h-3.5 w-3.5" /> {linkError.error}
                </p>
                {linkError.hint && <p className="mt-2 text-ink-300">{linkError.hint}</p>}
                <button type="button" className={`${btn.small} mt-3`} onClick={() => setTab("upload")}>
                  <Icon name="upload" className="h-3.5 w-3.5" /> Switch to computer upload
                </button>
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-ink-500">
              A direct link is downloaded by this server and feeds the same dubbing engine as a file upload. Only http(s) links to a real media file are accepted; local and private network addresses are blocked by default.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <Panel step="1" title="Source video" hint="Upload a file, import from YouTube or use a direct download link — all feed the same dubbing engine.">
      {body}
    </Panel>
  );
}

// ------------------------------------------------------------------- voice --

export function VoicePanel({ settings, onChange }: { settings: JobSettings; onChange: (patch: Partial<JobSettings>) => void }) {
  const [filter, setFilter] = useState<"all" | "male" | "female">("all");
  const [preview, setPreview] = useState<{ id: string; state: "loading" | "playing" } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());
  const token = useRef(0);

  useEffect(() => () => audioRef.current?.pause(), []);

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPreview(null);
  };

  const play = async (id: string) => {
    const wasThis = preview?.id === id;
    token.current++;
    stop();
    if (wasThis) return;
    const mine = token.current;
    setPreviewError(null);
    setPreview({ id, state: "loading" });
    try {
      let src = urls.current.get(id);
      if (!src) {
        // The session id lets the server generate a missing sample with this browser's active key.
        const res = await fetch(`/api/voices/${id}/preview`, { headers: { "x-session-id": getSessionId() } });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error ?? "The voice preview could not be generated.");
        }
        src = URL.createObjectURL(await res.blob());
        urls.current.set(id, src);
      }
      if (mine !== token.current) return;
      const a = new Audio(src);
      audioRef.current = a;
      a.onended = () => {
        if (mine === token.current) setPreview(null);
      };
      await a.play();
      if (mine === token.current) setPreview({ id, state: "playing" });
    } catch (e) {
      if (mine === token.current) {
        setPreview(null);
        setPreviewError(e instanceof Error ? e.message : "The voice preview could not be played.");
      }
    }
  };

  const shown = VOICES.filter((v) => filter === "all" || v.gender === filter);

  return (
    <Panel
      step="2"
      title="Arabic voice"
      hint="Preview any voice speaking Arabic, then pick the lead voice."
      action={
        <div className="flex gap-1 rounded-lg bg-ink-900 p-1 ring-1 ring-ink-700">
          {(["all", "male", "female"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition ${filter === f ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-200"}`}
            >
              {f}
            </button>
          ))}
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Arabic voice">
        {shown.map((v) => {
          const selected = settings.voice === v.id;
          const p = preview?.id === v.id ? preview.state : null;
          return (
            <div
              key={v.id}
              className={`flex items-stretch gap-1 rounded-xl border p-1.5 transition ${
                selected ? "border-gold-400/70 bg-gold-400/[0.07] shadow-[0_0_0_1px_rgb(255_191_71/0.25)]" : "border-ink-700 bg-ink-800/60 hover:border-ink-600"
              }`}
            >
              <button type="button" role="radio" aria-checked={selected} onClick={() => onChange({ voice: v.id })} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left">
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                    v.gender === "female" ? "bg-coral-400/15 text-coral-300" : "bg-mint-400/15 text-mint-300"
                  }`}
                >
                  {selected ? <Icon name="check" /> : v.id.slice(0, 2)}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-ink-100">{v.id}</span>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-ink-400">{v.gender}</span>
                  </span>
                  <span className="block truncate text-xs text-ink-400">{v.blurb}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => void play(v.id)}
                aria-label={p ? `Stop ${v.id} preview` : `Preview ${v.id} in Arabic`}
                title={p ? "Stop" : "Preview in Arabic"}
                className={`grid w-10 shrink-0 place-items-center rounded-lg transition ${p ? "bg-gold-400 text-ink-950" : "bg-ink-700/70 text-ink-200 hover:bg-ink-600"}`}
              >
                {p === "loading" ? <Spinner /> : <Icon name={p === "playing" ? "stop" : "play"} />}
              </button>
            </div>
          );
        })}
      </div>

      {previewError && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-gold-400/30 bg-gold-400/10 p-3 text-xs leading-relaxed text-gold-300">
          <Icon name="alert" className="mt-0.5 h-3.5 w-3.5" /> {previewError}
        </p>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-400">
            <Icon name="users" className="h-3.5 w-3.5" /> Character voices
          </p>
          <div className="grid gap-2">
            {(
              [
                ["cast", "A different voice per character", "Speakers are detected by voice and gender. The lead voice goes to the main matching speaker; others get their own male or female voices."],
                ["single", "One voice for everything", "Every line is spoken by the selected voice."],
              ] as const
            ).map(([mode, label, desc]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={settings.castMode === mode}
                onClick={() => onChange({ castMode: mode })}
                className={`rounded-xl border p-3 text-left transition ${settings.castMode === mode ? "border-gold-400/60 bg-gold-400/[0.07]" : "border-ink-700 bg-ink-800/60 hover:border-ink-600"}`}
              >
                <span className="block text-sm font-medium text-ink-100">{label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-400">{desc}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-400">
              <Icon name="globe" className="h-3.5 w-3.5" /> Arabic style
            </span>
            <select
              value={settings.dialect}
              onChange={(e) => onChange({ dialect: e.target.value as JobSettings["dialect"] })}
              className="w-full rounded-xl border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-ink-100 focus:border-gold-400 focus:outline-none"
            >
              {DIALECTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-400">
              <Icon name="spark" className="h-3.5 w-3.5" /> Voice generation
            </span>
            <select
              value={settings.ttsMode}
              onChange={(e) => onChange({ ttsMode: e.target.value as JobSettings["ttsMode"] })}
              className="w-full rounded-xl border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-ink-100 focus:border-gold-400 focus:outline-none"
            >
              <option value="economy">Economy — several lines per AI request</option>
              <option value="precise">Precise — one AI request per line</option>
            </select>
            <span className="mt-1.5 block text-[11px] leading-relaxed text-ink-500">
              Economy uses far fewer Gemini requests (important on the free tier). Precise gives the tightest timing but needs a paid-tier key for anything beyond a short clip.
            </span>
          </label>
        </div>
      </div>
    </Panel>
  );
}

// --------------------------------------------------------------------- mix --

export function MixPanel({ settings, onChange }: { settings: JobSettings; onChange: (patch: Partial<JobSettings>) => void }) {
  const muted = settings.originalVolume === 0;
  const targetName = settings.targetLanguage === "en" ? "English" : "Arabic";
  const preferredStemMode = () => onChange({ audioMode: "stems", dubEnabled: true, dialogueEnabled: false, effectsEnabled: true, musicEnabled: true });
  const presets = [
    { label: `${targetName} only`, dub: 100, orig: 0 },
    { label: `${targetName} + soft background`, dub: 100, orig: 15 },
    { label: "Balanced", dub: 100, orig: 35 },
  ];
  return (
    <Panel step="3" title="Audio mix" hint={`${targetName} is the main voice. Decide how much of the original soundtrack stays underneath.`}>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink-900 p-1 ring-1 ring-ink-700" role="tablist" aria-label="Audio mixing mode">
        <button type="button" role="tab" aria-selected={settings.audioMode !== "stems"} onClick={() => onChange({ audioMode: "classic" })} className={`rounded-lg px-3 py-2 text-xs font-medium transition ${settings.audioMode !== "stems" ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-200"}`}>Classic mix</button>
        <button type="button" role="tab" aria-selected={settings.audioMode === "stems"} onClick={preferredStemMode} className={`rounded-lg px-3 py-2 text-xs font-medium transition ${settings.audioMode === "stems" ? "bg-gold-400/15 text-gold-300 ring-1 ring-gold-400/25" : "text-ink-400 hover:text-ink-200"}`}>AI 3-stem cinema mix</button>
      </div>
      {settings.audioMode === "stems" && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
          If the AI separation can’t run on this server, your dub still finishes automatically with the classic mix.
        </p>
      )}
      {settings.audioMode === "stems" ? <StemMixer settings={settings} onChange={onChange} /> : (
      <>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium text-ink-100">
              <Icon name="mic" className="h-4 w-4 text-gold-400" /> {targetName} dubbing volume
            </span>
            <span className="font-mono text-sm tabular-nums text-gold-300">{settings.dubVolume}%</span>
          </div>
          <Slider value={settings.dubVolume} onChange={(v) => onChange({ dubVolume: v })} color="#ffbf47" label="Arabic dubbing volume" />
          <div className="mt-2 flex justify-between font-mono text-[10px] text-ink-500">
            <span>0</span>
            <span>50</span>
            <span>100</span>
          </div>
        </div>
        <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium text-ink-100">
              <Icon name={muted ? "mute" : "volume"} className="h-4 w-4 text-mint-400" /> Original audio volume
            </span>
            <span className="font-mono text-sm tabular-nums text-mint-300">{muted ? "Muted" : `${settings.originalVolume}%`}</span>
          </div>
          <Slider value={settings.originalVolume} onChange={(v) => onChange({ originalVolume: v })} color="#3fd9c4" label="Original audio volume" />
          <div className="mt-2 flex justify-between font-mono text-[10px] text-ink-500">
            <span>0</span>
            <span>50</span>
            <span>100</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-400">Quick mixes:</span>
        {presets.map((p) => {
          const active = settings.dubVolume === p.dub && settings.originalVolume === p.orig;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange({ dubVolume: p.dub, originalVolume: p.orig })}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${active ? "border-gold-400/60 bg-gold-400/10 text-gold-300" : "border-ink-600 text-ink-300 hover:border-ink-500 hover:text-ink-100"}`}
            >
              {p.label}
            </button>
          );
        })}
        <button type="button" onClick={() => onChange({ originalVolume: muted ? 15 : 0 })} className={`${btn.small} ml-auto`}>
          <Icon name={muted ? "volume" : "mute"} className="h-3.5 w-3.5" /> {muted ? "Unmute original" : "Mute original speech"}
        </button>
      </div>

      <div className="mt-4 grid gap-2.5 md:grid-cols-3">
        <Toggle
          checked={settings.clarity}
          onChange={(v) => onChange({ clarity: v })}
          label={`Louder, clearer ${targetName}`}
          description="Adds presence EQ and gentle compression so the Arabic voice cuts through."
        />
        <Toggle
          checked={settings.ducking}
          onChange={(v) => onChange({ ducking: v })}
          disabled={muted}
          label="Auto-duck original"
          description="Lowers the original track only while Arabic is speaking; music returns between lines."
        />
        <Toggle
          checked={settings.reduceDialogue}
          onChange={(v) => onChange({ reduceDialogue: v })}
          disabled={muted}
          label="Reduce original dialogue"
          description="Experimental centre-channel removal for stereo sources; keeps wide music and effects."
        />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
        The original soundtrack carries speech, music and effects together. Auto-duck and dialogue reduction keep as much music as possible, but only a dedicated stem-separation model can fully isolate music from speech — for a completely clean result choose “Arabic only”.
      </p>
      </>
      )}
    </Panel>
  );
}
