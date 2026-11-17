import type { DialectId } from "./types";

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
