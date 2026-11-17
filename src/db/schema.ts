import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  JobResult,
  JobSettings,
  KeyVerification,
  LogEntry,
  Segment,
  Speaker,
  StageState,
} from "../lib/types";

// A source video: either uploaded from the computer or imported from YouTube.
export const videos = pgTable(
  "videos",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    source: text("source").notNull(), // upload | youtube | link
    sourceUrl: text("source_url"),
    title: text("title").notNull(),
    fileName: text("file_name").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    receivedBytes: bigint("received_bytes", { mode: "number" }).notNull().default(0),
    status: text("status").notNull(), // uploading | importing | ready | failed
    progress: doublePrecision("progress").notNull().default(0),
    statusDetail: text("status_detail"),
    error: text("error"),
    durationSec: doublePrecision("duration_sec"),
    width: integer("width"),
    height: integer("height"),
    videoCodec: text("video_codec"),
    audioCodec: text("audio_codec"),
    audioChannels: integer("audio_channels"),
    language: text("language"),
    languageCode: text("language_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("videos_session_idx").on(t.sessionId)],
);

// Cached transcript + Arabic translation, so re-dubbing never repeats this work.
export const transcripts = pgTable(
  "transcripts",
  {
    id: text("id").primaryKey(),
    videoId: text("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    dialect: text("dialect").notNull(),
    model: text("model"),
    segments: jsonb("segments").$type<Segment[]>().notNull(),
    speakers: jsonb("speakers").$type<Speaker[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("transcripts_video_dialect_idx").on(t.videoId, t.dialect)],
);

// A visitor's personal Google AI Studio key, AES-256-GCM encrypted, tied to one browser session.
export const apiKeys = pgTable("api_keys", {
  sessionId: text("session_id").primaryKey(),
  cipher: text("cipher").notNull(),
  hint: text("hint").notNull(),
  verification: jsonb("verification").$type<KeyVerification>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
});

// One dubbing run of a video with a specific voice / mix configuration.
export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    videoId: text("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    status: text("status").notNull(), // queued | running | completed | failed | canceled
    stage: text("stage"),
    stages: jsonb("stages").$type<StageState[]>().notNull(),
    settings: jsonb("settings").$type<JobSettings>().notNull(),
    result: jsonb("result").$type<JobResult>(),
    logs: jsonb("logs").$type<LogEntry[]>().notNull(),
    error: text("error"),
    outputSize: bigint("output_size", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("jobs_session_idx").on(t.sessionId), index("jobs_video_idx").on(t.videoId)],
);
