// Types shared by the server pipeline and the browser UI.

export type Gender = "male" | "female" | "unknown";
export type SpeakerAge = "child" | "young" | "adult" | "mature" | "unknown";
export type DialectId = "msa" | "egyptian" | "levantine" | "gulf";

/** Download quality offered for YouTube imports (height cap in pixels, or "best"). */
export const YOUTUBE_QUALITIES = [
  { id: "best", label: "Best available (up to 1080p)" },
  { id: "1080", label: "1080p" },
  { id: "720", label: "720p" },
  { id: "480", label: "480p" },
  { id: "360", label: "360p" },
  { id: "240", label: "240p" },
] as const;
export type YouTubeQuality = (typeof YOUTUBE_QUALITIES)[number]["id"];

/** Details read from a direct download link before importing it. */
export type DirectLinkInfo = {
  url: string;
  name: string;
  size: number | null;
  contentType: string | null;
};

export type Segment = {
  start: number;
  end: number;
  speaker: string;
  text: string;
  /** Arabic translation used by existing Arabic transcripts. */
  arabic?: string;
  /** Target-language translation (English, or future targets). */
  translation?: string;
};

export type Speaker = {
  id: string;
  gender: Gender;
  /** Apparent age band, used to pick child/young/mature voices. */
  age?: SpeakerAge;
  description: string;
  genderConfidence?: number;
  genderSource?: "script" | "audio" | "description";
};

export type StageKey = "extract" | "separate" | "detect" | "translate" | "voice" | "render";
export type StageStatus = "pending" | "running" | "done" | "cached" | "failed";

export type StageState = {
  key: StageKey;
  label: string;
  status: StageStatus;
  /** 0..1 measured by the backend, or null while a step has no measurable sub-progress. */
  progress: number | null;
  detail: string;
};

export type JobSettings = {
  voice: string;
  /** Voices added with + for this dub. The first/lead voice is `voice`. */
  voiceList: string[];
  castMode: "single" | "cast";
  speakerVoices: Record<string, string>;
  dialect: DialectId;
  targetLanguage: "ar" | "en";
  dubVolume: number;
  originalVolume: number;
  ducking: boolean;
  clarity: boolean;
  reduceDialogue: boolean;
  /** Classic keeps the existing mix. Stems enables real AI dialogue/music/effects separation. */
  audioMode: "classic" | "stems";
  separationModel: "mrx" | "tiger";
  dubEnabled: boolean;
  dialogueEnabled: boolean;
  effectsEnabled: boolean;
  musicEnabled: boolean;
  dialogueVolume: number;
  effectsVolume: number;
  musicVolume: number;
  ttsMode: "economy" | "precise";
};

export const DEFAULT_SETTINGS: JobSettings = {
  voice: "Orus",
  // Balanced starter cast: enough male and female voices (including young-sounding
  // options) to give every detected speaker their own persona.
  voiceList: ["Orus", "Kore", "Puck", "Sulafat", "Algenib", "Leda"],
  castMode: "cast",
  speakerVoices: {},
  dialect: "msa",
  targetLanguage: "ar",
  dubVolume: 100,
  // Keep cars, rooms, effects and music audible underneath the dub.
  originalVolume: 35,
  ducking: true,
  clarity: true,
  reduceDialogue: true,
  audioMode: "classic",
  separationModel: "mrx",
  dubEnabled: true,
  dialogueEnabled: false,
  effectsEnabled: true,
  musicEnabled: true,
  dialogueVolume: 80,
  effectsVolume: 100,
  musicVolume: 100,
  // One request per line gives the tightest millisecond placement.
  ttsMode: "precise",
};

export type CastEntry = {
  speaker: string;
  gender: Gender;
  age?: SpeakerAge;
  description: string;
  lines: number;
  seconds: number;
  voice: string;
  /** Presentation detail for the assigned voice card. */
  persona?: string;
  flag?: string;
  tint?: string;
  genderConfidence?: number;
  genderSource?: "script" | "audio" | "description";
};

export type DubCue = {
  /** Actual placement in the rendered Arabic track, in seconds (ms precision). */
  start: number;
  end: number;
  /** Original speech onset/offset detected in the source. */
  sourceStart: number;
  sourceEnd?: number;
  /** How far the new line was shifted from its source onset. */
  offsetMs?: number;
  speaker: string;
  voice: string;
  tempo: number;
};

export type JobResult = {
  language: string;
  languageCode: string;
  dialect: DialectId;
  lines: number;
  voicedLines: number;
  skippedLines: number;
  cast: CastEntry[];
  textModel: string | null;
  ttsModels: string[];
  videoCopied: boolean;
  durationSec: number;
  notes: string[];
  /** Whose API key did the work. */
  keySource?: "personal" | "server";
  /** Real utterance timings used by the cinema timeline. Optional for older runs. */
  cues?: DubCue[];
  separation?: { model: "mrx" | "tiger"; cached: boolean };
  targetLanguage?: "ar" | "en";
};

export type LogEntry = { t: number; msg: string; level: "info" | "warn" | "error" };

export type JobStatus = "queued" | "running" | "completed" | "failed" | "canceled";
export type VideoStatus = "uploading" | "importing" | "ready" | "failed";

export type VideoView = {
  id: string;
  source: "upload" | "youtube" | "link";
  sourceUrl: string | null;
  title: string;
  fileName: string;
  sizeBytes: number;
  receivedBytes: number;
  status: VideoStatus;
  progress: number;
  statusDetail: string | null;
  error: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioChannels: number | null;
  language: string | null;
  languageCode: string | null;
  createdAt: string;
};

export type JobView = {
  id: string;
  videoId: string;
  status: JobStatus;
  stage: string | null;
  stages: StageState[];
  settings: JobSettings;
  result: JobResult | null;
  logs: LogEntry[];
  error: string | null;
  outputSize: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type KeyCheckState = "ok" | "limited" | "failed";
export type KeyCheck = { state: KeyCheckState; detail: string };

/** Result of verifying an API key with real Google requests. */
export type KeyVerification = {
  auth: KeyCheck;
  text: KeyCheck;
  speech: KeyCheck;
  textModels: string[];
  ttsModels: string[];
  checkedAt: number;
};

/** What the browser may know about a stored personal key: never the key itself. */
export type PersonalKeyView = { hint: string; savedAt: string; verification: KeyVerification };

export type ServerStatus = {
  ai: {
    /** Which credentials this browser session is running on. */
    source: "personal" | "server" | "none";
    keyHint: string | null;
    configured: boolean;
    ok: boolean;
    error: string | null;
    textModels: string[];
    ttsModels: string[];
    exhausted: { model: string; until: number }[];
  };
  personalKey: PersonalKeyView | null;
  serverKeyAvailable: boolean;
  ffmpeg: { ok: boolean; version: string | null; error: string | null };
  youtube: { installed: boolean };
  limits: { chunkSize: number; maxUploadBytes: number };
};

export type YouTubeInfo = {
  id: string;
  url: string;
  title: string;
  uploader: string | null;
  durationSec: number | null;
  thumbnail: string | null;
  isLive: boolean;
};
