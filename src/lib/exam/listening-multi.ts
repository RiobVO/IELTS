/**
 * Атомизированный listening-раннер (ExamRunner) должен грейдиться ТЕМ ЖЕ путём, что
 * и mock (iframe-раннер): для choose-TWO/THREE группы member-вопросы (общий group_key,
 * qtype='mcq_multi') несут в answer_key ОДНУ и ту же пару букв (text_accept), и сервер
 * грейдит каждого члена как ОДНУ выбранную букву на его позиции в группе.
 *
 * Мост (src/lib/import/runner/bridge.ts:53-67, __multiFor) собирает выбранные буквы из
 * ОДНОГО общего чекбокс-блока, сортирует их (Array.sort — лексикографически) и
 * раздаёт по позиции: `checked[qs.indexOf(q)] || ''`. Атомизированный раннер рендерит
 * каждого члена ОТДЕЛЬНЫМ блоком (своё локальное string[] в answers, см. toggle в
 * ExamRunner.tsx) — эти хелперы зеркалят ТУ ЖЕ семантику «один набор на группу +
 * сортировка + позиционная раздача» перед отправкой на сервер
 * (checkAnswer/reviewMistake/submit).
 *
 * Порядок позиций: мост раздаёт по порядку data-qs, мы — по возрастанию number
 * (groupMembers). Для текущих данных расхождение невидимо: accept каждого члена
 * содержит ОБЕ верные буквы, поэтому любая раздача двух РАЗНЫХ букв даёт тот же
 * вердикт, а в проде все data-qs идут по возрастанию.
 */

/** Вопрос с номером — минимум, нужный groupMembers (типы question/CachedQuestion шире). */
interface QuestionWithGroup {
  number: number;
  group_key: string | null;
}

/**
 * Зеркало __multiFor: сортирует копию chosen (JS Array.sort без компаратора —
 * лексикографически, НЕ numeric; регистр букв не трогаем — сервер нормализует сам) и
 * возвращает букву на позиции этого члена группы. Член вне memberNumbers/пустой набор
 * → "" (indexOf === -1 → sorted[-1] === undefined).
 */
export function bridgeLetterFor(chosen: string[], memberNumbers: number[], number: number): string {
  const sorted = [...chosen].sort();
  const idx = memberNumbers.indexOf(number);
  return sorted[idx] ?? "";
}

/**
 * Union непустых значений членов группы из карты ответов (ключи — String(number),
 * как в answers-стейте раннера): string (legacy-значение) → [string], дубликаты
 * схлопываются. Группа — один логический контрол, но члены могли разойтись в
 * застарелом стейте (resume попытки, сохранённой до шаринга стейта в toggle) —
 * union восстанавливает единый набор.
 */
export function unionChosen(
  valuesByNumber: Record<string, string | string[] | undefined>,
  memberNumbers: number[],
): string[] {
  const set = new Set<string>();
  for (const n of memberNumbers) {
    const v = valuesByNumber[String(n)];
    for (const x of Array.isArray(v) ? v : v ? [v] : []) {
      if (x) set.add(x);
    }
  }
  return [...set];
}

/**
 * Позиционные буквы для ВСЕХ членов группы разом: union набора по членам (см.
 * unionChosen) → сортировка → раздача по позиции (bridgeLetterFor). Именно этим
 * пользуются исходящие точки раннера — так член с пустым локальным массивом всё
 * равно получает свою букву из общего набора, как получил бы от моста.
 */
export function bridgeLettersFor(
  valuesByNumber: Record<string, string | string[] | undefined>,
  memberNumbers: number[],
): Record<number, string> {
  const chosen = unionChosen(valuesByNumber, memberNumbers);
  const out: Record<number, string> = {};
  for (const n of memberNumbers) out[n] = bridgeLetterFor(chosen, memberNumbers, n);
  return out;
}

/**
 * Тоггл буквы в ЕДИНОМ наборе группы (choose-TWO/THREE — один логический контрол,
 * как чекбокс-блок моста): union текущих значений членов → добавить/убрать букву →
 * сортировка. Результат — итоговый массив, который раннер пишет во ВСЕ члены группы
 * (блоки визуально синхронны). Union вместо локального массива одного члена — члены
 * могли разойтись в застарелом стейте (resume попытки до шаринга), и снятая буква
 * не должна воскресать из соседнего члена.
 */
export function toggleGroupLetter(
  valuesByNumber: Record<string, string | string[] | undefined>,
  memberNumbers: number[],
  letter: string,
): string[] {
  const cur = unionChosen(valuesByNumber, memberNumbers);
  return (cur.includes(letter) ? cur.filter((x) => x !== letter) : [...cur, letter]).sort();
}

/**
 * Номера членов choose-TWO/THREE группы по groupKey, отсортированные по возрастанию
 * (порядок, в котором мост раздаёт буквы по позиции). Члены группы — все вопросы
 * теста с ТЕМ ЖЕ group_key (в данных группы вида "11-12" номера соседние, но берём
 * равенство ключа, а не парсим диапазон — это уже атомизированные вопросы БД, не
 * DOM-атрибут). Один член в списке — вырожденный случай, эквивалентный мосту
 * (memberNumbers.indexOf(number) === 0).
 */
export function groupMembers(questions: QuestionWithGroup[], groupKey: string): number[] {
  return questions
    .filter((q) => q.group_key === groupKey)
    .map((q) => q.number)
    .sort((a, b) => a - b);
}
