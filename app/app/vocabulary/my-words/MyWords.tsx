"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { Icon } from "@/components/core/icons";
import { Button } from "@/components/core/Button";
import { deleteSavedWord, reviewSavedWord } from "../saved-words-actions";

/**
 * MyWords — клиентское тело экрана «My words» (`/app/vocabulary/my-words`): личный
 * словарь слов, закладываемых из пассажей (P11). Два вида: список (word + context +
 * due-статус + delete) и flashcard-повтор (word → context, self-grade Again/Good/Easy).
 * SM-2 и запись авторитетны на сервере (reviewSavedWord owner-path); компонент лишь
 * гонит локальную очередь. НЕ вплетён в deck-сессии/деки (отдельная таблица saved_word).
 *
 * Тип строки продублирован локально (server-only queries нельзя тянуть в client-бандл) —
 * тот же паттерн, что ReviewCard в ReviewSession.
 */

type Grade = "again" | "good" | "easy";

export interface SavedWordRow {
  id: string;
  word: string;
  context: string;
  due: boolean;
  isNew: boolean;
}

export function MyWords({ words }: { words: SavedWordRow[] }) {
  const [items, setItems] = useState(words);
  const [view, setView] = useState<"list" | "review">("list");
  const [queue, setQueue] = useState<SavedWordRow[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [pending, setPending] = useState(false);
  const [total, setTotal] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  const dueCount = items.filter((w) => w.due).length;
  const current = queue[0] ?? null;
  const completed = total - queue.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const finished = view === "review" && total > 0 && queue.length === 0;

  // Транзиентное сообщение угасает само (паттерн семейства vocab-сессии).
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);

  function startReview() {
    // Приоритет due-словам; если ничего не due — свободный повтор всего словаря.
    const due = items.filter((w) => w.due);
    const q = due.length > 0 ? due : items;
    if (q.length === 0) return;
    setQueue(q);
    setTotal(q.length);
    setReviewed(0);
    setFlipped(false);
    setView("review");
  }

  function exitReview() {
    setView("list");
    setQueue([]);
    setFlipped(false);
  }

  async function grade(g: Grade) {
    const card = current;
    if (!card || pending) return;
    setPending(true);
    try {
      const res = await reviewSavedWord(card.id, g);
      if (res.ok) {
        setReviewed((n) => n + 1);
        // "again" → в хвост очереди (interval 0, due немедленно — SM-2 на сервере);
        // "good"/"easy" → карта покидает сессию. Вернувшаяся карта уже не новая.
        setQueue((q) => (g === "again" ? [...q.slice(1), { ...card, isNew: false }] : q.slice(1)));
        setFlipped(false);
      } else if (res.reason === "not_found") {
        // Слово удалено в другой вкладке — снимаем из списка и очереди.
        setItems((it) => it.filter((x) => x.id !== card.id));
        setQueue((q) => q.slice(1));
        setFlipped(false);
      } else {
        setMsg("Couldn't save that — try again.");
      }
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    // Оптимистично убираем из списка; серверный owner-path best-effort.
    setItems((it) => it.filter((x) => x.id !== id));
    const res = await deleteSavedWord(id);
    if (!res.ok) setMsg("Couldn't remove that word.");
  }

  return (
    <div className="mw-wrap" style={S.wrap}>
      <style>{CSS}</style>

      <div>
        <Link href="/app/vocabulary" style={S.back}>
          <Icon name="arrow-left" size={15} strokeWidth={2.4} /> Back to Vocabulary
        </Link>
        <h1 style={S.title}>My words</h1>
        <p style={S.sub}>
          Words you saved while reading — reviewed with the same spaced repetition as your decks.
        </p>
        <div style={S.headStats}>
          <span style={S.stat}>
            <Icon name="book-open" size={13} strokeWidth={2.4} /> {items.length} saved
          </span>
          {dueCount > 0 && (
            <span style={S.statDue}>
              <Icon name="clock" size={13} strokeWidth={2.4} /> {dueCount} due
            </span>
          )}
        </div>
      </div>

      <div aria-live="polite" style={S.srOnly}>{msg}</div>
      {msg && <div role="status" style={S.toast}>{msg}</div>}

      {items.length === 0 ? (
        <div style={S.empty}>
          <span style={S.emptyIcon}>
            <Icon name="star" size={26} strokeWidth={2} />
          </span>
          <span style={S.emptyTitle}>No saved words yet</span>
          <span>
            While practicing a reading test, select a single word in the passage and tap
            <b> Save word</b> — it lands here for spaced-repetition review.
          </span>
          <Button href="/app/practice" variant="secondary" trailingIcon="arrow-right">
            Go to Practice
          </Button>
        </div>
      ) : view === "review" ? (
        finished ? (
          <div style={S.summary}>
            <span style={S.summaryIcon}>
              <Icon name="circle-check" size={30} strokeWidth={2} />
            </span>
            <h2 style={S.summaryTitle}>Session complete</h2>
            <p style={S.summaryBody}>
              You reviewed {reviewed} {reviewed === 1 ? "word" : "words"}.
            </p>
            <div style={S.summaryActions}>
              <Button variant="secondary" onClick={exitReview}>Back to list</Button>
            </div>
          </div>
        ) : current ? (
          <>
            <div
              style={S.progressRow}
              role="progressbar"
              aria-label="Session progress"
              aria-valuenow={completed}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuetext={`${completed} of ${total} reviewed`}
            >
              <span style={S.progressTrack}>
                <span style={{ ...S.progressFill, width: `${pct}%` }} />
              </span>
              <span style={S.progressLabel}>{completed} / {total}</span>
            </div>

            <div style={S.card}>
              <div style={S.word}>{current.word}</div>
              {!flipped ? (
                <button type="button" onClick={() => setFlipped(true)} style={S.flipBtn}>
                  Show context
                </button>
              ) : (
                <div style={S.context}>
                  {current.context ? <em>&ldquo;{current.context}&rdquo;</em> : <span style={S.noContext}>No context saved.</span>}
                </div>
              )}
            </div>

            {flipped && (
              <>
                <div style={S.actions}>
                  <Button variant="secondary" size="lg" disabled={pending} onClick={() => grade("again")} style={{ flex: 1 }}>
                    Again
                  </Button>
                  <Button variant="success" size="lg" disabled={pending} onClick={() => grade("good")} style={{ flex: 1 }}>
                    Good
                  </Button>
                  {current.isNew && (
                    <Button variant="ghost" size="lg" disabled={pending} onClick={() => grade("easy")} style={S.easyBtn}>
                      Easy
                    </Button>
                  )}
                </div>
                <button type="button" onClick={exitReview} style={S.exitLink}>
                  End session
                </button>
              </>
            )}
          </>
        ) : null
      ) : (
        <>
          <div style={S.reviewCta}>
            <Button onClick={startReview} trailingIcon="arrow-right">
              {dueCount > 0 ? `Review ${dueCount} due` : "Review all"}
            </Button>
          </div>
          <ul style={S.list}>
            {items.map((w) => (
              <li key={w.id} style={S.row}>
                <div style={S.rowMain}>
                  <div style={S.rowWord}>
                    {w.word}
                    {w.due && <span style={S.dueDot} title="Due for review" />}
                  </div>
                  {w.context && <div style={S.rowContext}>{w.context}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => remove(w.id)}
                  aria-label={`Remove ${w.word}`}
                  title={`Remove ${w.word}`}
                  className="mw-del"
                  style={S.del}
                >
                  <Icon name="trash" size={16} strokeWidth={2.2} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const CSS = `
.mw-wrap{padding:24px 16px 64px}
.mw-del:hover{color:var(--error-text);background:var(--error-subtle)}
@media (pointer:coarse){.mw-del{width:44px;height:44px}}
@media (min-width:768px){.mw-wrap{padding:32px 24px 72px}}
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18, fontFamily: "var(--font-ui)", color: "var(--text-primary)" },
  back: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--text-muted)", textDecoration: "none" },
  title: { margin: "10px 0 0", fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text-primary)" },
  sub: { margin: "8px 0 0", fontSize: 15, lineHeight: 1.5, color: "var(--text-muted)", maxWidth: "52ch" },
  headStats: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 },
  stat: { display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: "var(--radius-full)", background: "var(--surface-inset)", color: "var(--text-secondary)", fontSize: 12.5, fontWeight: 700 },
  statDue: { display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: "var(--radius-full)", background: "var(--brand-subtle)", color: "var(--text-link)", fontSize: 12.5, fontWeight: 800 },

  srOnly: { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 },
  toast: { alignSelf: "flex-start", padding: "8px 14px", borderRadius: "var(--radius-full)", background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-solid)", fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" },

  empty: { display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "40px 24px", textAlign: "center", color: "var(--text-muted)", fontSize: 14, lineHeight: 1.55, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)" },
  emptyIcon: { display: "grid", placeItems: "center", width: 52, height: 52, borderRadius: "50%", background: "var(--brand-subtle)", color: "var(--text-link)", marginBottom: 2 },
  emptyTitle: { fontFamily: "var(--font-ui)", fontSize: 17, fontWeight: 800, color: "var(--text-primary)" },

  reviewCta: { display: "flex" },

  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)" },
  rowMain: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 },
  rowWord: { display: "inline-flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--text-primary)" },
  dueDot: { width: 8, height: 8, borderRadius: "var(--radius-full)", background: "var(--brand)", flex: "none" },
  rowContext: { fontSize: 13, lineHeight: 1.45, color: "var(--text-muted)", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  del: { width: 38, height: 38, flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--radius-md)", border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", transition: "var(--transition-colors)" },

  progressRow: { display: "flex", alignItems: "center", gap: 12 },
  progressTrack: { position: "relative", flex: 1, display: "block", height: 8, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", overflow: "hidden" },
  progressFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: "var(--radius-full)", background: "var(--brand)" },
  progressLabel: { flex: "none", fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" },

  card: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 16, minHeight: 200, padding: "28px 22px", borderRadius: "var(--radius-xl)", border: "2px solid var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-solid)" },
  word: { fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text-primary)" },
  flipBtn: { appearance: "none", cursor: "pointer", padding: "10px 20px", borderRadius: "var(--radius-md)", border: "2px solid var(--brand-border)", background: "var(--brand-subtle)", color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800 },
  context: { fontSize: 16, lineHeight: 1.55, color: "var(--text-primary)", maxWidth: "44ch" },
  noContext: { color: "var(--text-muted)", fontStyle: "italic" },

  actions: { display: "flex", gap: 12 },
  easyBtn: { flex: 1, background: "var(--brand-subtle)", color: "var(--text-link)", border: "2px solid var(--brand-border)" },
  exitLink: { alignSelf: "center", appearance: "none", border: "none", background: "transparent", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 6 },

  summary: { display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10, padding: "40px 24px", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-solid)" },
  summaryIcon: { display: "grid", placeItems: "center", width: 56, height: 56, borderRadius: "50%", background: "var(--success-subtle)", color: "var(--success-text)", marginBottom: 4 },
  summaryTitle: { margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text-primary)" },
  summaryBody: { margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--text-muted)" },
  summaryActions: { display: "flex", gap: 12, marginTop: 14 },
};
