/**
 * Drizzle schema — typed source of truth for the IELTS data model (BRIEF §5).
 *
 * The hand-authored SQL in /migrations is the executable contract (with up/down
 * + RLS per §6.1); this file mirrors it for type-safe queries. Keep the two in
 * lockstep. See SCHEMA_NOTES.md for resolved ambiguities (notably: §5 `user` ->
 * `profile` keyed to auth.users.id, and the 13th table `notification` from §11).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Supabase-managed `auth.users` reference. Drizzle Kit knows NOT to emit a
// CREATE for it (it's external), so `npm run db:generate` won't try to recreate
// the auth schema. profile.id FKs to it (see SCHEMA_NOTES.md).
import { authUsers } from "drizzle-orm/supabase";

export { authUsers };

/* -------------------------------------------------------------------------- */
/* Enums (Postgres enums — BRIEF §4.1 / §4.2 / §5)                            */
/* -------------------------------------------------------------------------- */
export const regionLevel = pgEnum("region_level", [
  "country",
  "region",
  "district",
]);
export const authProvider = pgEnum("auth_provider", [
  "email",
  "apple",
  "facebook",
]);
export const userRole = pgEnum("user_role", ["student", "admin"]);
export const userTier = pgEnum("user_tier", ["basic", "premium", "ultra"]);
export const contentSection = pgEnum("content_section", [
  "reading",
  "listening",
]);
export const contentCategory = pgEnum("content_category", [
  "passage_1",
  "passage_2",
  "passage_3",
  "full_reading",
  "part_1",
  "part_2",
  "part_3",
  "part_4",
  "full_listening",
]);
export const bandType = pgEnum("band_type", [
  "reading_academic",
  "reading_general",
  "listening",
]);
export const contentStatus = pgEnum("content_status", ["draft", "published"]);
// Canonical question-type enum (BRIEF §4.2). `short_answer` added per §4.1
// (a real type omitted from the §4.2 list) — see SCHEMA_NOTES.md.
export const questionType = pgEnum("question_type", [
  "tfng",
  "ynng",
  "mcq_single",
  "mcq_multi",
  "matching_headings",
  "matching_info",
  "matching_features",
  "matching_sentence_endings",
  "sentence_completion",
  "summary_completion",
  "note_completion",
  "flowchart_completion",
  "table_completion",
  "diagram_label",
  "map_labelling",
  "form_completion",
  "short_answer",
]);
export const answerMode = pgEnum("answer_mode", [
  "mcq_set",
  "text_accept",
  "exact",
]);
export const attemptMode = pgEnum("attempt_mode", ["practice", "mock"]);
export const attemptStatus = pgEnum("attempt_status", [
  "in_progress",
  "submitted",
]);
export const referralStatus = pgEnum("referral_status", [
  "sent",
  "registered",
  "rewarded",
]);
export const leaderboardPeriod = pgEnum("leaderboard_period", [
  "weekly",
  "monthly",
  "all_time",
]);
export const topicSkill = pgEnum("topic_skill", ["writing", "speaking"]);
export const notificationType = pgEnum("notification_type", [
  "streak_reminder",
  "weekly_digest",
  "badge_unlocked",
  "system",
]);
export const paymentProvider = pgEnum("payment_provider", [
  "payme",
  "click",
  "uzum",
]);
export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "completed",
  "failed",
]);

/* -------------------------------------------------------------------------- */
/* region — hierarchical territory (country -> region/viloyat -> district)     */
/* -------------------------------------------------------------------------- */
export const region = pgTable("region", {
  id: uuid("id").defaultRandom().primaryKey(),
  parentId: uuid("parent_id").references((): any => region.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  level: regionLevel("level").notNull(),
});

/* -------------------------------------------------------------------------- */
/* profile — BRIEF §5 `user`, keyed 1:1 to auth.users.id (Supabase pattern)    */
/* -------------------------------------------------------------------------- */
export const profile = pgTable(
  "profile",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    email: text("email").notNull().unique(),
    authProvider: authProvider("auth_provider").notNull().default("email"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    regionId: uuid("region_id").references(() => region.id, {
      onDelete: "set null",
    }),
    role: userRole("role").notNull().default("student"),
    tier: userTier("tier").notNull().default("basic"),
    premiumUntil: timestamp("premium_until", { withTimezone: true }),
    rating: integer("rating").notNull().default(1000),
    peakRating: integer("peak_rating").notNull().default(1000),
    ratedCount: integer("rated_count").notNull().default(0),
    xp: integer("xp").notNull().default(0),
    currentStreak: integer("current_streak").notNull().default(0),
    longestStreak: integer("longest_streak").notNull().default(0),
    lastActivityDate: date("last_activity_date"),
    targetBand: numeric("target_band", { precision: 2, scale: 1 }),
    timezone: text("timezone").notNull().default("UTC"),
    referralCode: text("referral_code").notNull().unique(),
    referredBy: uuid("referred_by").references((): any => profile.id, {
      onDelete: "set null",
    }),
    hiddenFromLeaderboard: boolean("hidden_from_leaderboard")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Onboarding completion stamp (W1-2). NULL = the user has not finished the
    // post-signup onboarding (capture display_name/region/target_band); the
    // dashboard redirects them to /app/onboarding until it is set.
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  },
  (t) => [
    index("profile_region_id_idx").on(t.regionId),
    index("profile_rating_idx").on(t.rating),
  ],
);

/* -------------------------------------------------------------------------- */
/* content_item — test container (single passage/part OR Full of N sections)   */
/* -------------------------------------------------------------------------- */
export const contentItem = pgTable(
  "content_item",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    section: contentSection("section").notNull(),
    category: contentCategory("category").notNull(),
    title: text("title").notNull(),
    sourceFilePath: text("source_file_path"),
    durationSeconds: integer("duration_seconds"),
    tierRequired: userTier("tier_required").notNull().default("basic"),
    bandType: bandType("band_type").notNull(),
    questionTypes: text("question_types")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    bandScale: jsonb("band_scale"),
    status: contentStatus("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    // Elo difficulty rating of the test itself (BRIEF §4.6 anti-cheat / Elo).
    // Updated server-side after each rated attempt; count tracks rated attempts.
    difficultyRating: integer("difficulty_rating").notNull().default(1000),
    difficultyCount: integer("difficulty_count").notNull().default(0),
    createdBy: uuid("created_by").references(() => profile.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("content_item_section_category_idx").on(t.section, t.category),
    index("content_item_question_types_idx").using("gin", t.questionTypes),
  ],
);

/* -------------------------------------------------------------------------- */
/* passage — a section of a test (Reading passage / Listening part)            */
/* -------------------------------------------------------------------------- */
export const passage = pgTable(
  "passage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItem.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
    title: text("title"),
    bodyHtml: text("body_html").notNull(),
    audioPath: text("audio_path"),
  },
  (t) => [index("passage_content_item_id_idx").on(t.contentItemId)],
);

/* -------------------------------------------------------------------------- */
/* question                                                                    */
/* -------------------------------------------------------------------------- */
export const question = pgTable(
  "question",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItem.id, { onDelete: "cascade" }),
    passageId: uuid("passage_id")
      .notNull()
      .references(() => passage.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    qtype: questionType("qtype").notNull(),
    promptHtml: text("prompt_html").notNull(),
    options: jsonb("options"),
    groupKey: text("group_key"),
    evidenceRef: text("evidence_ref"),
    order: integer("order").notNull(),
  },
  (t) => [
    index("question_content_item_id_idx").on(t.contentItemId),
    index("question_passage_id_idx").on(t.passageId),
  ],
);

/* -------------------------------------------------------------------------- */
/* answer_key — SERVER ONLY. Locked to service-role via RLS (BRIEF §5, §6.1)   */
/* -------------------------------------------------------------------------- */
export const answerKey = pgTable("answer_key", {
  id: uuid("id").defaultRandom().primaryKey(),
  questionId: uuid("question_id")
    .notNull()
    .unique()
    .references(() => question.id, { onDelete: "cascade" }),
  mode: answerMode("mode").notNull(),
  accept: jsonb("accept").notNull(),
  explanation: text("explanation"),
  evidence: jsonb("evidence"),
});

/* -------------------------------------------------------------------------- */
/* attempt                                                                     */
/* -------------------------------------------------------------------------- */
export const attempt = pgTable(
  "attempt",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profile.id, { onDelete: "cascade" }),
    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItem.id, { onDelete: "cascade" }),
    mode: attemptMode("mode").notNull(),
    status: attemptStatus("status").notNull().default("in_progress"),
    answers: jsonb("answers").notNull().default(sql`'{}'::jsonb`),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    timeUsedSeconds: integer("time_used_seconds"),
    rawScore: integer("raw_score"),
    bandScore: numeric("band_score", { precision: 2, scale: 1 }),
    perTypeBreakdown: jsonb("per_type_breakdown"),
  },
  (t) => [
    // Partial over submitted: every hot attempt-by-user query filters
    // status='submitted' (computeStats, daily-limit, throttle, lists), and
    // in_progress rows are short-lived (migration 0008).
    index("attempt_user_submitted_idx")
      .on(t.userId, t.submittedAt)
      .where(sql`${t.status} = 'submitted'`),
    index("attempt_content_item_id_idx").on(t.contentItemId),
    // At most one in_progress attempt per (user, test) — DB-level guard behind
    // ensureAttempt's ON CONFLICT DO NOTHING (anti-cheat §4.6, migration 0007).
    uniqueIndex("attempt_one_in_progress_idx")
      .on(t.userId, t.contentItemId)
      .where(sql`${t.status} = 'in_progress'`),
  ],
);

/* -------------------------------------------------------------------------- */
/* badge / user_badge                                                          */
/* -------------------------------------------------------------------------- */
export const badge = pgTable("badge", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon"),
  criteria: jsonb("criteria"),
});

export const userBadge = pgTable(
  "user_badge",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profile.id, { onDelete: "cascade" }),
    badgeId: uuid("badge_id")
      .notNull()
      .references(() => badge.id, { onDelete: "cascade" }),
    earnedAt: timestamp("earned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.badgeId] })],
);

/* -------------------------------------------------------------------------- */
/* referral                                                                    */
/* -------------------------------------------------------------------------- */
export const referral = pgTable("referral", {
  id: uuid("id").defaultRandom().primaryKey(),
  inviterId: uuid("inviter_id")
    .notNull()
    .references(() => profile.id, { onDelete: "cascade" }),
  inviteeId: uuid("invitee_id").references(() => profile.id, {
    onDelete: "set null",
  }),
  code: text("code").notNull().unique(),
  status: referralStatus("status").notNull().default("sent"),
  reward: text("reward"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* leaderboard_entry — precomputed ranks (BRIEF §5, §6.1)                      */
/* scope = 'global' | <region_id as text> (see SCHEMA_NOTES.md)                */
/* -------------------------------------------------------------------------- */
export const leaderboardEntry = pgTable(
  "leaderboard_entry",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profile.id, { onDelete: "cascade" }),
    period: leaderboardPeriod("period").notNull(),
    scope: text("scope").notNull().default("global"),
    rating: integer("rating"),
    score: integer("score"),
    rank: integer("rank"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("leaderboard_entry_user_period_scope_key").on(
      t.userId,
      t.period,
      t.scope,
    ),
    index("leaderboard_entry_rank_idx").on(t.period, t.scope, t.rank),
  ],
);

/* -------------------------------------------------------------------------- */
/* annotation — reader highlights & notes (W2-1 / REDESIGN S6)                 */
/* offset-anchored within a passage's plain text; owner-path writes, own reads */
/* -------------------------------------------------------------------------- */
export const annotation = pgTable(
  "annotation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profile.id, { onDelete: "cascade" }),
    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItem.id, { onDelete: "cascade" }),
    passageOrder: integer("passage_order").notNull(),
    kind: text("kind").notNull().default("highlight"),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    quote: text("quote").notNull().default(""),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("annotation_user_content_idx").on(t.userId, t.contentItemId)],
);

/* -------------------------------------------------------------------------- */
/* topic — Writing/Speaking stub (Phase 3)                                     */
/* -------------------------------------------------------------------------- */
export const topic = pgTable("topic", {
  id: uuid("id").defaultRandom().primaryKey(),
  skill: topicSkill("skill").notNull(),
  prompt: text("prompt").notNull(),
  tierRequired: userTier("tier_required").notNull().default("basic"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* notification — reminders + weekly digest (BRIEF §11)                        */
/* -------------------------------------------------------------------------- */
export const notification = pgTable(
  "notification",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profile.id, { onDelete: "cascade" }),
    type: notificationType("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    data: jsonb("data"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notification_user_created_idx").on(t.userId, t.createdAt),
    // Unread badge count (AppShell) — partial keeps only the few unread rows
    // (migration 0008).
    index("notification_user_unread_idx")
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
  ],
);

/* -------------------------------------------------------------------------- */
/* payment — provider charges + subscription lifecycle (BRIEF §4.8 / §11)      */
/* 14th table (see SCHEMA_NOTES.md "Phase 2D"). Server-write only; owner-read.  */
/* -------------------------------------------------------------------------- */
export const payment = pgTable(
  "payment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profile.id, { onDelete: "cascade" }),
    provider: paymentProvider("provider").notNull(),
    providerTransactionId: text("provider_transaction_id").notNull(),
    // Purchased tier (premium|ultra). Reuses the userTier enum.
    tier: userTier("tier").notNull(),
    periodMonths: integer("period_months").notNull(),
    amount: integer("amount").notNull(), // minor units (tiyin)
    currency: text("currency").notNull().default("UZS"),
    status: paymentStatus("status").notNull().default("pending"),
    appliedUntil: timestamp("applied_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Idempotency key: one row per provider charge (webhook upserts on it).
    unique("payment_provider_tx_key").on(t.provider, t.providerTransactionId),
    index("payment_user_created_idx").on(t.userId, t.createdAt),
  ],
);
