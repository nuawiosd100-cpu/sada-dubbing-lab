import type { DialectId, SpeakerAge } from "./types";

export type Voice = {
  /** Stable selection number shown in the interface (1–27). */
  number: number;
  /** Gemini prebuilt voice name (sent to the TTS API as-is). */
  id: string;
  gender: "male" | "female";
  style: string;
  blurb: string;
};

// Gemini's multilingual prebuilt studio voices. The three voices the owner removed
// (Charon, Algieba and Iapetus) stay removed. Numbers are stable selection shortcuts.
export const VOICES: Voice[] = [
  { number: 1, id: "Orus", gender: "male", style: "Firm", blurb: "Confident, authoritative" },
  { number: 2, id: "Puck", gender: "male", style: "Upbeat", blurb: "Bright, younger energy" },
  { number: 3, id: "Fenrir", gender: "male", style: "Excitable", blurb: "Animated, dramatic" },
  { number: 4, id: "Enceladus", gender: "male", style: "Breathy", blurb: "Soft, close and expressive" },
  { number: 5, id: "Umbriel", gender: "male", style: "Easy-going", blurb: "Relaxed, natural delivery" },
  { number: 6, id: "Algenib", gender: "male", style: "Gravelly", blurb: "Rough, textured character" },
  { number: 7, id: "Rasalgethi", gender: "male", style: "Informative", blurb: "Clear documentary narrator" },
  { number: 8, id: "Alnilam", gender: "male", style: "Firm", blurb: "Strong, direct presenter" },
  { number: 9, id: "Schedar", gender: "male", style: "Even", blurb: "Balanced, steady narration" },
  { number: 10, id: "Zubenelgenubi", gender: "male", style: "Casual", blurb: "Informal, everyday speech" },
  { number: 11, id: "Sadaltager", gender: "male", style: "Knowledgeable", blurb: "Assured explainer and guide" },
  { number: 12, id: "Achird", gender: "male", style: "Friendly", blurb: "Warm, approachable" },
  { number: 13, id: "Sadachbia", gender: "male", style: "Lively", blurb: "Playful, animated character" },
  { number: 14, id: "Kore", gender: "female", style: "Firm", blurb: "Clear, assured presenter" },
  { number: 15, id: "Sulafat", gender: "female", style: "Warm", blurb: "Soft, reassuring" },
  { number: 16, id: "Aoede", gender: "female", style: "Breezy", blurb: "Light, conversational" },
  { number: 17, id: "Leda", gender: "female", style: "Youthful", blurb: "Young, lively tone" },
  { number: 18, id: "Achernar", gender: "female", style: "Soft", blurb: "Gentle, intimate" },
  { number: 19, id: "Gacrux", gender: "female", style: "Mature", blurb: "Seasoned, grounded" },
  { number: 20, id: "Zephyr", gender: "female", style: "Bright", blurb: "Cheerful, clear and open" },
  { number: 21, id: "Callirrhoe", gender: "female", style: "Easy-going", blurb: "Laid-back, friendly" },
  { number: 22, id: "Autonoe", gender: "female", style: "Bright", blurb: "Fresh, upbeat delivery" },
  { number: 23, id: "Despina", gender: "female", style: "Smooth", blurb: "Polished, flowing narration" },
  { number: 24, id: "Erinome", gender: "female", style: "Clear", blurb: "Precise, articulate speech" },
  { number: 25, id: "Laomedeia", gender: "female", style: "Upbeat", blurb: "Energetic and engaging" },
  { number: 26, id: "Pulcherrima", gender: "female", style: "Forward", blurb: "Bold, expressive performance" },
  { number: 27, id: "Vindemiatrix", gender: "female", style: "Gentle", blurb: "Calm, tender delivery" },
];

export type VoiceCharacter = {
  /** Flag used as the avatar in the voice cards. */
  flag: string;
  /** Short character label shown under the voice name. */
  persona: string;
  age: Exclude<SpeakerAge, "unknown">;
  /** Words in a detected speaker description that make this voice a better fit. */
  keywords: string[];
  /** Card tint. */
  tint: string;
};

// Presentation metadata used by the lab UI and the smart-casting scorer. The flag is a
// character accent, not a claim about the actor's nationality.
const CHARACTERS: Record<string, VoiceCharacter> = {
  Orus: { flag: "🇪🇬", persona: "Authoritative lead", age: "adult", keywords: ["lead", "narrator", "presenter", "anchor", "serious", "firm"], tint: "#ffbf47" },
  Puck: { flag: "🇱🇧", persona: "Bright young energy", age: "young", keywords: ["boy", "teen", "young", "child", "lively", "playful"], tint: "#57d8c4" },
  Fenrir: { flag: "🇸🇦", persona: "Dramatic hero", age: "adult", keywords: ["hero", "dramatic", "excited", "angry", "action", "shout"], tint: "#ff7a70" },
  Enceladus: { flag: "🇲🇦", persona: "Close & emotional", age: "adult", keywords: ["soft", "intimate", "emotional", "whisper", "tender"], tint: "#a995ff" },
  Umbriel: { flag: "🇹🇳", persona: "Relaxed storyteller", age: "adult", keywords: ["relaxed", "casual", "easy", "friend", "guide"], tint: "#70a7ff" },
  Algenib: { flag: "🇮🇶", persona: "Rough character", age: "mature", keywords: ["rough", "gravel", "villain", "older", "grizzled", "deep"], tint: "#f39bd4" },
  Rasalgethi: { flag: "🇪🇬", persona: "Documentary voice", age: "mature", keywords: ["documentary", "narrator", "informative", "elder", "wise"], tint: "#ffbf47" },
  Alnilam: { flag: "🇸🇦", persona: "Strong presenter", age: "adult", keywords: ["strong", "direct", "formal", "announcer", "presenter"], tint: "#57d8c4" },
  Schedar: { flag: "🇯🇴", persona: "Steady narrator", age: "adult", keywords: ["steady", "balanced", "calm", "narrator", "even"], tint: "#70a7ff" },
  Zubenelgenubi: { flag: "🇸🇾", persona: "Everyday neighbour", age: "adult", keywords: ["casual", "neighbour", "ordinary", "informal", "man"], tint: "#a995ff" },
  Sadaltager: { flag: "🇦🇪", persona: "Confident explainer", age: "adult", keywords: ["explainer", "teacher", "knowledgeable", "guide", "expert"], tint: "#f39bd4" },
  Achird: { flag: "🇪🇬", persona: "Warm approachable", age: "adult", keywords: ["friendly", "warm", "kind", "father", "neighbour"], tint: "#ff7a70" },
  Sadachbia: { flag: "🇱🇧", persona: "Playful teen", age: "young", keywords: ["teen", "young", "boy", "playful", "comic", "kid"], tint: "#ffbf47" },
  Kore: { flag: "🇪🇬", persona: "Assured presenter", age: "adult", keywords: ["presenter", "anchor", "news", "firm", "lead", "narrator"], tint: "#ff7a70" },
  Sulafat: { flag: "🇱🇧", persona: "Warm & reassuring", age: "adult", keywords: ["mother", "warm", "gentle", "soft", "narrator", "woman"], tint: "#57d8c4" },
  Aoede: { flag: "🇲🇦", persona: "Light conversational", age: "young", keywords: ["young", "breezy", "conversation", "girl", "casual"], tint: "#a995ff" },
  Leda: { flag: "🇪🇬", persona: "Young heroine", age: "child", keywords: ["child", "kid", "girl", "school", "young", "daughter", "teen"], tint: "#f39bd4" },
  Achernar: { flag: "🇹🇳", persona: "Gentle & intimate", age: "adult", keywords: ["gentle", "soft", "intimate", "quiet", "tender"], tint: "#70a7ff" },
  Gacrux: { flag: "🇮🇶", persona: "Seasoned woman", age: "mature", keywords: ["older", "mature", "mother", "grandmother", "experienced", "wise"], tint: "#ffbf47" },
  Zephyr: { flag: "🇦🇪", persona: "Bright & open", age: "young", keywords: ["bright", "cheerful", "young", "girl", "fresh"], tint: "#57d8c4" },
  Callirrhoe: { flag: "🇸🇾", persona: "Laid-back friend", age: "adult", keywords: ["friend", "relaxed", "easy", "girl", "woman"], tint: "#a995ff" },
  Autonoe: { flag: "🇯🇴", persona: "Fresh upbeat", age: "young", keywords: ["young", "teen", "girl", "fresh", "upbeat", "student"], tint: "#ff7a70" },
  Despina: { flag: "🇪🇬", persona: "Polished narrator", age: "adult", keywords: ["narrator", "polished", "smooth", "documentary", "presenter"], tint: "#70a7ff" },
  Erinome: { flag: "🇸🇦", persona: "Clear announcer", age: "adult", keywords: ["announcer", "clear", "precise", "news", "presenter"], tint: "#f39bd4" },
  Laomedeia: { flag: "🇱🇧", persona: "Energetic teen", age: "young", keywords: ["teen", "young", "girl", "energetic", "student", "kid"], tint: "#ffbf47" },
  Pulcherrima: { flag: "🇲🇦", persona: "Bold performer", age: "adult", keywords: ["bold", "strong", "dramatic", "actress", "expressive"], tint: "#57d8c4" },
  Vindemiatrix: { flag: "🇹🇳", persona: "Calm grandmother", age: "mature", keywords: ["grandmother", "calm", "gentle", "older", "tender", "wise"], tint: "#a995ff" },
};

const FALLBACK_CHARACTER: VoiceCharacter = {
  flag: "🎙️",
  persona: "Studio voice",
  age: "adult",
  keywords: [],
  tint: "#ffbf47",
};

export const voiceCharacter = (id: string): VoiceCharacter => CHARACTERS[id] ?? FALLBACK_CHARACTER;

export const voiceById = (id: string): Voice | undefined => VOICES.find((v) => v.id.toLowerCase() === id.toLowerCase());
export const voiceByNumber = (n: number): Voice | undefined => VOICES.find((v) => v.number === n);
export const voiceNumber = (id: string): number => voiceById(id)?.number ?? 0;

/** Accept a voice name or its visible selection number (including "07"). */
export function resolveVoice(value: unknown): Voice | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return voiceByNumber(value);
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (/^\d{1,2}$/.test(text)) return voiceByNumber(Number(text));
  return voiceById(text);
}

export const DIALECTS: { id: DialectId; label: string; prompt: string }[] = [
  { id: "msa", label: "Modern Standard Arabic (Fusha)", prompt: "Modern Standard Arabic (العربية الفصحى)" },
  { id: "egyptian", label: "Egyptian Arabic", prompt: "Egyptian colloquial Arabic (اللهجة المصرية)" },
  { id: "levantine", label: "Levantine Arabic", prompt: "Levantine colloquial Arabic (اللهجة الشامية)" },
  { id: "gulf", label: "Gulf Arabic", prompt: "Gulf colloquial Arabic (اللهجة الخليجية)" },
];

export const dialectById = (id: string) => DIALECTS.find((d) => d.id === id) ?? DIALECTS[0];

export const PREVIEW_TEXT = "مرحباً، أنا صوتك العربي. هكذا سيبدو صوتي في الفيديو المدبلج.";
export const PREVIEW_TEXT_EN = "Hello, this is your English voice. This is how I will sound in your dubbed video.";
