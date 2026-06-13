// Конфигурация карточки «Как работать с сотрудником» (см. spec_manager_card.md).
// Вынесено отдельно, чтобы дополнять правила без правки кода сборки.

// Профильные тесты и их роль в карточке.
export const CARD_TESTS: Record<string, { label: string; icon: string }> = {
  disc: { label: "Поведение (DISC)", icon: "🎯" },
  spiral: { label: "Ценности (Спиральная динамика)", icon: "🌀" },
  gerchikov: { label: "Мотивация (Герчиков)", icon: "⚡" },
  tki: { label: "Поведение в конфликте (Томас-Килманн)", icon: "🤝" },
  bigfive: { label: "Личность (Big Five)", icon: "🧩" },
  paei: { label: "Управленческая роль (PAEI)", icon: "🛠️" },
  schein: { label: "Карьерные якоря (Шейн)", icon: "⚓" },
};

// Мониторинговые тесты (нижний блок карточки).
export const MONITORING_TESTS: Array<{
  code: string;
  label: string;
  // метрика в scores; higherIsWorse — рост = ухудшение (стресс/выгорание)
  metric: string;
  higherIsWorse: boolean;
}> = [
  { code: "uwes9", label: "Вовлечённость", metric: "total", higherIsWorse: false },
  { code: "pss10", label: "Стресс", metric: "stress", higherIsWorse: true },
  { code: "mbi", label: "Выгорание (истощение)", metric: "exhaustion", higherIsWorse: true },
];

// Метки блоков внутри текста interpretation.
export const BLOCK = {
  tasks: "КАК СТАВИТЬ ЗАДАЧИ",
  talk: "КАК ОБЩАТЬСЯ",
  feedback: "КАК ДАВАТЬ ОБРАТНУЮ СВЯЗЬ",
  dont: "ЧЕГО НЕ ДЕЛАТЬ",
  motivation: "МОТИВАЦИЯ",
  conflict: "В КОНФЛИКТЕ",
  plus: "ПЛЮС",
  minus: "МИНУС",
  howWork: "КАК РАБОТАТЬ",
  strength: "СИЛА",
  blind: "СЛЕПАЯ ЗОНА",
  team: "КОМАНДА",
  goodAt: "ХОРОШ",
  develop: "РАЗВИТИЕ",
  leaveIf: "УЙДЁТ ЕСЛИ",
  risk: "РИСК",
  values: "ЦЕНИТ",
};

// Все распознаваемые метки (для парсера).
export const ALL_BLOCK_LABELS = [
  ...Object.values(BLOCK),
  "ВАЖНО",
];

// Маршрутизация шкал Big Five по слотам: куда отнести шкалу при high/low уровне.
// 'strength' → сильные стороны, 'blind' → слепые зоны, 'neutral' → не выводим.
export const BIGFIVE_ROUTING: Record<string, { high: string; low: string }> = {
  E: { high: "strength", low: "neutral" }, // экстраверсия
  A: { high: "strength", low: "blind" }, // доброжелательность
  C: { high: "strength", low: "blind" }, // добросовестность
  N: { high: "blind", low: "strength" }, // нейротизм (низкий = хорошо)
  O: { high: "strength", low: "neutral" }, // открытость опыту
};

// Модификатор обратной связи по нейротизму (слот 3).
export const FEEDBACK_BY_N: Record<string, string> = {
  high: "Чувствителен к критике: сочетайте прямоту с бережностью, критикуйте наедине.",
  low: "Спокойно воспринимает прямую критику.",
};

// Риски из TKI для слота «слепые зоны».
export const TKI_RISK: Record<string, string> = {
  avoiding: "Стиль избегания: риск накопления нерешённых вопросов — мягко выводите на разговор.",
  competing: "Стиль соперничества: риск продавливания — направляйте энергию в дело, не в столкновение.",
};

// --- Слой напряжений (light). Дополняется без правки кода сборки. ---
// Условия: hasScale — доминанта теста содержит шкалу; level — уровень шкалы Big Five.
export type TensionCond =
  | { test: string; hasScale: string }
  | { test: "bigfive"; scale: string; level: "low" | "medium" | "high" };

export interface TensionRule {
  id: string;
  when: TensionCond[]; // все условия должны выполниться
  text: string;
}

export const TENSION_RULES: TensionRule[] = [
  {
    id: "d_high_n_high",
    when: [
      { test: "disc", hasScale: "D" },
      { test: "bigfive", scale: "N", level: "high" },
    ],
    text: "Прямой по стилю, но чувствительный к критике. Будьте прямы по сути и бережны по форме, критикуйте наедине.",
  },
  {
    id: "competing_a_high",
    when: [
      { test: "tki", hasScale: "competing" },
      { test: "bigfive", scale: "A", level: "high" },
    ],
    text: "В обычной работе уступчив и дружелюбен, но в принципиальном споре идёт на принцип — не принимайте мягкость за безразличие к результату.",
  },
  {
    id: "orange_anchor_ls",
    when: [
      { test: "spiral", hasScale: "orange" },
      { test: "schein", hasScale: "LS" },
    ],
    text: "Амбициозен по целям, но не ценой личного времени. Не мотивируйте переработками — это оттолкнёт.",
  },
];
