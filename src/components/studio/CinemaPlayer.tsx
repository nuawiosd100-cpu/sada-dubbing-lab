"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { DubCue } from "@/lib/types";
import { fmtDuration, fmtMilliseconds, Icon } from "./ui";

const COLORS = ["#ffbf47", "#57d8c4", "#ff7a70", "#a995ff", "#70a7ff", "#f39bd4"];

export function CinemaPlayer({
  src,
  title,
  label,
  cues = [],
  duration,
}: {
  src: string;
  title: string;
  label: string;
  cues?: DubCue[];
  duration?: number | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mediaDuration, setMediaDuration] = useState(duration ?? 0);

  useEffect(() => {
    setTime(0);
    setPlaying(false);
    setMediaDuration(duration ?? 0);
  }, [src, duration]);

  // A real playhead driven by the video element's clock, not a CSS animation.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) setTime(v.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, src]);

  const total = Math.max(0.01, mediaDuration || duration || 0.01);
  const progress = Math.max(0, Math.min(1, time / total));
  const speakers = Array.from(new Set(cues.map((c) => c.speaker)));
  const seekTo = (next: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(total, next));
    setTime(v.currentTime);
  };
  const seekFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo(((e.clientX - rect.left) / rect.width) * total);
  };

  return (
    <div className="cinema-frame overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_35px_90px_-35px_rgba(0,0,0,0.95)]">
      <div className="relative bg-black">
        <div className="pointer-events-none absolute left-4 top-4 z-10 flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-lg border border-white/10 bg-black/65 px-3 py-1.5 backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_8px_rgba(255,191,71,0.8)]" />
          <span className="truncate font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-white/80">{label}</span>
        </div>
        <video
          ref={videoRef}
          key={src}
          src={src}
          title={title}
          controls
          playsInline
          preload="metadata"
          className="aspect-video max-h-[260px] w-full bg-black object-contain"
          onLoadedMetadata={(e) => {
            if (Number.isFinite(e.currentTarget.duration)) setMediaDuration(e.currentTarget.duration);
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onSeeked={(e) => setTime(e.currentTarget.currentTime)}
          onTimeUpdate={(e) => {
            if (!playing) setTime(e.currentTarget.currentTime);
          }}
        />
      </div>

      <div className="border-t border-white/[0.07] bg-[#0b0b0e] px-4 py-3 sm:px-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-white/65">
            <Icon name="clock" className="h-3.5 w-3.5 text-gold-400" />
            <span className="text-white">{fmtDuration(time)}</span>
            <span className="text-white/25">/</span>
            <span>{fmtDuration(total)}</span>
          </span>
          <span className="hidden font-mono text-[9px] uppercase tracking-[0.18em] text-white/35 sm:block">
            {cues.length ? `${cues.length} millisecond-timed cues` : "Source timeline"}
          </span>
        </div>

        <div
          className="group relative h-10 cursor-pointer select-none rounded-lg bg-white/[0.025] px-1 focus-visible:outline-gold-400"
          role="slider"
          tabIndex={0}
          aria-label="Seek through video"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${fmtDuration(time)} of ${fmtDuration(total)}`}
          onPointerDown={seekFromPointer}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") { e.preventDefault(); seekTo(time + 5); }
            if (e.key === "ArrowLeft") { e.preventDefault(); seekTo(time - 5); }
            if (e.key === "Home") { e.preventDefault(); seekTo(0); }
            if (e.key === "End") { e.preventDefault(); seekTo(total); }
          }}
        >
          <div className="absolute inset-x-2 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-white/15 transition-[width] duration-75" style={{ width: `${progress * 100}%` }} />
          </div>
          {cues.map((cue, i) => {
            const speakerIndex = Math.max(0, speakers.indexOf(cue.speaker));
            const left = Math.max(0, Math.min(100, (cue.start / total) * 100));
            const width = Math.max(0.12, Math.min(100 - left, ((cue.end - cue.start) / total) * 100));
            return (
              <span
                key={`${cue.start}-${i}`}
                className="absolute top-[7px] h-[26px] min-w-px rounded-[2px] opacity-75 transition-opacity hover:opacity-100"
                style={{ left: `calc(${left}% + 2px)`, width: `max(1px, ${width}%)`, backgroundColor: COLORS[speakerIndex % COLORS.length] }}
                title={`${cue.speaker} · ${cue.voice ?? ""} · ${fmtMilliseconds(cue.start)}–${fmtMilliseconds(cue.end)}${cue.offsetMs != null ? ` · ${cue.offsetMs >= 0 ? "+" : ""}${cue.offsetMs} ms` : ""}`}
              />
            );
          })}
          <span className="pointer-events-none absolute bottom-0 top-0 w-px bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" style={{ left: `calc(${progress * 100}% + 2px)` }}>
            <span className="absolute -left-[3px] top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full bg-white" />
          </span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-white/40">
          {cues.length > 0 && (
            <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-gold-400/80" /> Dubbed speech</span>
          )}
          <span>Click the timeline to seek · Arrow keys move 5 seconds</span>
          <span className="ml-auto hidden items-center gap-1.5 sm:flex"><Icon name="film" className="h-3 w-3" /> Millisecond picture clock</span>
        </div>
      </div>
    </div>
  );
}
