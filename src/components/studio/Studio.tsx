"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { dialectById, voiceById, voiceNumber } from "@/lib/voices";
import { DEFAULT_SETTINGS, type JobSettings, type JobView, type ServerStatus, type VideoView } from "@/lib/types";
import { ApiError, api, uploadVideo } from "./api";
import { HistoryPanel, JobPanel } from "./JobPanel";
import { KeyPanel } from "./KeyPanel";
import { VoiceStudioPanel } from "./VoicePanel";
import { MixPanel, SourcePanel, type UploadState } from "./panels";
import { Icon, Spinner, btn } from "./ui";

type SessionData = { videos: VideoView[]; jobs: JobView[] };

function StatusPill({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-850/80 px-3 py-1.5 text-xs text-ink-300" title={detail}>
      <span className={`h-2 w-2 rounded-full ${ok == null ? "bg-ink-500" : ok ? "bg-mint-400 shadow-[0_0_8px_rgb(63_217_196/0.8)]" : "bg-coral-400 shadow-[0_0_8px_rgb(255_111_102/0.8)]"}`} />
      {label}
    </span>
  );
}

export default function Studio() {
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [videos, setVideos] = useState<VideoView[]>([]);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [settings, setSettings] = useState<JobSettings>(DEFAULT_SETTINGS);
  const [castOverrides, setCastOverrides] = useState<Record<string, string>>({});
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);

  const refresh = useCallback(async (): Promise<SessionData | null> => {
    try {
      const d = await api<SessionData>("/api/videos");
      setVideos(d.videos);
      setJobs(d.jobs);
      return d;
    } catch {
      return null;
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api<ServerStatus>("/api/status"));
    } catch {
      /* keep the previous status */
    }
  }, []);

  // First load: restore settings, backend status and this session's work.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sada.settings");
      if (saved) {
        const restored = { ...DEFAULT_SETTINGS, ...(JSON.parse(saved) as Partial<JobSettings>), speakerVoices: {} };
        // A voice saved before the list changed is replaced by the default.
        if (!voiceById(restored.voice)) restored.voice = DEFAULT_SETTINGS.voice;
        const savedList = Array.isArray(restored.voiceList)
          ? restored.voiceList.map((id) => voiceById(id)?.id).filter((id): id is string => !!id)
          : [];
        restored.voiceList = Array.from(new Set([restored.voice, ...savedList]));
        // Multiple saved voices mean the user is building a cast, not requesting one
        // voice for every speaker (older saved sessions may predate smart casting).
        if (restored.voiceList.length > 1 && restored.castMode === "single") restored.castMode = "cast";
        setSettings(restored);
      }
    } catch {
      /* ignore */
    }
    void refreshStatus();
    void refresh().then((d) => {
      if (d) {
        const running = d.jobs.find((j) => j.status === "queued" || j.status === "running");
        const v = d.videos.find((x) => (running ? x.id === running.videoId : x.status === "ready" || x.status === "importing"));
        if (v) {
          setActiveVideoId(v.id);
          const j = running ?? d.jobs.find((x) => x.videoId === v.id);
          if (j) setActiveJobId(j.id);
        }
      }
      setLoaded(true);
    });
  }, [refresh, refreshStatus]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem("sada.settings", JSON.stringify({ ...settings, speakerVoices: {} }));
    } catch {
      /* ignore */
    }
  }, [settings, loaded]);

  // Poll the backend only while something is actually in flight.
  const busy = videos.some((v) => v.status === "importing") || jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void refresh(), 1500);
    return () => clearInterval(t);
  }, [busy, refresh]);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) void refreshStatus();
    wasBusy.current = busy;
  }, [busy, refreshStatus]);

  const activeVideo = videos.find((v) => v.id === activeVideoId) ?? null;
  const activeJob = jobs.find((j) => j.id === activeJobId) ?? null;
  const jobRunning = jobs.some((j) => j.videoId === activeVideoId && (j.status === "queued" || j.status === "running"));
  const hasRuns = jobs.some((j) => j.videoId === activeVideoId);

  const patch = useCallback((p: Partial<JobSettings>) => setSettings((s) => ({ ...s, ...p })), []);
  const fail = (e: unknown) => setNotice(e instanceof Error ? e.message : "Something went wrong.");
  const selectVideo = (id: string | null, jobId: string | null = null) => {
    setActiveVideoId(id);
    setActiveJobId(jobId);
    setCastOverrides({});
  };

  const handleFile = async (file: File) => {
    setNotice(null);
    const abort = new AbortController();
    uploadAbort.current = abort;
    const base: UploadState = { name: file.name, loaded: 0, total: file.size, startedAt: Date.now(), videoId: null, phase: "uploading" };
    setUpload(base);
    try {
      const video = await uploadVideo(
        file,
        (loadedBytes, total, videoId) =>
          setUpload((u) => (u ? { ...u, loaded: loadedBytes, total, videoId, phase: loadedBytes >= total ? "verifying" : "uploading" } : u)),
        abort.signal,
      );
      await refresh();
      setUpload(null);
      selectVideo(video.id);
    } catch (e) {
      if (abort.signal.aborted) return;
      const failedVideo = e instanceof ApiError ? (e.data.video as VideoView | undefined) : undefined;
      if (failedVideo) void api(`/api/videos/${failedVideo.id}`, { method: "DELETE" }).catch(() => {});
      setUpload((u) => ({ ...(u ?? base), phase: "error", error: e instanceof Error ? e.message : "The upload failed." }));
    }
  };

  const cancelUpload = () => {
    uploadAbort.current?.abort();
    const id = upload?.videoId;
    if (id && upload?.phase !== "error") void api(`/api/videos/${id}`, { method: "DELETE" }).catch(() => {});
    setUpload(null);
  };

  const startJob = async (override?: Partial<JobSettings>, videoId = activeVideoId) => {
    if (!videoId) return;
    setNotice(null);
    setStarting(true);
    try {
      const d = await api<{ job: JobView }>("/api/jobs", {
        method: "POST",
        body: JSON.stringify({ videoId, settings: { ...settings, speakerVoices: castOverrides, ...override } }),
      });
      setActiveJobId(d.job.id);
      await refresh();
      if (window.matchMedia("(max-width: 1023px)").matches) document.getElementById("output")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      fail(e);
    } finally {
      setStarting(false);
    }
  };

  const deleteVideo = async (id: string, ask = true) => {
    if (ask && !window.confirm("Delete this video, its dubbed results and all cached audio from the server?")) return;
    try {
      await api(`/api/videos/${id}`, { method: "DELETE" });
    } catch (e) {
      fail(e);
    }
    if (id === activeVideoId) selectVideo(null);
    await refresh();
  };

  const deleteJob = async (id: string) => {
    try {
      await api(`/api/jobs/${id}`, { method: "DELETE" });
    } catch (e) {
      fail(e);
    }
    if (id === activeJobId) setActiveJobId(null);
    await refresh();
  };

  const cancelJob = async (id: string) => {
    try {
      await api(`/api/jobs/${id}`, { method: "PATCH" });
    } catch (e) {
      fail(e);
    }
    await refresh();
  };

  const clearAll = async () => {
    if (!window.confirm("Clear the whole session? Every uploaded video and dubbed result will be deleted from the server.")) return;
    try {
      await api("/api/videos", { method: "DELETE" });
    } catch (e) {
      fail(e);
    }
    selectVideo(null);
    await refresh();
  };

  const voice = voiceById(settings.voice);
  const aiReady = !!status?.ai.ok;
  const canStart = !!activeVideo && activeVideo.status === "ready" && aiReady && !jobRunning && !starting;
  const whyNot = !activeVideo
    ? "Add a source video first."
    : activeVideo.status !== "ready"
      ? "The video is still being prepared."
      : !status
        ? "Checking the AI engine…"
        : !aiReady
          ? "Activate a working API key first — see the Google AI key panel."
          : jobRunning
            ? "This video is being processed right now."
            : null;
  const exhausted = status?.ai.exhausted ?? [];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl border border-gold-400/30 bg-gradient-to-br from-gold-400/20 to-gold-600/5 text-gold-400 shadow-[0_8px_30px_-8px_rgb(255_191_71/0.45)]">
            <Icon name="film" className="h-6 w-6" />
          </span>
          <div>
            <p className="flex items-baseline gap-2 text-lg font-bold tracking-tight text-ink-100">
              Sada <span className="font-arabic text-base font-medium text-gold-400">صدى</span>
            </p>
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-500">Cinema dubbing workstation</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            ok={status ? status.ai.ok : null}
            label={
              !status
                ? "Checking AI engine"
                : status.ai.source === "none"
                  ? "No API key active"
                  : !status.ai.ok
                    ? "Active API key not working"
                    : status.ai.source === "personal"
                      ? `Running on your key ${status.ai.keyHint}`
                      : "Running on built-in server key"
            }
            detail={status?.ai.ok ? `Script: ${status.ai.textModels.join(", ")}\nSpeech: ${status.ai.ttsModels.join(", ")}` : (status?.ai.error ?? undefined)}
          />
          <StatusPill ok={status ? status.ffmpeg.ok : null} label={status?.ffmpeg.ok ? `FFmpeg ${status.ffmpeg.version}` : "Video engine"} detail={status?.ffmpeg.error ?? undefined} />
          <button type="button" className={btn.small} onClick={() => void refreshStatus()} aria-label="Re-check backend status" title="Re-check backend status">
            <Icon name="refresh" className="h-3.5 w-3.5" />
          </button>
        </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 pb-20 pt-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <p className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.24em] text-gold-400"><span className="h-px w-8 bg-gold-400" /> AI Arabic cinema dubbing</p>
            <h1 className="text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.04em] text-ink-100 sm:text-5xl">
              Your film.<br /><span className="bg-gradient-to-r from-gold-300 via-gold-400 to-[#e98c39] bg-clip-text text-transparent">Re-voiced in {settings.targetLanguage === "en" ? "English" : "Arabic"}.</span>
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-400">
              A picture-locked {settings.targetLanguage === "en" ? "English" : "Arabic"} soundtrack, a cast you direct, and the original picture preserved. Built for scenes, episodes and full-length films.
            </p>
          </div>
          <div className="flex gap-5 border-l border-white/10 pl-5 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-500">
            <div><span className="mb-1 block text-gold-400">01</span>Audio only</div>
            <div><span className="mb-1 block text-gold-400">02</span>Original picture</div>
            <div><span className="mb-1 block text-gold-400">03</span>Timed dialogue</div>
          </div>
        </div>

        <div className="mb-6 space-y-3">
          {status && !status.ai.ok && (
            <div className="rise flex items-start gap-3 rounded-2xl border border-coral-400/40 bg-coral-400/10 p-4 text-sm text-coral-300">
              <Icon name="alert" className="mt-0.5 h-4 w-4" />
              <div>
                <p className="font-semibold">
                  {status.ai.source === "none" ? "The service is not activated yet" : status.ai.source === "personal" ? "Your personal API key can't be used right now" : "The built-in server key can't be used right now"}
                </p>
                <p className="mt-1 text-xs leading-relaxed">{status.ai.error}</p>
              </div>
            </div>
          )}
          {exhausted.length > 0 && (
            <div className="rise flex items-start gap-3 rounded-2xl border border-gold-400/35 bg-gold-400/[0.08] p-4 text-sm text-gold-300">
              <Icon name="clock" className="mt-0.5 h-4 w-4" />
              <div>
                <p className="font-semibold">
                  Google reports the daily quota is used up for some AI models on {status?.ai.source === "personal" ? `your personal key ${status.ai.keyHint}` : "the built-in server key"}
                </p>
                <p className="mt-1 text-xs leading-relaxed">
                  {exhausted.map((x) => x.model).join(", ")} — available again around{" "}
                  {new Date(Math.min(...exhausted.map((x) => x.until))).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Other models are used automatically where possible; stopped runs can be resumed without losing finished work. {status?.ai.source === "personal" ? "Enabling billing for your key's project in Google AI Studio removes the free-tier limit." : "To continue now, activate your own key in the Google AI key panel below."}
                </p>
              </div>
            </div>
          )}
          {notice && (
            <div className="rise flex items-start justify-between gap-3 rounded-2xl border border-coral-400/40 bg-coral-400/10 p-4 text-sm text-coral-300">
              <p className="flex items-start gap-3"><Icon name="alert" className="mt-0.5 h-4 w-4" />{notice}</p>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"><Icon name="x" /></button>
            </div>
          )}
        </div>

        <div className="mb-8">
          <JobPanel
            featured
            job={activeJob}
            video={activeJob ? (videos.find((v) => v.id === activeJob.videoId) ?? activeVideo) : activeVideo}
            castOverrides={castOverrides}
            onCastChange={(speaker, v) => setCastOverrides((c) => ({ ...c, [speaker]: v }))}
            onCancel={(id) => void cancelJob(id)}
            onResume={(job) => void startJob({ ...job.settings }, job.videoId)}
            onRegenerateCast={(job) =>
              void startJob({ ...job.settings, castMode: "cast", speakerVoices: { ...Object.fromEntries((job.result?.cast ?? []).map((c) => [c.speaker, c.voice])), ...castOverrides } }, job.videoId)
            }
            onDelete={(id) => void deleteJob(id)}
            busy={starting || jobRunning}
          />
        </div>

        <div id="workflow" className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-6">
            <KeyPanel status={status} onChanged={refreshStatus} />
            <SourcePanel
              video={activeVideo}
              upload={upload}
              onFile={(f) => void handleFile(f)}
              onCancelUpload={cancelUpload}
              onImported={(v) => {
                void refresh();
                selectVideo(v.id);
              }}
              onClear={() => selectVideo(null)}
              onDelete={(id, ask) => void deleteVideo(id, ask)}
            />
            <VoiceStudioPanel settings={settings} onChange={patch} />
            <MixPanel settings={settings} onChange={patch} />

            <div className="rise rounded-2xl border border-gold-400/25 bg-gradient-to-br from-gold-400/[0.09] to-transparent p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-xs leading-relaxed text-ink-300">
                  <p className="text-sm font-semibold text-ink-100">{hasRuns ? "Dub this video again" : "Ready when you are"}</p>
                  <p className="mt-1">
                    #{voiceNumber(settings.voice)} {voice?.id ?? settings.voice} ({voice?.gender}) · {settings.castMode === "cast" ? `${settings.voiceList?.length || 1} saved cast voices` : "one voice for the whole video"} · {settings.targetLanguage === "en" ? "English" : dialectById(settings.dialect).label.split(" (")[0]} · {settings.audioMode === "stems" ? `AI stems · dialogue ${settings.dialogueEnabled ? "on" : "off"} · FX ${settings.effectsEnabled ? settings.effectsVolume : 0}% · music ${settings.musicEnabled ? settings.musicVolume : 0}%` : `Arabic ${settings.dubVolume}% / original ${settings.originalVolume === 0 ? "muted" : `${settings.originalVolume}%`}`}
                  </p>
                  {whyNot && <p className="mt-1 text-ink-500">{whyNot}</p>}
                </div>
                <button type="button" className={`${btn.primary} shrink-0 px-6 py-3 text-base`} disabled={!canStart} onClick={() => void startJob({ speakerVoices: {} })}>
                  {starting ? <Spinner /> : <Icon name="spark" className="h-5 w-5" />}
                  {hasRuns ? "Regenerate with current settings" : `Generate ${settings.targetLanguage === "en" ? "English" : "Arabic"} dub`}
                </button>
              </div>
            </div>
          </div>

          <div className="scroll-slim min-w-0 space-y-6 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
            <HistoryPanel
              jobs={jobs}
              videos={videos}
              activeJobId={activeJobId}
              activeVideoId={activeVideoId}
              onOpen={(job) => selectVideo(job.videoId, job.id)}
              onUseVideo={(v) => selectVideo(v.id, jobs.find((j) => j.videoId === v.id)?.id ?? null)}
              onDeleteJob={(id) => void deleteJob(id)}
              onDeleteVideo={(id) => void deleteVideo(id)}
              onClearAll={() => void clearAll()}
            />
          </div>
        </div>

        <footer className="mt-12 border-t border-ink-700/60 pt-6 text-[11px] leading-relaxed text-ink-500">
          No account or login. Videos are stored on this server for your session only, can be deleted at any time, and are removed automatically after 72 hours. Speech understanding, translation and Arabic voices run on Google Gemini through a server-side key that is never sent to your browser. Only process videos you own or have permission to use.
        </footer>
      </main>
    </div>
  );
}
