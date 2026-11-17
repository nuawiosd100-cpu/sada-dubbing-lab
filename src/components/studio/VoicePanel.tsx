"use client";

import { useEffect, useRef, useState } from "react";
import { DIALECTS, VOICES, voiceById } from "@/lib/voices";
import type { JobSettings } from "@/lib/types";
import { getSessionId } from "./api";
import { Chip, Icon, Panel, Spinner, btn } from "./ui";

export function VoiceStudioPanel({ settings, onChange }: { settings: JobSettings; onChange: (patch: Partial<JobSettings>) => void }) {
  const [filter, setFilter] = useState<"all" | "male" | "female">("all");
  const [query, setQuery] = useState("");
  const [focusedId, setFocusedId] = useState<string | null>(null);
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

  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPreview(null);
  }, [settings.targetLanguage]);

  const play = async (id: string) => {
    const wasThis = preview?.id === id;
    token.current++;
    stop();
    if (wasThis) return;
    const mine = token.current;
    setPreviewError(null);
    setPreview({ id, state: "loading" });
    try {
      const language = settings.targetLanguage;
      const cacheKey = `${id}:${language}`;
      let src = urls.current.get(cacheKey);
      if (!src) {
        const res = await fetch(`/api/voices/${id}/preview?lang=${language}`, { headers: { "x-session-id": getSessionId() } });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error ?? "The voice preview could not be generated.");
        }
        src = URL.createObjectURL(await res.blob());
        urls.current.set(cacheKey, src);
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

  const selected = voiceById(focusedId ?? settings.voice) ?? voiceById(settings.voice) ?? VOICES[0];
  const single = settings.castMode === "single";
  const castIds = Array.from(new Set([settings.voice, ...(settings.voiceList ?? [])])).filter((id) => !!voiceById(id));
  const isAdded = castIds.includes(selected.id);

  // + always adds to the saved list, in both modes. Choosing the lead voice is a
  // separate action, so adding a second voice never silently removes the first one.
  const focusOrAdd = (id: string) => {
    setFocusedId(id);
    if (!castIds.includes(id)) onChange({ voiceList: [...castIds, id], castMode: "cast" });
  };
  const toggleCard = (id: string) => {
    setFocusedId(id);
    if (!castIds.includes(id)) {
      onChange({ voiceList: [...castIds, id], castMode: "cast" });
      return;
    }
    if (castIds.length <= 1) return; // always keep at least one voice
    const next = castIds.filter((v) => v !== id);
    onChange({ voiceList: next, voice: settings.voice === id ? next[0] : settings.voice });
  };
  const removeFromCast = (id: string) => {
    if (castIds.length <= 1) return;
    const next = castIds.filter((v) => v !== id);
    onChange({ voiceList: next, voice: settings.voice === id ? next[0] : settings.voice });
  };
  const makeLead = (id: string) => {
    setFocusedId(id);
    onChange({ voice: id, voiceList: Array.from(new Set([...castIds, id])) });
  };

  const q = query.trim().toLowerCase();
  const shown = VOICES.filter((v) => {
    if (filter !== "all" && v.gender !== filter) return false;
    if (!q) return true;
    return `${v.number} ${String(v.number).padStart(2, "0")} ${v.id} ${v.style} ${v.blurb} ${v.gender}`.toLowerCase().includes(q);
  });
  const selectedPreview = preview?.id === selected.id ? preview.state : null;

  return (
    <Panel
      step="2"
      title={`${settings.targetLanguage === "en" ? "English" : "Arabic"} voices · ${VOICES.length}`}
      hint="Add and save voices with +, then choose the lead or assign characters."
      action={<Chip tone="gold">{VOICES.filter((v) => v.gender === "male").length} male · {VOICES.filter((v) => v.gender === "female").length} female</Chip>}
    >
      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-gold-400/25 bg-gold-400/[0.045] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-ink-100">Dubbing language</p>
          <p className="mt-1 text-xs text-ink-400">Translate the source dialogue and generate speech in this language.</p>
        </div>
        <select
          value={settings.targetLanguage}
          onChange={(e) => onChange({ targetLanguage: e.target.value as JobSettings["targetLanguage"] })}
          aria-label="Dubbing language"
          className="rounded-xl border border-gold-400/35 bg-ink-900 px-3 py-2.5 text-sm font-medium text-gold-300 focus:border-gold-400 focus:outline-none"
        >
          <option value="ar">Arabic — translate into Arabic</option>
          <option value="en">English — translate into English</option>
        </select>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="How voices are used in the video">
        <button
          type="button"
          role="radio"
          aria-checked={single}
          onClick={() => onChange({ castMode: "single" })}
          className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition ${single ? "border-gold-400/70 bg-gold-400/[0.08]" : "border-ink-700 bg-ink-800/60 hover:border-ink-600"}`}
        >
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${single ? "bg-gold-400 text-ink-950" : "bg-ink-700 text-ink-300"}`}><Icon name="mic" /></span>
          <span>
            <span className="block text-sm font-semibold text-ink-100">One voice for the whole video</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-ink-400">The lead voice reads every line. Other added voices stay saved.</span>
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!single}
          onClick={() => onChange({ castMode: "cast", voiceList: castIds })}
          className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition ${!single ? "border-gold-400/70 bg-gold-400/[0.08]" : "border-ink-700 bg-ink-800/60 hover:border-ink-600"}`}
        >
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${!single ? "bg-gold-400 text-ink-950" : "bg-ink-700 text-ink-300"}`}><Icon name="users" /></span>
          <span>
            <span className="block text-sm font-semibold text-ink-100">Smart male / female casting</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-ink-400">Female speech gets your female voices; male speech gets your male voices.</span>
          </span>
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-gold-400/30 bg-gradient-to-br from-gold-400/[0.08] to-transparent p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gold-400 font-mono text-lg font-bold text-ink-950">
            {String(selected.number).padStart(2, "0")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-ink-100">{selected.id} <span className="text-xs font-medium uppercase tracking-wider text-ink-400">{selected.gender} · {selected.style}</span></p>
            <p className="mt-0.5 text-xs text-ink-400">{selected.blurb}</p>
          </div>
          <Chip tone={isAdded ? "mint" : "gold"}><Icon name={isAdded ? "check" : "plus"} className="h-3 w-3" />{selected.id === settings.voice ? (single ? "Reads every line" : "Lead voice") : isAdded ? "Added to cast" : "Not added yet"}</Chip>
          <button
            type="button"
            onClick={() => void play(selected.id)}
            className={selectedPreview ? btn.primary : btn.ghost}
            aria-label={selectedPreview ? `Stop ${selected.id} preview` : `Preview ${selected.id} in ${settings.targetLanguage === "en" ? "English" : "Arabic"}`}
          >
            {selectedPreview === "loading" ? <Spinner /> : <Icon name={selectedPreview === "playing" ? "stop" : "play"} />}
            {selectedPreview === "playing" ? "Stop" : "Preview"}
          </button>
          {selected.id !== settings.voice && (
            <button type="button" onClick={() => makeLead(selected.id)} className={btn.ghost}>
              <Icon name="check" /> {single ? "Use for whole video" : "Make lead"}
            </button>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-400">Choose by number</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-gold-400">#</span>
              <input
                type="number"
                min={1}
                max={VOICES.length}
                step={1}
                value={selected.number}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  const v = VOICES.find((item) => item.number === n);
                  if (v) focusOrAdd(v.id);
                }}
                aria-label="Voice number"
                className="w-full rounded-xl border border-ink-600 bg-ink-900 py-2.5 pl-8 pr-3 font-mono text-sm font-semibold text-ink-100 focus:border-gold-400 focus:outline-none"
              />
            </div>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-400">Or choose from the numbered list</span>
            <select
              value={selected.id}
              onChange={(e) => focusOrAdd(e.target.value)}
              aria-label="Selected dubbing voice"
              className="w-full rounded-xl border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-ink-100 focus:border-gold-400 focus:outline-none"
            >
              {VOICES.map((v) => <option key={v.id} value={v.id}>#{String(v.number).padStart(2, "0")} — {v.id} ({v.gender}, {v.style})</option>)}
            </select>
          </label>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-300">
          {single
            ? `Voice #${String(selected.number).padStart(2, "0")} ${selected.id} is ${selected.id === settings.voice ? `the lead and will speak all ${settings.targetLanguage === "en" ? "English" : "Arabic"} dialogue` : "saved, but not the lead yet"}. Adding more voices never removes them; use “Use for whole video” to change the lead.`
            : `Your cast has ${castIds.length} saved voice${castIds.length === 1 ? "" : "s"}. Use + on more cards to add without replacing them. ${selected.id === settings.voice ? `${selected.id} is the lead voice.` : ""}`}
        </p>
        {(
          <div className="mt-4 border-t border-gold-400/20 pt-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-xs font-semibold text-ink-100"><Icon name="users" className="h-3.5 w-3.5 text-gold-400" /> {single ? "Your saved voices" : "Your saved cast"} · {castIds.length}</p>
              <span className="flex items-center gap-1 text-[11px] text-mint-300"><Icon name="check" className="h-3 w-3" /> Saved automatically</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {castIds.map((id) => {
                const v = voiceById(id);
                if (!v) return null;
                const lead = id === settings.voice;
                return (
                  <div key={id} className={`flex items-center gap-1 rounded-lg border py-1 pl-2 pr-1 ${lead ? "border-gold-400/50 bg-gold-400/10" : "border-ink-600 bg-ink-900/70"}`}>
                    <span className="font-mono text-[10px] text-gold-300">#{String(v.number).padStart(2, "0")}</span>
                    <span className="max-w-28 truncate text-xs font-medium text-ink-100">{v.id}</span>
                    {lead ? (
                      <span className="rounded bg-gold-400/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-gold-300">Lead</span>
                    ) : (
                      <button type="button" onClick={() => makeLead(id)} className="rounded px-1.5 py-0.5 text-[10px] text-ink-400 hover:bg-ink-700 hover:text-ink-100" title={`Make ${v.id} the lead voice`}>{single ? "Use this" : "Make lead"}</button>
                    )}
                    <button type="button" onClick={() => removeFromCast(id)} disabled={castIds.length <= 1} className="grid h-6 w-6 place-items-center rounded text-ink-400 hover:bg-coral-400/15 hover:text-coral-300 disabled:opacity-30" aria-label={`Remove ${v.id} from cast`} title="Remove from cast"><Icon name="x" className="h-3 w-3" /></button>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-500">{single ? "Only the lead reads this video. Every other voice stays saved for later or for character mode." : "These voices are reused for this video's characters. After a run, use each speaker's voice menu in the Output panel to assign them and regenerate."}</p>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Icon name="spark" className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a voice by name, style or number…"
            aria-label="Find a voice"
            className="w-full rounded-xl border border-ink-600 bg-ink-900 py-2 pl-9 pr-3 text-xs text-ink-100 placeholder:text-ink-500 focus:border-gold-400 focus:outline-none"
          />
        </div>
        <div className="flex gap-1 self-start rounded-lg bg-ink-900 p-1 ring-1 ring-ink-700">
          {(["all", "male", "female"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${filter === f ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-200"}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-slim mt-3 grid max-h-[390px] grid-cols-1 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3" role="group" aria-label="Numbered dubbing voices">
        {shown.map((v) => {
          const isSelected = castIds.includes(v.id);
          const p = preview?.id === v.id ? preview.state : null;
          return (
            <div
              key={v.id}
              className={`flex items-stretch gap-1 rounded-xl border p-1.5 transition ${isSelected ? "border-gold-400/70 bg-gold-400/[0.07] shadow-[0_0_0_1px_rgb(255_191_71/0.2)]" : "border-ink-700 bg-ink-800/60 hover:border-ink-600"}`}
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                aria-label={`${isSelected ? "Remove" : "Add"} voice ${v.number} ${v.id}${isSelected ? " from cast" : " to cast"}`}
                onClick={() => toggleCard(v.id)}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left"
              >
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg font-mono text-[11px] font-semibold ${isSelected ? "bg-gold-400 text-ink-950" : v.gender === "female" ? "bg-coral-400/15 text-coral-300" : "bg-mint-400/15 text-mint-300"}`}>
                  {String(v.number).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-100">{v.id}</span>
                  <span className="block truncate text-[11px] text-ink-400">{v.gender} · {v.blurb}</span>
                </span>
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${isSelected ? "bg-gold-400 text-ink-950" : "bg-ink-700 text-gold-300"}`} title={single ? "Selected" : isSelected ? "Added — click to remove" : "Add to cast"}>
                  <Icon name={isSelected ? "check" : "plus"} className="h-3.5 w-3.5" />
                </span>
              </button>
              <button
                type="button"
                onClick={() => void play(v.id)}
                aria-label={p ? `Stop voice ${v.number} ${v.id} preview` : `Preview voice ${v.number} ${v.id} in ${settings.targetLanguage === "en" ? "English" : "Arabic"}`}
                title={p ? "Stop" : `Preview voice #${v.number}`}
                className={`grid w-9 shrink-0 place-items-center rounded-lg transition ${p ? "bg-gold-400 text-ink-950" : "bg-ink-700/70 text-ink-200 hover:bg-ink-600"}`}
              >
                {p === "loading" ? <Spinner /> : <Icon name={p === "playing" ? "stop" : "play"} />}
              </button>
            </div>
          );
        })}
        {!shown.length && <p className="col-span-full rounded-xl border border-dashed border-ink-600 p-6 text-center text-xs text-ink-400">No voice matches “{query}”. Try another name or number.</p>}
      </div>

      {previewError && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-gold-400/30 bg-gold-400/10 p-3 text-xs leading-relaxed text-gold-300">
          <Icon name="alert" className="mt-0.5 h-3.5 w-3.5" /> {previewError}
        </p>
      )}

      <div className="mt-5 grid gap-4 border-t border-ink-700/70 pt-4 md:grid-cols-2">
        {settings.targetLanguage === "ar" ? (
          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-400"><Icon name="globe" className="h-3.5 w-3.5" /> Arabic style</span>
            <select value={settings.dialect} onChange={(e) => onChange({ dialect: e.target.value as JobSettings["dialect"] })} className="w-full rounded-xl border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-ink-100 focus:border-gold-400 focus:outline-none">
              {DIALECTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
        ) : (
          <div>
            <span className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-400"><Icon name="globe" className="h-3.5 w-3.5" /> English delivery</span>
            <div className="rounded-xl border border-ink-700 bg-ink-900/60 px-3 py-2.5 text-sm text-ink-300">Natural English for film dubbing</div>
          </div>
        )}
        <label className="block">
          <span className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-400"><Icon name="spark" className="h-3.5 w-3.5" /> Voice generation</span>
          <select value={settings.ttsMode} onChange={(e) => onChange({ ttsMode: e.target.value as JobSettings["ttsMode"] })} className="w-full rounded-xl border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-ink-100 focus:border-gold-400 focus:outline-none">
            <option value="economy">Economy — several lines per AI request</option>
            <option value="precise">Precise — one AI request per line</option>
          </select>
        </label>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-500">Economy uses fewer Gemini requests. Previews are real {settings.targetLanguage === "en" ? "English" : "Arabic"} samples and are generated only when you press play.</p>
    </Panel>
  );
}
