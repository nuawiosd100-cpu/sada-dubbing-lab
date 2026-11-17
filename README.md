# Sada Dubbing Lab — experimental cinema sync build

> Experimental copy of the classic engine. The original `ai-arabic-video-dubbing` repository
> and its deployed server are intentionally left untouched.

**What is different in the lab:** smart per-speaker casting with gender/age/persona matching
(including child and teen voices), millisecond picture-locked cue timing, a shorter video
preview docked on the right, and a balanced background mix that keeps cars, rooms, effects and
music audible under the Arabic voice.

Upload a video (or import one from YouTube), pick a voice and target language, and get
the same video back with a dubbed voice track. Arabic and English targets are supported,
so an Arabic video can become English and videos in other languages can become Arabic.
No accounts and no subtitles — dubbed audio only.

## How it works

| Stage | What really happens |
| --- | --- |
| Upload / YouTube / direct link | Resumable 4 MB chunk upload, `yt-dlp` download of publicly accessible YouTube videos (with a selectable 240p–1080p quality cap), or a direct http(s) link to a media file. No cookies, no DRM/restriction bypass. |
| Audio extraction | FFmpeg decodes the audio track and maps pauses (used for timing). |
| Language detection | A sample of the audio is sent to Gemini. |
| Transcription + translation | Gemini listens to ~4 minute parts and returns millisecond-timed utterances, speakers (gender, age band, persona description) and the selected Arabic or English script. |
| Dub voice generation | Gemini TTS prebuilt multilingual voices. Each speaker gets a distinct voice matched by gender, age and persona; every generated clip is cached on disk with its target language. Voice directions are kept in a separate section from the spoken transcript, so a voice starts in the target language from the very first word. |
| Final rendering | Clips are placed on the original millisecond onsets (only a 4 ms safety gap, sped up at most 1.5× when needed), mixed with the original track (balanced volume, soft auto-duck, centre-channel dialogue reduction) and muxed with the **untouched** video stream. |

Everything is cached per video, so re-dubbing with another voice or mix never re-uploads
or re-translates, and a run stopped by an API quota can be resumed.

## Cinematic three-stem audio mix

The Audio mix panel also has an **AI 3-stem cinema mix** mode. A local worker separates the
source soundtrack into real dialogue, sound-effects and music stems, then mixes those stems
with independent ON/OFF switches and volume controls. With Original dialogue OFF, its input
is not connected to the exported mix at all.

- **MRX** (`audiojs/mrx`, MIT weights): faster and suitable for longer videos.
- **TIGER-DnR** (`audiojs/tiger-dnr`, Apache-2.0 weights): slower on CPU, generally higher quality.
- Models are downloaded once into `.data/models`; separated FLAC stems are cached per video and model.
- `scripts/separate-audio.mjs` processes overlapping chunks in its own ONNX Runtime process,
  keeping memory bounded and reporting real inference progress. Cancellation stops the worker.
- No paid separation service is used. Both models return mono stems, which are remixed to stereo.
  Source separation is inherently scene-dependent; TIGER is preferable when speech leakage is the priority.

## API keys

The service can run on two kinds of credentials, and the interface always shows which one is active:

- **A visitor's personal key** — pasted into the "Google AI key" panel. Before it is activated it is
  verified with three real Google requests (authentication, one tiny text generation, one short Arabic
  speech generation). Once accepted it is stored AES-256-GCM encrypted in the database, tied to that
  browser only, used for every step of that browser's jobs, and never sent back to the page. It can be
  re-verified, replaced or removed at any time, and is deleted automatically after 30 days.
- **The server's built-in key** (`GEMINI_API_KEY`) — optional fallback for visitors who have not added
  their own. If it is not set, the site asks each visitor for a key.

## Configuration (server-side environment variables)

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string. |
| `GEMINI_API_KEY` | no | Built-in Google AI Studio key used when a visitor has not added a personal one. Read only on the server. |
| `KEY_ENCRYPTION_SECRET` | no | Secret used to encrypt stored personal keys. If unset, a random secret is created in `DATA_DIR/secret.key`. |
| `GEMINI_TEXT_MODELS`, `GEMINI_TTS_MODELS` | no | Comma-separated model preference lists (defaults are chosen from what the key can access). |
| `DATA_DIR` | no | Where videos and cached audio are stored (default `./.data`). Use a persistent disk. |
| `TTS_CONCURRENCY` | no | Parallel TTS requests (default 2; raise on a paid tier). |
| `RETENTION_HOURS` | no | Videos older than this are deleted automatically (default 72). |
| `MAX_UPLOAD_BYTES` | no | Upload / direct-link download size limit (default 50 GB). |
| `ALLOW_PRIVATE_LINKS` | no | Set to `1` to allow direct links pointing at localhost or private network addresses (blocked by default). |

## Gemini quota

The Gemini **free tier** allows only about 10 speech requests per day per TTS model and
20 requests per day per text model. That is enough for short clips (Economy mode voices
several lines per request and falls back across models), but movies and episodes need
billing enabled for the key's project in Google AI Studio. No other paid service is used.

## Running on your own server

Requirements: Node.js 22+, PostgreSQL, a persistent disk, outbound internet access.
FFmpeg comes from the `ffmpeg-static` package and `yt-dlp` is downloaded on first use.

```bash
npm install
npx drizzle-kit push      # create the tables
npm run build
npm run start             # one long-running Node process (jobs run in-process)
```

Use a host that runs a long-lived Node process with a disk (a VPS, Railway, Render, Fly.io…).
Serverless platforms that freeze between requests are not suitable for the background jobs.
