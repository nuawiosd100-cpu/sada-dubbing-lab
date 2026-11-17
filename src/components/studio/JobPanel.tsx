"use client";

import { VOICES, dialectById, voiceById, voiceCharacter, voiceNumber } from "@/lib/voices";
import { DEFAULT_SETTINGS, type JobStatus, type JobView, type StageState, type VideoView } from "@/lib/types";
import { Bar, Chip, Icon, Panel, Spinner, btn, fmtBytes, fmtDuration, timeAgo } from "./ui";
import { CinemaPlayer } from "./CinemaPlayer";

const STATUS: Record<JobStatus, { label: string; tone: "neutral" | "gold" | "mint" | "coral" }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Processing", tone: "gold" },
  completed: { label: "Completed", tone: "mint" },
  failed: { label: "Stopped", tone: "coral" },
  canceled: { label: "Canceled", tone: "neutral" },
};

function StageRow({ s }: { s: Pick<StageState, "label" | "status" | "progress" | "detail"> }) {
  const running = s.status === "running";
  const done = s.status === "done" || s.status === "cached";
  const right = running
    ? s.progress == null
      ? "working…"
      : `${Math.round(s.progress * 100)}%`
    : s.status === "done"
      ? "100%"
      : s.status === "cached"
        ? "reused"
        : s.status === "failed"
          ? "stopped"
          : "waiting";
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ring-1 ${
          done
            ? "bg-mint-400/15 text-mint-300 ring-mint-400/30"
            : running
              ? "bg-gold-400/15 text-gold-300 ring-gold-400/40"
              : s.status === "failed"
                ? "bg-coral-400/15 text-coral-300 ring-coral-400/40"
                : "bg-ink-800 text-ink-500 ring-ink-600"
        }`}
      >
        {done ? <Icon name="check" className="h-3.5 w-3.5" /> : running ? <Spinner className="h-3.5 w-3.5" /> : s.status === "failed" ? <Icon name="x" className="h-3.5 w-3.5" /> : <Icon name="dot" className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1 pb-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className={`text-sm font-medium ${done || running ? "text-ink-100" : s.status === "failed" ? "text-coral-300" : "text-ink-400"}`}>{s.label}</span>
          <span className={`font-mono text-xs tabular-nums ${running ? "text-gold-300" : done ? "text-mint-300" : "text-ink-500"}`}>{right}</span>
        </div>
        {running && (
          <div className="mt-1.5">
            <Bar value={s.progress} />
          </div>
        )}
        {s.detail && <p className="mt-1 text-xs leading-relaxed text-ink-400">{s.detail}</p>}
      </div>
    </li>
  );
}

function Stages({ job, video }: { job: JobView; video: VideoView | null }) {
  return (
    <ol className="space-y-3">
      {video && (
        <StageRow
          s={{
            label: video.source === "youtube" ? "YouTube import" : video.source === "link" ? "Direct link" : "Upload",
            status: "done",
            progress: 1,
            detail: `${fmtBytes(video.sizeBytes)} stored on the server`,
          }}
        />
      )}
      {job.stages.map((s) => (
        <StageRow key={s.key} s={s} />
      ))}
    </ol>
  );
}

function Log({ job }: { job: JobView }) {
  if (!job.logs.length) return null;
  return (
    <div className="scroll-slim mt-4 max-h-36 overflow-y-auto rounded-xl border border-ink-700 bg-ink-950/70 p-3 font-mono text-[11px] leading-relaxed">
      {job.logs.slice(-14).reverse().map((l, i) => (
        <p key={`${l.t}-${i}`} className={l.level === "error" ? "text-coral-300" : l.level === "warn" ? "text-gold-300" : "text-ink-300"}>
          <span className="text-ink-500">{new Date(l.t).toLocaleTimeString([], { hour12: false })}</span> {l.msg}
        </p>
      ))}
    </div>
  );
}

export function JobPanel({
  job,
  video,
  castOverrides,
  onCastChange,
  onCancel,
  onResume,
  onRegenerateCast,
  onDelete,
  busy,
  featured = false,
}: {
  job: JobView | null;
  video: VideoView | null;
  castOverrides: Record<string, string>;
  onCastChange: (speaker: string, voice: string) => void;
  onCancel: (id: string) => void;
  onResume: (job: JobView) => void;
  onRegenerateCast: (job: JobView) => void;
  onDelete: (id: string) => void;
  busy: boolean;
  featured?: boolean;
}) {
  if (!job) {
    return (
      <Panel id="output" title={featured ? "Dub stage" : "Output"} hint={featured ? (video ? `${video.title} · source preview` : "Your cinema preview appears here") : "Live progress, then your dubbed video."}>
        {featured && video?.status === "ready" ? (
          <CinemaPlayer src={`/api/videos/${video.id}/file`} title={video.title} label="Source picture · original audio" duration={video.durationSec} />
        ) : (
          <div className={`cinema-empty relative grid place-items-center overflow-hidden rounded-2xl border border-white/10 px-6 text-center ${featured ? "h-72 w-full min-w-0 sm:aspect-video sm:h-auto sm:max-h-[62vh]" : "py-10"}`}>
            <div className="relative z-10">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-gold-400/20 bg-gold-400/[0.07] text-gold-400 shadow-[0_0_50px_rgba(255,191,71,0.08)]">
                <Icon name="film" className="h-8 w-8" />
              </span>
              <p className="mt-5 text-lg font-semibold tracking-tight text-ink-100">Your film. Re-voiced in your language.</p>
              <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-ink-400">
                Add a video, build your cast and press <span className="text-gold-300">Generate dub</span>. The finished film and its real dialogue timeline will play here.
              </p>
            </div>
          </div>
        )}
      </Panel>
    );
  }

  const st = STATUS[job.status];
  const active = job.status === "queued" || job.status === "running";
  const r = job.result;
  const targetLabel = (r?.targetLanguage ?? job.settings.targetLanguage ?? "ar") === "en" ? "English" : dialectById(r?.dialect ?? job.settings.dialect).label;
  const took = job.startedAt && job.finishedAt ? (new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000 : null;
  const castChanged = !!r && r.cast.some((c) => castOverrides[c.speaker] && castOverrides[c.speaker] !== c.voice);
  // Speaker menus use the cast the user saved with + (old runs without a list keep all voices).
  const availableVoices = (() => {
    const saved = job.settings.voiceList?.length ? job.settings.voiceList : VOICES.map((v) => v.id);
    return Array.from(new Set([...saved, ...(r?.cast.map((c) => c.voice) ?? [])]))
      .map((id) => voiceById(id))
      .filter((v): v is (typeof VOICES)[number] => !!v);
  })();

  return (
    <Panel
      id="output"
      title={featured ? "Dub stage" : "Output"}
      hint={video ? video.title : "Dubbing run"}
      action={
        <Chip tone={st.tone}>
          {job.status === "running" && <Spinner className="h-3 w-3" />}
          {st.label}
        </Chip>
      }
    >
      {job.status === "completed" && r ? (
        <div className="space-y-4">
          <CinemaPlayer
            src={`/api/jobs/${job.id}/file`}
            title={video?.title ?? "Arabic dubbed video"}
            label={`${targetLabel} dub · ${r.language} → ${targetLabel}`}
            cues={r.cues ?? []}
            duration={r.durationSec}
          />
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/api/jobs/${job.id}/file?download=1`} download className={btn.primary}>
              <Icon name="download" /> Download MP4
            </a>
            <span className="font-mono text-xs text-ink-400">{fmtBytes(job.outputSize)} · {fmtDuration(r.durationSec)}</span>
            <button type="button" className={`${btn.small} ml-auto`} onClick={() => onDelete(job.id)}>
              <Icon name="trash" className="h-3.5 w-3.5" /> Delete result
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Chip tone="mint"><Icon name="globe" className="h-3 w-3" />{r.language} → {targetLabel}</Chip>
            <Chip>{r.voicedLines} of {r.lines} lines voiced</Chip>
            <Chip>{targetLabel} {job.settings.dubVolume}% · original {job.settings.originalVolume === 0 ? "muted" : `${job.settings.originalVolume}%`}</Chip>
            <Chip>{r.videoCopied ? "Original picture quality kept" : "Picture re-encoded (H.264)"}</Chip>
            {r.separation && <Chip tone="mint"><Icon name="wave" className="h-3 w-3" />{r.separation.model === "tiger" ? "TIGER" : "MRX"} stems · dialogue {job.settings.dialogueEnabled ? "on" : "off"} · FX {job.settings.effectsEnabled ? "on" : "off"} · music {job.settings.musicEnabled ? "on" : "off"}</Chip>}
            {r.keySource && <Chip tone={r.keySource === "personal" ? "mint" : "neutral"}><Icon name="key" className="h-3 w-3" />{r.keySource === "personal" ? "Made with your API key" : "Made with the built-in key"}</Chip>}
            {took != null && <Chip><Icon name="clock" className="h-3 w-3" />{took < 60 ? `${Math.max(1, Math.round(took))}s` : fmtDuration(took)} to process</Chip>}
          </div>
          {r.notes.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-gold-400/25 bg-gold-400/[0.06] p-3 text-xs leading-relaxed text-gold-300">
              {r.notes.map((n) => (
                <li key={n} className="flex gap-2"><Icon name="alert" className="mt-0.5 h-3.5 w-3.5" />{n}</li>
              ))}
            </ul>
          )}

          <div className="rounded-xl border border-ink-700 bg-ink-800/50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink-100">
                <Icon name="users" className="h-4 w-4 text-gold-400" /> Matched cast · voice portraits
              </p>
              <span className="text-[11px] text-ink-500">{job.settings.castMode === "single" ? "single-voice run" : "auto-cast run"}</span>
            </div>
            <ul className="space-y-2">
              {r.cast.map((c) => {
                const ch = voiceCharacter(c.voice);
                const chosen = voiceById(c.voice);
                return (
                  <li key={c.speaker} className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-700/70 bg-ink-900/60 p-2.5">
                    <span
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 text-xl shadow-[0_8px_22px_-12px_rgba(0,0,0,0.9)]"
                      style={{ background: `linear-gradient(145deg, ${ch.tint}38, ${ch.tint}0c)` }}
                      title={`${c.speaker} avatar`}
                    >
                      {c.flag ?? ch.flag}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-ink-100">{c.description || "Speaker"} <span className="font-mono text-[10px] text-ink-500">{c.speaker}</span></p>
                      <p className="truncate text-[11px] font-medium" style={{ color: ch.tint }}>{chosen?.id ?? c.voice} · {c.persona ?? ch.persona}</p>
                      <p className="mt-0.5 text-[10px] capitalize text-ink-400">
                        <span className={c.gender === "female" ? "text-coral-300" : c.gender === "male" ? "text-mint-300" : "text-ink-400"}>{c.gender}</span>
                        {c.age && c.age !== "unknown" ? ` · ${c.age}` : ""}
                        {c.genderSource === "audio" && c.genderConfidence != null ? ` · heard ${Math.round(c.genderConfidence * 100)}%` : ""}
                        {` · ${c.lines} line${c.lines === 1 ? "" : "s"} · ${fmtDuration(c.seconds)}`}
                      </p>
                    </div>
                    <select
                      value={castOverrides[c.speaker] ?? (chosen ? c.voice : DEFAULT_SETTINGS.voice)}
                      onChange={(e) => onCastChange(c.speaker, e.target.value)}
                      aria-label={`Voice for ${c.speaker}`}
                      className="rounded-lg border border-ink-600 bg-ink-900 px-2 py-1.5 text-xs text-ink-100 focus:border-gold-400 focus:outline-none"
                    >
                      <optgroup label="Male">
                        {availableVoices.filter((v) => v.gender === "male").map((v) => (
                          <option key={v.id} value={v.id}>#{String(v.number).padStart(2, "0")} {v.id} — {v.style}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Female">
                        {availableVoices.filter((v) => v.gender === "female").map((v) => (
                          <option key={v.id} value={v.id}>#{String(v.number).padStart(2, "0")} {v.id} — {v.style}</option>
                        ))}
                      </optgroup>
                    </select>
                  </li>
                );
              })}
            </ul>
            <button type="button" className={`${btn.ghost} mt-3 w-full`} disabled={!castChanged || busy} onClick={() => onRegenerateCast(job)}>
              <Icon name="refresh" /> Regenerate with these voices
            </button>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
              Choose from the voices saved in this run&apos;s cast. Only lines whose voice changed are generated again; the upload, transcript and translation are reused.
            </p>
          </div>

          <details className="rounded-xl border border-ink-700 bg-ink-800/40 p-4">
            <summary className="text-xs font-medium text-ink-300">Processing details</summary>
            <div className="mt-4">
              <Stages job={job} video={video} />
              <Log job={job} />
              <p className="mt-3 font-mono text-[11px] text-ink-500">
                {r.textModel ? `script: ${r.textModel}` : ""}{r.ttsModels.length ? ` · speech: ${r.ttsModels.join(", ")}` : ""}
              </p>
            </div>
          </details>
        </div>
      ) : (
        <div>
          {featured && video?.status === "ready" && (
            <div className="mb-5">
              <CinemaPlayer src={`/api/videos/${video.id}/file`} title={video.title} label="Source picture · processing Arabic audio" duration={video.durationSec} />
            </div>
          )}
          <Stages job={job} video={video} />
          {job.status === "failed" && job.error && (
            <div className="mt-4 rounded-xl border border-coral-400/30 bg-coral-400/10 p-3.5 text-xs leading-relaxed text-coral-300">
              <p className="flex items-start gap-2"><Icon name="alert" className="mt-0.5 h-3.5 w-3.5" /><span>{job.error}</span></p>
            </div>
          )}
          <Log job={job} />
          <div className="mt-4 flex flex-wrap gap-2">
            {active ? (
              <button type="button" className={btn.danger} onClick={() => onCancel(job.id)}>
                <Icon name="x" /> Cancel processing
              </button>
            ) : (
              <>
                <button type="button" className={btn.primary} disabled={busy} onClick={() => onResume(job)}>
                  <Icon name="refresh" /> Resume
                </button>
                <button type="button" className={btn.ghost} onClick={() => onDelete(job.id)}>
                  <Icon name="trash" /> Remove
                </button>
              </>
            )}
          </div>
          {!active && <p className="mt-2 text-[11px] text-ink-500">Resume continues from the last finished step — nothing is uploaded or translated twice.</p>}
        </div>
      )}
    </Panel>
  );
}

export function HistoryPanel({
  jobs,
  videos,
  activeJobId,
  activeVideoId,
  onOpen,
  onUseVideo,
  onDeleteJob,
  onDeleteVideo,
  onClearAll,
}: {
  jobs: JobView[];
  videos: VideoView[];
  activeJobId: string | null;
  activeVideoId: string | null;
  onOpen: (job: JobView) => void;
  onUseVideo: (video: VideoView) => void;
  onDeleteJob: (id: string) => void;
  onDeleteVideo: (id: string) => void;
  onClearAll: () => void;
}) {
  const title = (id: string) => videos.find((v) => v.id === id)?.title ?? "Deleted video";
  const ready = videos.filter((v) => v.status === "ready");
  const empty = !jobs.length && !ready.length;
  return (
    <Panel
      title="Session history"
      hint="Runs and videos from this browser session."
      action={
        !empty && (
          <button type="button" className={btn.small} onClick={onClearAll}>
            <Icon name="trash" className="h-3.5 w-3.5" /> Clear all
          </button>
        )
      }
    >
      {empty ? (
        <p className="text-xs text-ink-400">No runs yet. Finished and in-progress dubs will be listed here.</p>
      ) : (
        <div className="space-y-5">
          {jobs.length > 0 && (
            <ul className="space-y-2">
              {jobs.map((j) => {
                const st = STATUS[j.status];
                const v = voiceById(j.settings.voice);
                const historyTarget = (j.result?.targetLanguage ?? j.settings.targetLanguage ?? "ar") === "en" ? "English" : dialectById(j.settings.dialect).label.split(" (")[0].replace("Modern Standard Arabic", "MSA");
                return (
                  <li key={j.id} className={`flex items-center gap-3 rounded-xl border p-2.5 transition ${j.id === activeJobId ? "border-gold-400/50 bg-gold-400/[0.05]" : "border-ink-700 bg-ink-800/50"}`}>
                    <button type="button" onClick={() => onOpen(j)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-medium text-ink-100">{title(j.videoId)}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-ink-400">
                        #{voiceNumber(j.settings.voice) || "—"} {v?.id ?? j.settings.voice}
                        {j.settings.castMode === "cast" ? " + cast" : ""} · {historyTarget} · {timeAgo(j.createdAt)}
                      </span>
                    </button>
                    <Chip tone={st.tone}>{st.label}</Chip>
                    {j.status === "completed" && (
                      <a href={`/api/jobs/${j.id}/file?download=1`} download className={btn.small} aria-label="Download" title="Download">
                        <Icon name="download" className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <button type="button" className={btn.small} onClick={() => onDeleteJob(j.id)} aria-label="Delete run" title="Delete run">
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {ready.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-500">Videos stored on the server</p>
              <ul className="space-y-2">
                {ready.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-800/50 p-2.5">
                    <Icon name="film" className="h-4 w-4 text-ink-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink-100">{v.title}</p>
                      <p className="text-[11px] text-ink-400">{fmtDuration(v.durationSec)} · {fmtBytes(v.sizeBytes)}{v.language ? ` · ${v.language}` : ""}</p>
                    </div>
                    <button type="button" className={btn.small} disabled={v.id === activeVideoId} onClick={() => onUseVideo(v)}>
                      {v.id === activeVideoId ? "Selected" : "Use"}
                    </button>
                    <button type="button" className={btn.small} onClick={() => onDeleteVideo(v.id)} aria-label="Delete video" title="Delete video">
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
