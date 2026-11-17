"use client";

import { useState } from "react";
import type { KeyCheck, KeyVerification, ServerStatus } from "@/lib/types";
import { ApiError, api } from "./api";
import { Chip, Icon, Panel, Spinner, btn, timeAgo } from "./ui";

const ROWS = [
  { key: "auth", label: "Key accepted by Google", pending: "Asking Google to authenticate the key" },
  { key: "text", label: "Language detection & translation", pending: "Sending a real test request with the key" },
  { key: "speech", label: "Arabic voice generation", pending: "Generating a short real Arabic sample with the key" },
] as const;

const STATE_LABEL = { ok: "working", limited: "limited by Google", failed: "failed" } as const;

function Row({ label, check, pending }: { label: string; check: KeyCheck | null; pending: string | null }) {
  const tone = !check
    ? "bg-ink-800 text-ink-400 ring-ink-600"
    : check.state === "ok"
      ? "bg-mint-400/15 text-mint-300 ring-mint-400/30"
      : check.state === "limited"
        ? "bg-gold-400/15 text-gold-300 ring-gold-400/40"
        : "bg-coral-400/15 text-coral-300 ring-coral-400/40";
  const text = !check ? "text-ink-400" : check.state === "ok" ? "text-mint-300" : check.state === "limited" ? "text-gold-300" : "text-coral-300";
  return (
    <li className="flex gap-3">
      <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ring-1 ${tone}`}>
        {!check ? (
          pending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="dot" className="h-3.5 w-3.5" />
        ) : (
          <Icon name={check.state === "ok" ? "check" : check.state === "limited" ? "clock" : "x"} className="h-3.5 w-3.5" />
        )}
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-ink-100">
          {label}
          <span className={`font-mono text-[11px] ${text}`}>{check ? STATE_LABEL[check.state] : pending ? "checking…" : ""}</span>
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-400">{check ? check.detail : pending}</p>
      </div>
    </li>
  );
}

function Checklist({ v, pending }: { v: KeyVerification | null; pending: boolean }) {
  return (
    <ul className="space-y-3">
      {ROWS.map((r) => (
        <Row key={r.key} label={r.label} check={v ? v[r.key] : null} pending={pending ? r.pending : null} />
      ))}
    </ul>
  );
}

export function KeyPanel({ status, onChanged }: { status: ServerStatus | null; onChanged: () => Promise<void> | void }) {
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<"verify" | "reverify" | "remove" | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const personal = status?.personalKey ?? null;
  const v = personal?.verification ?? null;
  const worst = !v
    ? null
    : [v.auth, v.text, v.speech].some((c) => c.state === "failed")
      ? "failed"
      : [v.text, v.speech].some((c) => c.state === "limited")
        ? "limited"
        : "ok";

  const submit = async () => {
    const key = value.trim();
    if (!key || busy) return;
    setBusy("verify");
    setError(null);
    try {
      await api("/api/key", { method: "POST", body: JSON.stringify({ key }) });
      // The key now lives only on the server: wipe it from the page.
      setValue("");
      setShow(false);
      setEditing(false);
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Verification failed.");
    } finally {
      setBusy(null);
    }
  };

  const reverify = async () => {
    setBusy("reverify");
    setError(null);
    try {
      await api("/api/key", { method: "POST", body: JSON.stringify({ action: "reverify" }) });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!window.confirm("Remove your personal API key from this server?")) return;
    setBusy("remove");
    setError(null);
    try {
      await api("/api/key", { method: "DELETE" });
      setEditing(false);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The key could not be removed.");
    } finally {
      setBusy(null);
    }
  };

  const chip = !status ? (
    <Chip>Checking…</Chip>
  ) : personal ? (
    worst === "ok" ? (
      <Chip tone="mint"><Icon name="shield" className="h-3 w-3" />Activated · your key {personal.hint}</Chip>
    ) : worst === "limited" ? (
      <Chip tone="gold"><Icon name="clock" className="h-3 w-3" />Your key {personal.hint} · quota limited</Chip>
    ) : (
      <Chip tone="coral"><Icon name="alert" className="h-3 w-3" />Your key {personal.hint} · needs attention</Chip>
    )
  ) : status.serverKeyAvailable ? (
    <Chip>Built-in server key in use</Chip>
  ) : (
    <Chip tone="coral">Not activated</Chip>
  );

  const banner =
    worst === "ok"
      ? {
          box: "border-mint-400/35 bg-mint-400/[0.08]",
          icon: "bg-mint-400/15 text-mint-300",
          title: "text-mint-300",
          head: `Activated — the service is running on your personal key ${personal?.hint}`,
          sub: "Every step — language detection, translation and Arabic voices — now uses your own Google credentials and quota.",
        }
      : worst === "limited"
        ? {
            box: "border-gold-400/35 bg-gold-400/[0.08]",
            icon: "bg-gold-400/15 text-gold-300",
            title: "text-gold-300",
            head: `Your key ${personal?.hint} is verified and active — but Google is limiting it right now`,
            sub: "Dubbing runs on your credentials and will stop at the limited step until the quota returns. Details below.",
          }
        : {
            box: "border-coral-400/35 bg-coral-400/[0.08]",
            icon: "bg-coral-400/15 text-coral-300",
            title: "text-coral-300",
            head: `Your key ${personal?.hint} is saved, but a check failed`,
            sub: "The service will try to use it. Fix the problem below, verify again, or replace the key.",
          };

  return (
    <Panel
      id="api-key"
      title="Google AI key"
      hint="Use your own Google AI Studio key. It is verified live with Google before it is activated."
      action={chip}
    >
      {personal && v && !editing ? (
        <div className="space-y-4">
          <div className={`flex items-start gap-3 rounded-xl border p-4 ${banner.box}`}>
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${banner.icon}`}>
              <Icon name={worst === "ok" ? "shield" : worst === "limited" ? "clock" : "alert"} className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${banner.title}`}>{banner.head}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-300">{banner.sub}</p>
              <p className="mt-1 text-[11px] text-ink-500">Last verified with Google {timeAgo(new Date(v.checkedAt).toISOString())}.</p>
            </div>
          </div>
          <Checklist v={busy === "reverify" ? null : v} pending={busy === "reverify"} />
          {error && (
            <p className="flex items-start gap-2 rounded-xl border border-coral-400/30 bg-coral-400/10 p-3 text-xs leading-relaxed text-coral-300">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5" /> {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.ghost} disabled={busy !== null} onClick={() => void reverify()}>
              {busy === "reverify" ? <Spinner /> : <Icon name="refresh" />} Verify again
            </button>
            <button type="button" className={btn.ghost} disabled={busy !== null} onClick={() => { setEditing(true); setError(null); }}>
              <Icon name="key" /> Replace key
            </button>
            <button type="button" className={btn.danger} disabled={busy !== null} onClick={() => void remove()}>
              {busy === "remove" ? <Spinner /> : <Icon name="trash" />} Remove key
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-500">
            Each verification makes one tiny text request and one short speech request with your key. The key is stored encrypted on the server for this browser only and is never sent back to the page.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-ink-300">
            {!status
              ? "Checking which credentials are active…"
              : editing
                ? `Paste the new key. Your current key ${personal?.hint} stays active until the new one is accepted by Google.`
                : status.serverKeyAvailable
                  ? "The service is currently running on the server’s built-in key. Add your own key to run on your personal quota and billing instead."
                  : "No key is active yet. Paste your Google AI Studio key to activate the service."}
          </p>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="relative flex-1">
              <Icon name="key" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
              <input
                type={show ? "text" : "password"}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
                placeholder="Paste your Google AI Studio API key"
                aria-label="Your Google AI Studio API key"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                disabled={busy !== null}
                className="w-full rounded-xl border border-ink-600 bg-ink-900 py-2.5 pl-10 pr-11 font-mono text-sm text-ink-100 placeholder:font-sans placeholder:text-ink-500 focus:border-gold-400 focus:outline-none disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Hide key" : "Show key"}
                title={show ? "Hide key" : "Show key"}
                className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-ink-400 hover:bg-ink-700 hover:text-ink-100"
              >
                <Icon name={show ? "eyeoff" : "eye"} />
              </button>
            </div>
            <button type="submit" className={btn.primary} disabled={!value.trim() || busy !== null}>
              {busy === "verify" ? <Spinner /> : <Icon name="shield" />} Verify &amp; activate
            </button>
            {editing && (
              <button type="button" className={btn.ghost} disabled={busy !== null} onClick={() => { setEditing(false); setValue(""); setError(null); }}>
                Cancel
              </button>
            )}
          </form>

          {busy === "verify" && (
            <div className="rise rounded-xl border border-ink-700 bg-ink-800/60 p-4">
              <p className="mb-3 text-xs font-medium text-ink-300">Verifying with Google — this takes a few seconds…</p>
              <Checklist v={null} pending />
            </div>
          )}

          {error && (
            <div className="rise rounded-xl border border-coral-400/30 bg-coral-400/10 p-4 text-xs leading-relaxed">
              <p className="flex items-start gap-2 font-medium text-coral-300">
                <Icon name="alert" className="mt-0.5 h-3.5 w-3.5" /> The key was not activated
              </p>
              <p className="mt-1.5 text-ink-300">{error}</p>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-ink-500">
            Get a key at{" "}
            <a href="https://aistudio.google.com/app/api-keys" target="_blank" rel="noreferrer" className="text-gold-300 underline decoration-gold-400/40 underline-offset-2 hover:text-gold-400">
              aistudio.google.com/app/api-keys
            </a>
            . Your key is sent once over HTTPS, checked with three real Google requests, stored encrypted on the server for this browser only, and never sent back to the page. You can remove it at any time.
          </p>
        </div>
      )}
    </Panel>
  );
}
