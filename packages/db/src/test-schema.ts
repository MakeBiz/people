// Типы JSON-формата теста (раздел 6 ТЗ).
// Код бота универсален и не знает ни одного теста — вся структура описана здесь.

export type QuestionType =
  | "likert"
  | "single_choice"
  | "forced_pair"
  | "most_least"
  | "image_choice"
  | "numeric_scale"
  | "free_text";

export type ScoringMethod =
  | "sum_by_scale"
  | "scale_mean"
  | "count_by_scale"
  | "most_least_net" // DISC: net = (выборов «больше») − (выборов «меньше»)
  | "enps";

export interface OptionPreset {
  id: string;
  label: string;
  value: number;
}

export interface QuestionOption {
  id: string;
  label: string;
  value?: number;
  scale?: string;              // single_choice / most_least
  scales?: Record<string, number>; // forced_pair: вклад в несколько шкал
}

export interface Question {
  id: string;
  text?: string;
  type?: QuestionType;         // переопределяет question_type теста
  scale?: string;              // для likert: к какой шкале относится
  reverse?: boolean;           // инверсия значения относительно max шкалы
  prompt?: string;             // для most_least
  image_url?: string;          // для image_choice
  timer_seconds?: number;      // опц. таймер
  options?: QuestionOption[];  // свои варианты (single_choice, forced_pair, most_least, image_choice)
  allow_free_text?: boolean;   // numeric_scale + комментарий
}

export interface Interpretation {
  scale: string;               // имя шкалы или 'total'
  min?: number;                // для диапазонных интерпретаций; нет у dominant
  max?: number;
  level: string;               // low | medium | high | dominant | transitional | ...
  text: string;
}

export interface Scoring {
  method: ScoringMethod;
  scales?: string[];
  total?: string;              // 'mean_of_all' | 'sum_of_all' | имя шкалы
  // Доминирующий уровень/стиль:
  //  "max_scale"     — топ-шкала + все в пределах gap (spiral, tki, gerchikov);
  //  "max_net_scale" — то же по нетто (disc);
  //  "top_scales"    — ведущие 1-2 шкалы (schein): топ + второй, если близок (макс 2).
  dominant?: "max_scale" | "max_net_scale" | "top_scales";
  rule?: string;               // человекочитаемое описание скоринга (справочно)
  // Порог «переходного профиля»: включить вторую шкалу, если разрыв с первой <= gap.
  // По умолчанию 0.4 для scale_mean (spiral) и 0 (только ничьи) для count_by_scale (tki).
  transitional_gap?: number;
  // Режим обработки reverse у вопросов:
  //  "score" (по умолчанию)  — балл инвертируется при подсчёте (pss10);
  //  "interpretation"        — балл считается напрямую, reverse лишь маркер смысла (mbi).
  reverse_mode?: "score" | "interpretation";
  // Прочие справочные поля контента (на логику не влияют)
  note?: string;
  reverse_note?: string;
  ranges?: Record<string, [number, number]>;
  range_per_scale?: [number, number];
}

// Правило алерта в тесте (раздел 8 ТЗ). Авторский формат — человекочитаемый
// `condition` (например "exhaustion >= 27", "рост суммы два замера подряд");
// движок разбирает его в metric/type/threshold/periods (resolveRule).
// Структурные поля (type/metric/...) опциональны и имеют приоритет, если заданы.
export type AlertRuleType = "drop_from_prev" | "rise_consecutive" | "threshold_high";

export interface AlertRule {
  code: string;                // engagement_drop | stress_rise | burnout_high | ...
  level: "red" | "yellow";
  message: string;             // текст уведомления (имя сотрудника подставит движок)
  condition?: string;          // человекочитаемое условие (основной авторский формат)
  metric?: string;             // явная метрика (опц., приоритет над разбором condition)
  type?: AlertRuleType;        // явный тип условия (опц.)
  threshold?: number;          // drop_from_prev / threshold_high
  periods?: number;            // rise_consecutive: сколько замеров подряд
}

export interface TestContent {
  code: string;
  title: string;
  intro: string;
  outro: string;
  show_result_to_respondent: boolean;
  default_anonymous?: boolean; // дефолт is_anonymous при назначении этого теста
  alert_rules?: AlertRule[];   // правила алертов, считаются после завершения
  scales_meta?: Record<string, string>; // расшифровки шкал (справочно)
  category?: string;
  estimated_minutes?: number;
  description?: string;
  question_type: QuestionType; // тип по умолчанию для всех вопросов
  options_preset?: OptionPreset[];
  questions: Question[];
  scoring: Scoring;
  interpretations: Interpretation[];
}
