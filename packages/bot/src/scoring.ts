import type { TestContent, Question } from "@hr/db";

export interface RawAnswer {
  questionId: string;
  optionId: string;
  answerValue: number | null;
  responseMs: number | null;
}

export interface ScoredResult {
  scores: Record<string, number>;
  interpretation: Array<{ scale: string; level: string; text: string; value: number }>;
  validityFlag: "ok" | "too_fast" | "uniform";
  totalValue: number | null;
}

function maxPresetValue(content: TestContent): number {
  const vals = (content.options_preset ?? []).map((o) => o.value);
  return vals.length ? Math.max(...vals) : 0;
}

function minPresetValue(content: TestContent): number {
  const vals = (content.options_preset ?? []).map((o) => o.value);
  return vals.length ? Math.min(...vals) : 0;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// --- Антифрод (раздел «Антифрод» ТЗ) ---
function computeValidity(
  content: TestContent,
  answers: RawAnswer[]
): "ok" | "too_fast" | "uniform" {
  const isEnps = content.scoring.method === "enps";
  const meaningfulAnswers = answers.filter((a) => !a.optionId.startsWith("least:"));

  // too_fast: медиана response_ms < 1500 мс на содержательных тестах
  if (!isEnps && content.questions.length >= 5) {
    const times = answers
      .map((a) => a.responseMs)
      .filter((t): t is number => typeof t === "number" && t > 0);
    if (times.length >= 5 && median(times) < 1500) return "too_fast";
  }

  // uniform: один и тот же вариант ответа > 90% вопросов
  if (!isEnps && meaningfulAnswers.length >= 5) {
    const freq = new Map<string, number>();
    for (const a of meaningfulAnswers) {
      const key = a.optionId.replace(/^most:/, "");
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
    const maxFreq = Math.max(...freq.values());
    if (maxFreq / meaningfulAnswers.length > 0.9) return "uniform";
  }

  return "ok";
}

function questionById(content: TestContent, id: string): Question | undefined {
  return content.questions.find((q) => q.id === id);
}

// --- Методы скоринга (раздел «Скоринг» ТЗ) ---

function scoreSumByScale(content: TestContent, answers: RawAnswer[]) {
  // Инверсия симметрична относительно (min+max): для 0-based шкал (pss 0–4) это
  // maxV−v, для 1-based (bigfive 1–5) — 6−v (5↔1, 3=3). Простой maxV−v давал бы
  // для 1-based выход за диапазон (5→0).
  const reflect = minPresetValue(content) + maxPresetValue(content);
  const scores: Record<string, number> = {};
  for (const scale of content.scoring.scales ?? []) scores[scale] = 0;

  // Различаем два смысла reverse БЕЗ доп. поля — по структуре шкалы:
  //  • «смешанная» шкала (есть и прямые, и reverse-вопросы, как stress в PSS-10)
  //    → reverse инвертирует балл, чтобы выровнять направление внутри суммы;
  //  • шкала целиком из reverse-вопросов (как accomplishment в MBI)
  //    → это позитивно-ключёванная шкала, суммируем напрямую, reverse лишь маркер
  //      смысла (низкий балл = тревожно).
  // Явный scoring.reverse_mode, если задан, имеет приоритет (обратная совместимость).
  const hasReverse: Record<string, boolean> = {};
  const hasDirect: Record<string, boolean> = {};
  for (const q of content.questions) {
    if (!q.scale) continue;
    if (q.reverse) hasReverse[q.scale] = true;
    else hasDirect[q.scale] = true;
  }
  // Приоритет: явное поле reverse_mode → токен "reverse_mode=score|interpretation"
  // в авторском reverse_note (так размечен bigfive) → вывод по структуре шкалы.
  const noteMode = content.scoring.reverse_note?.match(
    /reverse_mode\s*=\s*(score|interpretation)/i
  )?.[1] as "score" | "interpretation" | undefined;
  const forced = content.scoring.reverse_mode ?? noteMode;
  const invertScale = (scale: string) =>
    forced ? forced === "score" : !!(hasReverse[scale] && hasDirect[scale]);

  for (const ans of answers) {
    const q = questionById(content, ans.questionId);
    if (!q || !q.scale || ans.answerValue == null) continue;
    let value = ans.answerValue;
    if (q.reverse && invertScale(q.scale)) value = reflect - value;
    scores[q.scale] = (scores[q.scale] ?? 0) + value;
  }
  return scores;
}

function scoreScaleMean(content: TestContent, answers: RawAnswer[]) {
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const ans of answers) {
    const q = questionById(content, ans.questionId);
    if (!q || !q.scale || ans.answerValue == null) continue;
    sums[q.scale] = (sums[q.scale] ?? 0) + ans.answerValue;
    counts[q.scale] = (counts[q.scale] ?? 0) + 1;
  }
  const scores: Record<string, number> = {};
  for (const scale of content.scoring.scales ?? Object.keys(sums)) {
    scores[scale] = counts[scale] ? round2(sums[scale] / counts[scale]) : 0;
  }
  return scores;
}

function scoreCountByScale(content: TestContent, answers: RawAnswer[]) {
  const scores: Record<string, number> = {};
  for (const scale of content.scoring.scales ?? []) scores[scale] = 0;
  const bump = (scale: string | undefined, delta: number) => {
    if (!scale) return;
    scores[scale] = (scores[scale] ?? 0) + delta;
  };

  for (const ans of answers) {
    const q = questionById(content, ans.questionId);
    // most_least
    if (ans.optionId.startsWith("most:") || ans.optionId.startsWith("least:")) {
      const optId = ans.optionId.split(":")[1];
      const opt = q?.options?.find((o) => o.id === optId);
      bump(opt?.scale, ans.optionId.startsWith("most:") ? 1 : -1);
      continue;
    }
    const opt = q?.options?.find((o) => o.id === ans.optionId);
    if (!opt) continue;
    // forced_pair: вклад в несколько шкал
    if (opt.scales) {
      for (const [scale, delta] of Object.entries(opt.scales)) bump(scale, delta);
    } else if (opt.scale) {
      // single_choice: вес = value, если задан, иначе +1
      bump(opt.scale, typeof opt.value === "number" ? opt.value : 1);
    }
  }
  return scores;
}

function scoreEnps(content: TestContent, answers: RawAnswer[]) {
  // Индивидуальный результат: фиксируем оценку 0–10. Индекс по кампании считает админка.
  const scaleQ = content.questions.find((q) => q.type === "numeric_scale" || q.scale === "enps");
  const ans = answers.find((a) => a.questionId === scaleQ?.id);
  const value = ans?.answerValue ?? 0;
  return { enps: value };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeTotal(
  content: TestContent,
  scores: Record<string, number>,
  answers: RawAnswer[]
): number | null {
  const total = content.scoring.total;
  if (!total) return null;
  if (total === "mean_of_all") {
    const vals = answers.map((a) => a.answerValue).filter((v): v is number => v != null);
    return vals.length ? round2(vals.reduce((s, v) => s + v, 0) / vals.length) : 0;
  }
  if (total === "sum_of_all") {
    return Object.values(scores).reduce((s, v) => s + v, 0);
  }
  return scores[total] ?? null;
}

// Доминирующие шкалы (spiral/tki): максимальная + те, что в пределах transitional_gap.
// Для scale_mean gap по умолчанию 0.4 (переходный профиль), для остальных — 0 (только ничьи).
export function dominantScales(
  content: TestContent,
  scores: Record<string, number>
): string[] {
  const scaleNames = content.scoring.scales ?? Object.keys(scores);
  const entries = scaleNames
    .map((s) => [s, scores[s] ?? 0] as [string, number])
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) return [];
  const top = entries[0][1];
  const gap = transitionalGap(content);

  // top_scales (schein): ведущие 1-2 якоря — топ + второй, если близок (макс 2).
  if (content.scoring.dominant === "top_scales") {
    const lead = [entries[0][0]];
    if (entries[1] && top - entries[1][1] <= gap) lead.push(entries[1][0]);
    return lead;
  }

  // max_scale / max_net_scale: топ + все в пределах gap (без ограничения на 2).
  return entries.filter(([, v]) => top - v <= gap).map(([s]) => s);
}

// Все режимы доминирования, при которых интерпретации выбираются по топ-шкалам.
function isDominantMode(content: TestContent): boolean {
  const d = content.scoring.dominant;
  return d === "max_scale" || d === "max_net_scale" || d === "top_scales";
}

// Порог «переходного/смешанного профиля»: явное поле → число из прозы note/rule
// («... <= 0.4 ...», «... <= 2 ...») → дефолт по методу (scale_mean 0.4, иначе 2).
function transitionalGap(content: TestContent): number {
  if (typeof content.scoring.transitional_gap === "number") {
    return content.scoring.transitional_gap;
  }
  const prose = `${content.scoring.note ?? ""} ${content.scoring.rule ?? ""}`;
  const m = prose.match(/<=\s*([\d]+(?:[.,]\d+)?)/);
  if (m) return parseFloat(m[1].replace(",", "."));
  return content.scoring.method === "scale_mean" ? 0.4 : 2;
}

function pickInterpretations(
  content: TestContent,
  scores: Record<string, number>,
  totalValue: number | null
) {
  const out: ScoredResult["interpretation"] = [];

  // Режим dominant: интерпретации по доминирующей шкале (без диапазонов min/max)
  if (isDominantMode(content)) {
    const dom = dominantScales(content, scores);
    const transitional = dom.length > 1;
    for (const scale of dom) {
      const interp = content.interpretations.find((i) => i.scale === scale);
      if (!interp) continue;
      out.push({
        scale,
        level: transitional ? "transitional" : interp.level,
        text: interp.text,
        value: round2(scores[scale] ?? 0),
      });
    }
    return out;
  }

  // Диапазонный режим: по min/max шкалы или total
  for (const interp of content.interpretations) {
    if (interp.min == null || interp.max == null) continue;
    const value = interp.scale === "total" ? totalValue : scores[interp.scale];
    if (value == null) continue;
    if (value >= interp.min && value <= interp.max) {
      out.push({ scale: interp.scale, level: interp.level, text: interp.text, value: round2(value) });
    }
  }
  return out;
}

export function score(content: TestContent, answers: RawAnswer[]): ScoredResult {
  let scores: Record<string, number>;
  switch (content.scoring.method) {
    case "sum_by_scale":
      scores = scoreSumByScale(content, answers);
      break;
    case "scale_mean":
      scores = scoreScaleMean(content, answers);
      break;
    case "count_by_scale":
    case "most_least_net":
      // most_least_net (DISC): нетто = (выборов «больше всего») − («меньше всего»).
      // Совпадает с count_by_scale на most/least-данных (most:+1, least:−1).
      scores = scoreCountByScale(content, answers);
      break;
    case "enps":
      scores = scoreEnps(content, answers);
      break;
    default:
      scores = {};
  }

  const totalValue = computeTotal(content, scores, answers);
  if (totalValue != null) scores.total = totalValue;

  return {
    scores,
    totalValue,
    interpretation: pickInterpretations(content, scores, totalValue),
    validityFlag: computeValidity(content, answers),
  };
}
