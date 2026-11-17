"use client";

import type { CSSProperties, ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  upload: (<><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>),
  link: (<><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" /></>),
  play: <path d="M7.5 4.5v15l12-7.5z" fill="currentColor" stroke="none" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: (<><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>),
  trash: (<><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="m6 7 1 13h10l1-13" /></>),
  download: (<><path d="M12 4v12" /><path d="m7 11 5 5 5-5" /><path d="M4 20h16" /></>),
  mic: (<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></>),
  sliders: (<><path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" /><path d="M4 17h4" /><path d="M12 17h8" /><circle cx="10" cy="17" r="2" /></>),
  film: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></>),
  refresh: (<><path d="M20 11a8 8 0 0 0-14.3-4.3L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.3 4.3L20 16" /><path d="M20 20v-4h-4" /></>),
  alert: (<><path d="M12 3.5 2.5 19.5h19z" /><path d="M12 10v4" /><path d="M12 17v.4" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  users: (<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" /><path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></>),
  wave: <path d="M3 12h1M7 7v10M11 4v16M15 8v8M19 10v4" />,
  volume: (<><path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z" /><path d="M16 9a4 4 0 0 1 0 6" /><path d="M18.5 6.5a8 8 0 0 1 0 11" /></>),
  mute: (<><path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z" /><path d="m16 9.5 5 5M21 9.5l-5 5" /></>),
  globe: (<><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18" /></>),
  spark: <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />,
  dot: <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />,
  key: (<><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9" /><path d="m16 7 3 3" /><path d="m13.5 9.5 2 2" /></>),
  eye: (<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>),
  eyeoff: (<><path d="M3 3l18 18" /><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1" /><path d="M6.5 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1.1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>),
  shield: (<><path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z" /><path d="m9 12 2.2 2.2L15 10.5" /></>),
  plus: (<><path d="M12 5v14" /><path d="M5 12h14" /></>),
};

export function Icon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>
      {PATHS[name]}
    </svg>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 animate-spin ${className}`} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function fmtBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "0 MB";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** M:SS.mmm — used for picture-locked cue inspection. */
export function fmtMilliseconds(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const m = Math.floor(totalMs / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function Panel({
  step,
  title,
  hint,
  action,
  children,
  id,
}: {
  step?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="rise rounded-[22px] border border-white/[0.085] bg-gradient-to-b from-[#18151b]/95 to-[#100e13]/95 shadow-[inset_0_1px_0_rgb(255_255_255/0.035),0_30px_80px_-42px_rgb(0_0_0/0.95)] backdrop-blur-xl">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.065] bg-white/[0.012] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          {step && (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold-400/10 font-mono text-xs font-medium text-gold-400 ring-1 ring-gold-400/25">
              {step}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink-100">{title}</h2>
            {hint && <p className="mt-0.5 text-xs text-ink-400">{hint}</p>}
          </div>
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Bar({ value, tone = "gold" }: { value: number | null; tone?: "gold" | "mint" }) {
  const color = tone === "mint" ? "bg-mint-400" : "bg-gold-400";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value == null ? undefined : Math.round(value * 100)}>
      {value == null ? (
        <div className={`bar-indeterminate h-full rounded-full ${color}`} />
      ) : (
        <div className={`h-full rounded-full ${color} transition-[width] duration-500 ease-out`} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
      )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-xl border border-ink-700 bg-ink-800/60 p-3 text-left transition hover:border-ink-600 disabled:opacity-50"
    >
      <span className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-gold-400" : "bg-ink-600"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-ink-950 transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink-100">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-ink-400">{description}</span>}
      </span>
    </button>
  );
}

export function Slider({
  value,
  onChange,
  color,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  color: string;
  label: string;
}) {
  return (
    <input
      type="range"
      min={0}
      max={100}
      step={1}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
      className="slider"
      style={{ "--pct": `${value}%`, "--fill": color } as CSSProperties}
    />
  );
}

export const btn = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-xl border border-gold-300/30 bg-gradient-to-b from-gold-300 to-gold-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-[0_8px_24px_-12px_rgb(255_191_71/0.65)] transition hover:brightness-110 active:translate-y-px disabled:border-ink-600 disabled:bg-ink-700 disabled:text-ink-500 disabled:shadow-none",
  ghost:
    "inline-flex items-center justify-center gap-2 rounded-xl border border-ink-600 bg-ink-800/70 px-3.5 py-2 text-sm font-medium text-ink-200 transition hover:border-ink-500 hover:bg-ink-700 disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-xl border border-coral-500/40 bg-coral-500/10 px-3.5 py-2 text-sm font-medium text-coral-300 transition hover:bg-coral-500/20 disabled:opacity-50",
  small:
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800/70 px-2.5 py-1.5 text-xs font-medium text-ink-200 transition hover:border-ink-500 hover:bg-ink-700 disabled:opacity-50",
};

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "gold" | "mint" | "coral" }) {
  const tones = {
    neutral: "border-ink-600 bg-ink-800 text-ink-300",
    gold: "border-gold-400/30 bg-gold-400/10 text-gold-300",
    mint: "border-mint-400/30 bg-mint-400/10 text-mint-300",
    coral: "border-coral-400/30 bg-coral-400/10 text-coral-300",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
