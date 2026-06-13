import type { TestContent } from "@/lib/db";

const QUESTION_TYPES = [
  "likert",
  "single_choice",
  "forced_pair",
  "most_least",
  "image_choice",
  "numeric_scale",
  "free_text",
];

const SCORING_METHODS = [
  "sum_by_scale",
  "scale_mean",
  "count_by_scale",
  "most_least_net",
  "enps",
];

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  content?: TestContent;
}

// Проверка структуры JSON-теста перед сохранением (раздел 6 ТЗ).
// Ловит то, что сломало бы движок бота; не претендует на полноту психометрии.
export function validateTestContent(data: unknown): ValidationResult {
  const e: string[] = [];
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, errors: ["Корень JSON должен быть объектом"] };
  }
  const d = data as Record<string, unknown>;

  if (typeof d.code !== "string" || !d.code.trim()) e.push("Поле «code» обязательно (непустая строка)");
  if (typeof d.title !== "string" || !d.title.trim()) e.push("Поле «title» обязательно");
  if (typeof d.question_type !== "string" || !QUESTION_TYPES.includes(d.question_type)) {
    e.push(`«question_type» должен быть один из: ${QUESTION_TYPES.join(", ")}`);
  }

  if (!Array.isArray(d.questions) || d.questions.length === 0) {
    e.push("«questions» должен быть непустым массивом");
  } else {
    d.questions.forEach((q, i) => {
      if (typeof q !== "object" || q === null) e.push(`questions[${i}]: должен быть объектом`);
      else if (!("id" in q) || !(q as Record<string, unknown>).id) e.push(`questions[${i}]: нет поля «id»`);
    });
  }

  const scoring = d.scoring as Record<string, unknown> | undefined;
  if (!scoring || typeof scoring !== "object") {
    e.push("«scoring» обязателен (объект)");
  } else if (typeof scoring.method !== "string" || !SCORING_METHODS.includes(scoring.method)) {
    e.push(`«scoring.method» должен быть один из: ${SCORING_METHODS.join(", ")}`);
  }

  if (!Array.isArray(d.interpretations)) e.push("«interpretations» должен быть массивом");

  // likert/numeric_scale без собственных options опираются на options_preset
  const questions = Array.isArray(d.questions) ? (d.questions as Record<string, unknown>[]) : [];
  const usesPreset = questions.some((q) => {
    const t = (q.type as string) ?? (d.question_type as string);
    return (t === "likert" || t === "numeric_scale") && !Array.isArray(q.options);
  });
  if (usesPreset && !Array.isArray(d.options_preset)) {
    e.push("для вопросов типа likert/numeric_scale нужен «options_preset»");
  }

  return { ok: e.length === 0, errors: e, content: e.length === 0 ? (d as unknown as TestContent) : undefined };
}
