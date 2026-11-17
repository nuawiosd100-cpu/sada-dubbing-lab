"use client";

import type { JobSettings } from "@/lib/types";
import { Chip, Icon, Slider, Toggle, btn } from "./ui";

function Channel({
  title,
  subtitle,
  icon,
  color,
  enabled,
  volume,
  onEnabled,
  onVolume,
}: {
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  enabled: boolean;
  volume: number;
  onEnabled: (value: boolean) => void;
  onVolume: (value: number) => void;
}) {
  return (
    <div className={`rounded-xl border p-4 transition ${enabled ? "border-ink-600 bg-ink-800/70" : "border-ink-700 bg-ink-900/45"}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-100"><Icon name={icon} className="h-4 w-4" />{title}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-500">{subtitle}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${title} ${enabled ? "on" : "off"}`}
          onClick={() => onEnabled(!enabled)}
          className={`flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold transition ${enabled ? "border-mint-400/40 bg-mint-400/10 text-mint-300" : "border-ink-600 bg-ink-800 text-ink-500"}`}
        >
          <span className={`h-2 w-2 rounded-full ${enabled ? "bg-mint-400" : "bg-ink-500"}`} />{enabled ? "ON" : "OFF"}
        </button>
      </div>
      <div className="mb-2 flex items-center justify-between font-mono text-xs">
        <span className="text-ink-500">Volume</span>
        <span style={{ color: enabled ? color : undefined }} className={enabled ? "" : "text-ink-500"}>{volume}%</span>
      </div>
      <Slider value={volume} onChange={onVolume} color={color} label={`${title} volume`} />
    </div>
  );
}

export function StemMixer({ settings, onChange }: { settings: JobSettings; onChange: (patch: Partial<JobSettings>) => void }) {
  const targetName = settings.targetLanguage === "en" ? "English" : "Arabic";
  const preferred = () => onChange({
    audioMode: "stems",
    dubEnabled: true,
    dialogueEnabled: false,
    effectsEnabled: true,
    musicEnabled: true,
    dubVolume: 100,
    dialogueVolume: 80,
    effectsVolume: 100,
    musicVolume: 100,
  });
  return (
    <div className="mt-4">
      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-gold-400/25 bg-gold-400/[0.055] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-gold-300">{targetName} dialogue + original cinema background</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">Mute only the actors&apos; original speech. Keep the separated effects and score.</p>
        </div>
        <button type="button" className={`${btn.primary} shrink-0`} onClick={preferred}><Icon name="spark" /> Apply preferred mix</button>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-400">Cinematic AI separation model</span>
          <select
            value={settings.separationModel}
            onChange={(e) => onChange({ separationModel: e.target.value as JobSettings["separationModel"] })}
            className="w-full rounded-xl border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-ink-100 focus:border-gold-400 focus:outline-none"
          >
            <option value="mrx">MRX — faster, good for long films</option>
            <option value="tiger">TIGER-DnR — higher quality, much slower</option>
          </select>
        </label>
        <Chip tone="mint"><Icon name="check" className="h-3 w-3" />Real dialogue / effects / music stems</Chip>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Channel title={`${targetName} dubbed voice`} subtitle="The generated Arabic dialogue track." icon="mic" color="#ffbf47" enabled={settings.dubEnabled} volume={settings.dubVolume} onEnabled={(v) => onChange({ dubEnabled: v })} onVolume={(v) => onChange({ dubVolume: v })} />
        <Channel title="Original dialogue" subtitle="OFF completely removes this stem from the mix." icon="users" color="#ff7a70" enabled={settings.dialogueEnabled} volume={settings.dialogueVolume} onEnabled={(v) => onChange({ dialogueEnabled: v })} onVolume={(v) => onChange({ dialogueVolume: v })} />
        <Channel title="Background sounds & effects" subtitle="Doors, footsteps, cars, glass, fights and ambience." icon="wave" color="#3fd9c4" enabled={settings.effectsEnabled} volume={settings.effectsVolume} onEnabled={(v) => onChange({ effectsEnabled: v })} onVolume={(v) => onChange({ effectsVolume: v })} />
        <Channel title="Original background music" subtitle="The movie score and background soundtrack." icon="volume" color="#a995ff" enabled={settings.musicEnabled} volume={settings.musicVolume} onEnabled={(v) => onChange({ musicEnabled: v })} onVolume={(v) => onChange({ musicVolume: v })} />
      </div>

      <div className="mt-4 grid gap-2.5 md:grid-cols-2">
        <Toggle checked={settings.clarity} onChange={(v) => onChange({ clarity: v })} label={`Louder, clearer ${targetName}`} description="Presence EQ and compression on the Arabic channel only." />
        <Toggle checked={settings.ducking} onChange={(v) => onChange({ ducking: v })} label="Duck background under Arabic" description={`Temporarily lowers retained stems while ${targetName} speaks; disable for constant background volume.`} />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
        Separation runs locally with a cinematic AI model and is cached for later mixes. MRX is much faster; TIGER usually separates more accurately but can take many times the video duration on CPU. The models output mono stems, which are remixed to stereo. No separation model can guarantee perfect removal in every scene; TIGER is the better choice when dialogue leakage is your main concern.
      </p>
    </div>
  );
}
