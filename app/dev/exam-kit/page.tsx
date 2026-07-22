"use client";

import { useEffect, useState } from "react";
import { ExamTimer } from "@/components/exam/ExamTimer";
import { QuestionNavigator } from "@/components/exam/QuestionNavigator";
import { QuestionFilter } from "@/components/exam/QuestionFilter";
import { AudioPlayer } from "@/components/exam/AudioPlayer";
import { MapLabelling } from "@/components/exam/MapLabelling";

/**
 * Dev-превью библиотеки экзамен-компонентов (НЕ реальный экран — аналог showcase
 * из Claude Design). Рендерит все 5 инструментов с примерными данными и живой
 * интерактивностью, чтобы можно было сверить их 1:1. Публичный роут (/dev/* не
 * под auth-middleware). Удалить, когда станет не нужен.
 */
export default function ExamKitPreview() {
  // — Navigator: 40 ячеек, часть отвечена, две с флагом, текущая кликабельна —
  const [current, setCurrent] = useState(10);
  const nav = Array.from({ length: 40 }, (_, i) => {
    const n = i + 1;
    return { number: n, answered: n < 14, flagged: n === 7 || n === 17 };
  });

  // — Filter —
  const [cats, setCats] = useState<string[]>(["p2"]);
  const [types, setTypes] = useState<string[]>(["matching-headings"]);
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  // — Audio: самодвижущийся демо-прогресс (без файла) —
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0.32);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setProgress((p) => (p >= 1 ? (setPlaying(false), 1) : p + 0.01)), 250);
    return () => clearInterval(t);
  }, [playing]);

  // — Map: контролируемая модель (выбрать объект → назначить пин) —
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string | null>(null);
  const pins = [
    { id: "A", x: 18, y: 24 },
    { id: "B", x: 70, y: 22 },
    { id: "C", x: 30, y: 52 },
    { id: "D", x: 73, y: 54 },
    { id: "E", x: 48, y: 80 },
  ];
  const features = [
    { id: "f19", number: 19, label: "Children's corner" },
    { id: "f20", number: 20, label: "Café" },
    { id: "f21", number: 21, label: "Quiet zone" },
  ];
  const selectFeature = (fid: string) => setActive((a) => (a === fid ? null : fid));
  const assign = (pid: string) => {
    if (!active) return;
    setAnswers((prev) => {
      const next: Record<string, string> = {};
      // один пин на объект, один объект на пин — снять конфликт
      for (const k of Object.keys(prev)) if (prev[k] !== pid) next[k] = prev[k];
      if (prev[active] !== pid) next[active] = pid; // тот же пин → снять
      return next;
    });
    setActive(null);
  };

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg-base)", color: "var(--text-primary)", padding: "40px 24px 80px" }}>
      <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 36 }}>
        <header>
          <div style={S.eyebrow}>Dev preview</div>
          <h1 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-3xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", margin: "6px 0 4px" }}>Exam component kit</h1>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: 0 }}>Все 5 инструментов экзамена живьём — это не реальный экран теста, а каталог для сверки.</p>
        </header>

        <Section label="ExamTimer — calm → warn (≤5m) → critical (≤1m)">
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <ExamTimer remainingSeconds={2529} totalSeconds={3600} />
            <ExamTimer remainingSeconds={213} totalSeconds={3600} />
            <ExamTimer remainingSeconds={42} totalSeconds={3600} />
          </div>
        </Section>

        <Section label="AudioPlayer — single-pass (нажми play)">
          <AudioPlayer progress={progress} playing={playing} totalSeconds={1830} part={2} totalParts={4} onTogglePlay={() => setPlaying((p) => !p)} />
        </Section>

        <Section label="QuestionNavigator — состояния: current / answered / flagged / unanswered">
          <QuestionNavigator questions={nav} current={current} onJump={setCurrent} columns={10} />
        </Section>

        <Section label="QuestionFilter — мультиселект категория + тип">
          <QuestionFilter
            categories={[
              { value: "p1", label: "Passage 1", count: 4 },
              { value: "p2", label: "Passage 2", count: 5 },
              { value: "p3", label: "Passage 3", count: 2 },
              { value: "full", label: "Full Reading", count: 1 },
            ]}
            questionTypes={[
              { value: "tfng", label: "TFNG", count: 6 },
              { value: "matching-headings", label: "Matching Headings", count: 4 },
              { value: "mcq", label: "Multiple Choice", count: 5 },
              { value: "sentence", label: "Sentence Completion", count: 3 },
              { value: "summary", label: "Summary Completion", count: 2 },
            ]}
            selectedCategories={cats}
            selectedTypes={types}
            onToggleCategory={(v) => toggle(cats, setCats, v)}
            onToggleType={(v) => toggle(types, setTypes, v)}
            onClear={() => { setCats([]); setTypes([]); }}
            resultCount={cats.length + types.length === 0 ? 12 : 5}
          />
        </Section>

        <Section label="MapLabelling — подпиши план (выбери объект → тапни позицию)">
          <MapLabelling pins={pins} features={features} answers={answers} active={active} onSelectFeature={selectFeature} onAssign={assign} />
        </Section>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", textTransform: "uppercase", letterSpacing: "var(--tracking-caps)", color: "var(--text-muted)", marginBottom: 12 }}>{label}</div>
      {children}
    </section>
  );
}

const S: Record<string, React.CSSProperties> = {
  eyebrow: { display: "inline-flex", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-link)", background: "var(--brand-subtle)", padding: "4px 12px", borderRadius: "var(--radius-full)" },
};
