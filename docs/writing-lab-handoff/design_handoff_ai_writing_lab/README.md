# Handoff: AI Writing Lab (IELTS Writing Task 2)

## Overview
AI Writing Lab is a practice mode inside the existing **bando** IELTS platform. A student picks a Task 2 essay prompt, writes a response, and an AI coach returns an **estimated band range** (e.g. 6.0–6.5) with a concrete improvement plan. The value is the plan, not a verdict — the product tone is a **supportive coach, never an examiner**. Anywhere a band is shown, the disclaimer **"estimated band range — not an official IELTS score"** must appear.

This package covers every screen and state: catalog, attempt, async analysis (queue/analyzing), feedback, history, error, the access-gating states (Ultra-only with one free lifetime preview, daily limit, coming soon), and the admin create-topic form.

## About the Design Files
The file in this bundle (`AI Writing Lab.dc.html`) is a **design reference created in HTML** — a prototype showing the intended look and behavior, **not production code to copy directly**. It is authored as a "Design Component" (a single-file HTML prototype with an inline JS logic class); the markup uses inline styles and a small template runtime that are specific to the prototyping environment.

Your task is to **recreate these designs in the bando codebase** (`RiobVO/IELTS`, Next.js App Router + React) using its established patterns, components, and design tokens — not to ship the HTML. The prototype already composes the bando design-system components (Button, Card, Tabs, ExamTimer, etc.); use the real ones from the repo. Where the prototype hand-rolled an element (the band-scale plot, the word-count ring, the inline annotation highlighter), reproduce it with the codebase's primitives.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, layout, motion, and interaction states are all intended as shown. Recreate pixel-faithfully using bando's existing CSS custom properties (tokens) and components. All colors below are referenced as bando tokens (CSS variables) — use those variables, do not hardcode hex. The token definitions live in the design system under `tokens/colors.css`, `tokens/typography.css`, etc.

---

## Global Shell
- **Top nav bar** (height 64px, `--surface` bg, `--border` bottom): bando logo + wordmark (the "o" in `--brand`); nav items **Home / Practice / League / Badges** (Practice active: `--text-link` on `--brand-subtle` pill); right side: **Upgrade** button (outline, bar-chart icon), bell icon, streak flame `--streak` "2", trophy `--warn-text` "30", avatar circle (`--violet-200`/`--violet-700`), logout icon.
- **Content area** scrolls; each screen is centered with a max-width and generous padding (40px horizontal).
- The prototype also has a **left dark rail** (`--slate-950`) labeled "PROTOTYPE · JUMP TO ANY SCREEN" — this is a **demo-only screen switcher and must NOT be built** in production. Screens are reached through real navigation (catalog → attempt → analysis → feedback; history; etc.).

## Typography (bando tokens)
- `--font-ui` = **Plus Jakarta Sans** — all UI chrome, headings, labels.
- `--font-reading` = **Literata** (serif) — the essay text, criterion names, rewrite paragraphs, annotation quotes.
- `--font-mono` = **JetBrains Mono** — all numerals: band scores, word count, timers, ranks, axis labels.
- Casing: **sentence case** everywhere except tiny tracked overlines (e.g. `ESTIMATED BAND`, `STRENGTH`) which are UPPERCASE mono/ui at ~10–11px, `letter-spacing: 0.04–0.09em`, color `--text-muted`.

## Motion
One easing system: `--ease-standard` (UI), `--ease-out` (reveals), `--ease-spring` (celebratory pops). All content reveals end on the visible state and must respect `prefers-reduced-motion`. Keyframes used in the prototype:
- `wl-up` — content blocks rise 9px into place (`.5s --ease-out`).
- `wl-grow` — bars/segments scale in from the left.
- band count-up: on entering Feedback, the big band number animates from (target − 0.8) up to the low band value over ~950ms (cubic ease-out), honoring reduced-motion (snap to final).
- `wl-ring` — a brand-colored ring pulse on the active annotation card.
- spinner / sheen / levitate / pulse — loaders only (see Analyzing).
- Tactile press (bando signature): interactive cards/buttons translate up 2px on hover, down 1px on `:active`.

---

## Screens / Views

### 1. Topic catalog
**Purpose:** browse Task 2 prompts and start an attempt.
**Layout:** centered, max-width 1080px. Top zone is a 2-col grid (`1fr 336px`):
- **Left hero:** overline "WRITING LAB" (mono, `--text-link`, dot bullet); H1 "Pick a prompt." (42px/800, `-0.03em`, period in `--brand`); subtitle (`--text-secondary`, 16px). Below: a **Target widget** (pill row, `--surface`, `--shadow-solid`): label "Target" + mono "7.0" + an 8px progress rail (88% filled, `--brand`) + "best 6.5 · +0.5 to go"; and a **"Drill weakest: Task Response"** chip (`--brand-subtle` bg, `--brand-border`, bar-chart icon) linking to feedback/practice for that type.
- **Right "Continue your draft" card:** `--brand` solid bg, white text, `--shadow-solid-lg`, tactile press. Shows draft title, "Task 2 · 214 words · not submitted", a white progress bar (62%), and a white "Resume writing →" pill. Faint decorative bars bottom-right (16% opacity).

Then a filter row: **segmented control Academic / General** (inset track `--surface-inset`, active segment = `--surface` + `--shadow-solid`), a search field (icon + input, `--surface-raised`, `--border` 2px), and type-filter **chips** (selected = `--brand` bg / white; unselected = `--surface` / `--border`, with a mono count). Right caption: "{n} prompts · ~250 words · 40 min".

**Prompt list:** vertical stack of full-width **Card** rows (interactive, `--shadow-solid`). Each row: a 46px rounded `--brand-subtle` icon tile (pencil/edit icon, `--text-link`); a middle block with mono overline "TASK 2 · {type}" and the prompt (15.5px/600, clamped 2 lines, `--font-ui`); right: "~250 words" + "Write →" (`--text-link`/700). Click → Attempt screen with that prompt.

### 2. Attempt
**Purpose:** write the essay; live word count; optional timer; submit.
**Layout:** max-width 1080px. "← Back to catalog" text button. Main is a 2-col grid (`320px 1fr`, `align-items: stretch`):
- **Left rail (3 stacked cards):**
  1. Prompt card (`--brand-subtle`/`--brand-border`): overline "Task 2 · Academic", the prompt (16px/500), helper "Write at least 250 words…".
  2. Target card (`--surface`/`--shadow-solid`): "Aiming for" + mono "7.0", an 8px rail (88%, `--brand`), "Best so far 6.5 · +0.5 to go".
  3. **Structure guide** (`--surface`, fills remaining height): overline "A solid Task 2 shape"; 4 numbered steps with a connector line — Introduction / Body 1 / Body 2 / Conclusion, each with a one-line coach hint. Number badges: 26px `--brand-subtle` circle, mono `--text-link`.
- **Right column:** header row "Your essay" (18px/700) + timer control. Timer OFF = pill button "Start 40-min timer" (clock icon, `--surface`/`--border`); timer ON = the bando **ExamTimer** component (compact). Below: a **textarea** that flexes to fill (`min-height: 470px`), `--reading-surface` bg, `--reading-text`, `--font-reading` 17px/1.7, `--border` 2px, radius 18, `--shadow-solid`.

**Bottom action bar** (full width below grid, `--surface`/`--border`/`--shadow-solid`, radius 18):
- Left: **word-count ring** — a 62px SVG circle (r=44, stroke 9), track `--surface-inset`, progress stroke colored by state, fill % = `min(words/250,1)`; mono word count centered. Beside it: status message (700, state color) + "words · min 20 · max 1000".
- Right: bando **Button** primary lg "Get my feedback" (arrow-right trailing icon), **disabled** when `words < 20 || words > 1000`; under it the disclaimer line (`--text-muted`).

### 3. In queue (async state 1)
Centered (max-width 560px). Three pulsing `--brand` dots in a `--surface-hover` circle; H1 "You're in the queue"; "2 essays ahead of you · est. wait ~40s" (mono); a 3-step status list card (Queued = active brand ring; Analyzing / Building = muted). Footer: "You can leave this page — we'll keep your spot. Only one analysis runs at a time."

### 4. Analyzing (async state 2)
Centered. **Living-logo loader**: three stacked rounded bars (`--brand`, `--violet-300`, `--violet-200`) that levitate (`wl-levitate 3s` infinite); a white sheen sweeps the top bar (`wl-sheen`). H1 "Analyzing your essay…"; "Usually 10–40 seconds" (mono); an indeterminate progress rail (`wl-bar` infinite, `--brand`); the 3-step status list with **Queued = done** (`--success` check), **Analyzing = active**, Building = muted.

> **Behavior:** these two are real async polling states (seconds → tens of seconds). The prototype auto-advances queue → analyzing (~2.4s) → feedback (~6.4s) to demo the flow. In production, poll the analysis job status until ready. **Only one active analysis per user** — block starting a second while one is running.

### 5. Feedback (the main screen)
**Purpose:** show exactly the engine's output (do not add fields). Max-width 980px.

- **Header:** overline "Feedback · Task 2"; H1 "Nice work finishing — here's where to focus next"; right "View in history" pill.
- **Hero (2-col grid `330px 1fr`, one rounded `--brand-border` panel, `--shadow-solid-lg`):**
  - Left (`--brand-subtle`): overline "ESTIMATED BAND" (mono `--text-link`); huge band number — low value 60px/800 mono + "–high" 30px/700 `--text-secondary` (**count-up animation** on enter); a **confidence meter** = 3 pills (filled count by level: low=1/med=2/high=3, `--brand` vs `--brand-border`) + capitalized level word; and the disclaimer "A coaching estimate to guide practice — **not an official IELTS score.**"
  - Right (`--surface`, 4px `--error` left border): "BIGGEST BLOCKER" badge (`--error-subtle`/`--error-text`) + the blocker criterion name (serif); the blocker note (16px); "Fix this one first — it moves your band the most." (`--text-link`/600).
- **Top 3 fixes:** 3-col grid of `--surface` cards, each a 28px `--brand` numbered circle (mono, `--text-on-brand`) + the fix text. Exactly three, in priority order.
- **The four IELTS criteria — "estimate plot" (one unified panel):** header "The four IELTS criteria" + "Weakest first". The panel (`--surface`, radius 20, `--shadow-solid`) has:
  - A header strip (`--surface-inset`, grid `1fr 240px`): left "CRITERION · ESTIMATED RANGE"; right an **axis region** with faint mono tick labels 5 / 6 / 8 / 9 and a **"TARGET 7.0"** marker (`--text-link`) at 60%.
  - One **row per criterion** (grid `1fr 240px`, divided by `--border-subtle`; the blocker row gets a subtle `--surface-inset` highlight). Left: rank badge (24px `--surface-inset`, mono) + criterion name (serif 17/600) + optional "FIX FIRST" badge (triangle icon, `--error-subtle`) + band range (mono 15/800, right-aligned); below (indented 35px) three label/value lines — **STRENGTH** (`--text-disabled` label), **WATCH** (`--text-disabled`), **NEXT** (`--text-link` label, value `--text-primary`/500).
  - Right cell = the **interval marker on a shared 4.0–9.0 axis**: a `--surface-inset` rail (10px); the band range drawn as a **`--slate-700` segment** from `low` to `high` with `--shadow-solid` and **two ring endpoints** (13px circles, `--surface` fill, 3px `--slate-700` border) at each end; a **dashed vertical target line** (`--brand-border`) at 60% spanning the row; and a "+X to 7.0" gap caption top-right. Axis position = `(band − 4) / 5 × 100%`.

  > Render the criteria **weakest first** (sort ascending by band midpoint). Each row's segment + endpoints visually reads as a confidence-interval marker (NOT an interactive slider).

- **Notes on your text (inline annotations):** "Notes on your text" + helper + a **legend** (Good move = `--success`, Style & clarity = `--warn`, Grammar = `--error`). 2-col grid (`1.45fr 1fr`):
  - Left (`--reading-surface`, serif 16/1.95): the **essay rendered with the student's text**, with annotated phrases wrapped in `<mark>` — soft tint bg by type (`--success-subtle` / `--warn-subtle` / `--error-subtle`) + a 2px colored bottom border (the type accent). Clicking a highlight activates it (adds a `0 0 0 2px {accent}` ring) and the matching comment card.
  - Right: a stack of **comment cards**, one per annotation: 1px border + 3px colored left accent (type), a type label (GOOD MOVE / STYLE / GRAMMAR in the type's text color), the quoted phrase (serif italic, ellipsized), and the comment. Active card gets the type's subtle bg + `wl-ring` pulse. Highlights and cards are bidirectionally linked by index.
- **A partial rewrite to learn from:** three cards — (1) **Stronger thesis**: "YOURS" (struck-through, `--error` strike) vs "STRONGER" (in a `--brand-subtle` block, serif); (2) **One rewritten paragraph** (`--reading-surface`, serif); (3) **Swap these weak phrases**: inline chips `from → to` (`--surface-inset`, struck `--text-muted` → `--success-text`/600). Never rewrite the whole essay.
- **Before your next attempt (checklist):** a `--surface` card; each item is a toggle button — 24px checkbox (unchecked `--border-strong`; checked `--brand` fill + white ✓) + the item text. Local UI state only.
- **Footer action bar:** Button primary "Try again" (→ Attempt) + secondary "Pick a new topic" (→ Catalog) + note "This feedback is saved as a snapshot — reopen it any time and it won't change."

### 6. Attempt history
Max-width 880px. H1 "Attempt history" + "Every analysis is saved as a snapshot… it never re-scores." Stack of clickable rows (`--surface`/`--shadow-solid`, grid `1fr auto`): left = category chip + mono date + optional "LATEST" badge (`--success-subtle`) + clamped prompt; right = mono band + "{confidence} confidence" + "→". Click → that result.

> **Behavior — stable snapshots:** each result is frozen at analysis time. Reopening it tomorrow shows the identical breakdown; it is **never recomputed**. Persist the full feedback payload per attempt.

### 7. Analysis failed (error state)
Centered. `--error-subtle` circle with an X-circle icon (spring pop); H1 "We couldn't finish your analysis"; body: "Something went wrong on our side — not yours. Your essay is safe… this attempt was **not** counted against your limit." Buttons: primary "Try analysis again" (re-submit) + secondary "Back to my essay". Calm, coach tone, always a next step.

### 8. Preview used (gating — non-Ultra after the 1 free analysis)
Centered. `--brand-subtle` circle (sparkle icon, spring pop); H1 "That was your free analysis — nice start"; body explains the one free lifetime breakdown is used and is still saved. A `--surface`/`--brand-border` card "With Ultra you get" (3 green-check perks). Buttons: primary "Upgrade to Ultra" (→) + ghost "Reread my feedback". Never a dead end.

### 9. Daily limit (gating — Ultra)
Centered. `--warn-subtle` circle (clock icon); H1 "You've hit today's analysis limit"; body about the generous daily allowance; a mono "Resets in 07:20:14" pill; buttons primary "Review last feedback" + secondary "Open history".

### 10. Coming soon (feature disabled)
This reuses bando's real "Practice library" look: max-width 1080px, overline "PRACTICE LIBRARY", a 4-col grid of section cards **R / L / W / S** (Reading/Listening = "Live" `--success`; Writing = highlighted `--gold-200`/`--warn` "Soon"; Speaking = "Soon"). Below, a large `--surface` panel (grid `170px 1fr`): a levitating gold living-logo, "Coming soon" badge, H1 "Writing is on the way", description, feature chips, and buttons "Explore Ultra" (primary) + "Notify me at launch" (secondary) + "Back to live tests" (text). A disabled "Start an essay" affordance with "Disabled until the feature is enabled for you."

### 11. Admin — create topic
Max-width 700px. H1 "New Task 2 topic" + "DRAFT" badge; helper "Students see this topic in the catalog only after you publish it." Form card (`--surface`/`--shadow-solid`): **Prompt** textarea; a 2-col grid with **Category** select (Academic / General) and **Required plan** select (Basic / Premium / Ultra). Actions: primary "Publish topic" (check icon) + secondary "Save draft" + caption "Draft → Published". A topic is only visible to students after **publish**.

---

## Interactions & Behavior
- **Navigation flow:** catalog → (click prompt) → attempt → (Get my feedback) → in queue → analyzing → feedback. Feedback "Try again" → attempt; "Pick a new topic" → catalog.
- **Word count gating:** count = whitespace-split tokens; submit disabled outside [20, 1000]; ring fill = `min(count/250, 1)`; status + colors change across empty / too-few / ok / too-many.
- **Timer:** optional, toggled on the attempt screen; uses the real ExamTimer (40 min). Off by default.
- **Single active analysis:** disallow a second submission while one is queued/analyzing.
- **Async polling:** show queue then analyzing; poll until the job completes or fails; on failure show screen 7 (and don't consume the user's quota).
- **Annotations:** clicking a highlight or its comment card sets the active note (bidirectional), applies a ring + pulse.
- **Checklist:** purely local toggle state on the feedback screen.
- **Snapshots:** results are immutable once produced.
- **Reduced motion:** all reveals/count-up/pulses must no-op or snap to final under `prefers-reduced-motion`.

## State Management
- `currentScreen` / route, `selectedTopic`, `essayText`, `timerOn`, `wordCount` (derived).
- `analysisJob`: `{ status: 'queued' | 'analyzing' | 'done' | 'failed', id }` (polled).
- `feedback` payload (immutable snapshot, see contract below); `activeNote` (annotation index); `checklistChecks` (local).
- Access: `tier` (Basic/Premium/Ultra), `freePreviewUsed` (lifetime, non-Ultra), `dailyAnalysesRemaining` (Ultra), `featureEnabled` (coming-soon gate).
- Admin: `{ prompt, category, requiredPlan, status: 'draft' | 'published' }`.

## Feedback contract (exactly these fields — do not add)
```
bandRange: { low, high }, confidence: 'low' | 'medium' | 'high'
biggestBlocker: { criterion, note }
criteria[4]: { name, range: {low,high}, strength, issue, nextStep, isBlocker }
   names: Task Response · Coherence and Cohesion · Lexical Resource · Grammatical Range and Accuracy
top3Fixes: [string, string, string]   // exactly three, priority order
annotations[]: { quote, comment, type: 'good' | 'style' | 'grammar' }  // tied to essay substrings
partialRewrite: { thesisOld, thesisNew, paragraph, replacements: [{from, to}] }  // NOT the whole essay
nextAttemptChecklist: [string, …]
```

## Design Tokens (use bando CSS variables, not hex)
- **Brand/accent:** `--brand`, `--brand-subtle`, `--brand-border`, `--text-link`, `--text-on-brand`, `--violet-200/300/400/700`, `--slate-300/400/700/950`.
- **Semantic:** `--success`/`--success-text`/`--success-subtle`/`--success-border`, `--warn`/`--warn-text`/`--warn-subtle`/`--warn-border`, `--error`/`--error-text`/`--error-subtle`/`--error-border`, `--streak`, `--gold-200/500/600`, `--sky-200/500`, `--green-200`.
- **Surfaces/text:** `--bg-base`, `--surface`, `--surface-raised`, `--surface-hover`, `--surface-inset`, `--reading-surface`, `--reading-rule`, `--reading-text`, `--reading-mark`, `--reading-muted`, `--border`, `--border-subtle`, `--border-strong`, `--text-primary`, `--text-secondary`, `--text-muted`, `--text-disabled`.
- **Radii:** inputs/buttons 14px, cards 16–18px, panels 20–24px, chips/pills full (999px).
- **Elevation:** `--shadow-solid`, `--shadow-solid-lg` (hard solid bottom edge — bando's tactile shadow, not a blurry drop shadow).
- **Type scale:** H1 22–42px, section H2 16px, body 13.5–17px, overlines 10–11px; line-height 1.6+ for reading.

## Assets
- **Logo:** `assets/bando-mark.svg` (three stacked rounded bars, violet top bar). The prototype inlines a copy; use the repo asset.
- **Icons:** Lucide (24×24, ~2–2.5px stroke, `currentColor`). Used: search, clock, edit/pencil, bar-chart, alert-triangle, check, arrow-right, x-circle, sparkle, bell, flame, trophy, log-out. Use the repo's icon component.
- No raster images; no emoji as chrome.

## Files
- `AI Writing Lab.dc.html` — the full prototype (all 11 screens + states + logic). Open in a browser to see live behavior; the demo rail on the left switches screens. The JS `Component` class at the bottom holds the sample data (essay, criteria, annotations, rewrite, history) and all the derived values (word count, ring geometry, axis positions, count-up).
