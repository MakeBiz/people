import { prisma } from "@hr/db";
import type { AlertRule } from "@hr/db";
import type { Bot } from "grammy";
import { DEPT_SIGNAL, DEPT_SIGNAL_MESSAGE } from "./alert-config.js";

interface NewAlert {
  ruleCode: string;
  level: "red" | "yellow";
  details: Record<string, unknown>;
  message: string; // текст уведомления руководителю
}

// Минимальное описание скоринга теста, нужное для разрешения метрики правила.
export interface ScoringInfo {
  method?: string;
  scales?: string[];
  total?: string;
}

// Вычисление алертов после завершённого теста (раздел 8 ТЗ), data-driven.
// Правила берутся из tests.content.alert_rules в АВТОРСКОМ формате (строковый
// `condition`), разбираются resolveRule. invalid_session — встроенное глобальное
// правило (валидность). Имя сотрудника подставляется в уведомление движком.
export async function evaluateAndNotify(params: {
  bot: Bot;
  personId: string;
  personName: string;
  departmentId: string | null;
  testId: string;
  testCode: string;
  scores: Record<string, number>;
  alertRules: AlertRule[];
  scoring: ScoringInfo;
  validityFlag: string | null;
}) {
  const {
    bot,
    personId,
    personName,
    departmentId,
    testId,
    testCode,
    scores,
    alertRules,
    scoring,
    validityFlag,
  } = params;
  const alerts: NewAlert[] = [];

  // --- Встроенное правило: invalid_session (validity_flag != ok) ---
  if (validityFlag && validityFlag !== "ok") {
    alerts.push({
      ruleCode: "invalid_session",
      level: "yellow",
      details: { validityFlag, testCode },
      message: `⚠️ ${personName}: сомнительная валидность теста «${testCode}» (${validityFlag}). Стоит перепроверить результат.`,
    });
  }

  // --- Правила из контента теста (авторский формат) ---
  for (const raw of alertRules ?? []) {
    const rule = resolveRule(raw, scoring);
    if (!rule) continue; // не распознано или агрегатное (eNPS отдела) — Этап 2
    const current = scores[rule.metric];
    if (typeof current !== "number") continue;
    const periods = rule.type === "rise_consecutive" ? (rule.periods ?? 2) : 1;
    const history = await lastMetrics(personId, testId, rule.metric, periods);
    const fired = applyRule(rule, history, current);
    if (!fired) continue;
    // Имя подставляем здесь: авторские message его не содержат.
    const body = renderMessage(rule.message, { name: personName, ...fired.vars });
    alerts.push({
      ruleCode: rule.code,
      level: rule.level,
      details: fired.details,
      message: body.includes(personName) ? body : `${personName}: ${body}`,
    });
  }

  // Индивидуальные алерты — с дедупликацией; уведомляем только о НОВЫХ.
  if (alerts.length) {
    const notifyIds = await notifyTelegramIds(personId);
    for (const a of alerts) {
      const created = await upsertAlert({
        personId,
        departmentId: null,
        level: a.level,
        ruleCode: a.ruleCode,
        details: a.details,
      });
      if (!created) continue; // дубликат активного алерта — не шлём повторно
      for (const tgId of notifyIds) {
        try {
          await bot.api.sendMessage(tgId.toString(), a.message);
        } catch (e) {
          console.error(`Не удалось отправить алерт в Telegram ${tgId}:`, e);
        }
      }
    }
  }

  // Системный сигнал по отделу (агрегат отдела падает при стабильных людях).
  if (departmentId) {
    await evaluateDeptSignal(bot, departmentId, testCode);
  }
}

// Дедупликация: один активный алерт на (человек|отдел) + правило. Если активный
// уже есть — обновляем его детали и возвращаем false (не создаём дубликат и не
// шлём повторное уведомление). Если нет — создаём и возвращаем true.
async function upsertAlert(a: {
  personId: string | null;
  departmentId: string | null;
  level: string;
  ruleCode: string;
  details: Record<string, unknown>;
}): Promise<boolean> {
  const existing = await prisma.alert.findFirst({
    where: {
      personId: a.personId,
      departmentId: a.departmentId,
      ruleCode: a.ruleCode,
      status: { in: ["new", "acknowledged"] },
    },
  });
  if (existing) {
    await prisma.alert.update({
      where: { id: existing.id },
      data: { details: a.details as object, level: a.level },
    });
    return false;
  }
  await prisma.alert.create({
    data: {
      personId: a.personId,
      departmentId: a.departmentId,
      level: a.level,
      ruleCode: a.ruleCode,
      details: a.details as object,
      status: "new",
    },
  });
  return true;
}

// Системный сигнал по отделу: средняя вовлечённость (UWES total) отдела упала
// к прошлому замеру, ПРИ ЭТОМ нет индивидуальных engagement_drop → проблема не в
// людях, а в процессах/руководителе. eNPS-вариант включится с кампаниями.
async function evaluateDeptSignal(bot: Bot, departmentId: string, testCode: string) {
  if (testCode !== "uwes9") return;
  const test = await prisma.test.findUnique({ where: { code: "uwes9" } });
  if (!test) return;

  const people = await prisma.person.findMany({
    where: { departmentId, status: { not: "archived" } },
    select: { id: true },
  });
  if (people.length < DEPT_SIGNAL.minPeople) return;

  // По каждому человеку отдела — два последних UWES total (текущий и предыдущий).
  const curr: number[] = [];
  const prev: number[] = [];
  for (const p of people) {
    const rs = await prisma.result.findMany({
      where: { personId: p.id, testId: test.id },
      orderBy: { createdAt: "desc" },
      take: 2,
    });
    const v0 = (rs[0]?.scores as Record<string, number> | undefined)?.total;
    const v1 = (rs[1]?.scores as Record<string, number> | undefined)?.total;
    if (typeof v0 === "number") curr.push(v0);
    if (typeof v1 === "number") prev.push(v1);
  }
  if (curr.length < DEPT_SIGNAL.minPeople || prev.length < DEPT_SIGNAL.minPeople) return;

  const currAvg = mean(curr);
  const prevAvg = mean(prev);
  if (prevAvg - currAvg < DEPT_SIGNAL.engagementDrop) return;

  // Стабильность людей: нет активных индивидуальных engagement_drop в отделе.
  const indiv = await prisma.alert.count({
    where: {
      ruleCode: "engagement_drop",
      status: { in: ["new", "acknowledged"] },
      person: { departmentId },
    },
  });
  if (indiv > 0) return; // падение объяснимо людьми — это не системный сигнал

  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  const created = await upsertAlert({
    personId: null,
    departmentId,
    level: "yellow",
    ruleCode: "engagement_drop",
    details: {
      system: true,
      previous: round2(prevAvg),
      current: round2(currAvg),
      delta: round2(prevAvg - currAvg),
      people: curr.length,
    },
  });
  if (!created) return;

  const message = DEPT_SIGNAL_MESSAGE.engagement_drop
    .replace("{dept}", dept?.name ?? "—")
    .replace("{prev}", String(round2(prevAvg)))
    .replace("{current}", String(round2(currAvg)));
  // Уведомляем руководителей/владельцев (по людям отдела через notifyTelegramIds любого).
  const owners = await prisma.adminUser.findMany({
    where: { role: { in: ["owner", "hr"] }, person: { telegramId: { not: null } } },
    include: { person: true },
  });
  for (const o of owners) {
    if (!o.person?.telegramId) continue;
    try {
      await bot.api.sendMessage(o.person.telegramId.toString(), message);
    } catch (e) {
      console.error("Не удалось отправить системный сигнал:", e);
    }
  }
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : 0;
}

export interface RuleFire {
  details: Record<string, unknown>;
  vars: Record<string, string | number>;
}

// Нормализованное правило: метрика и тип условия выведены из авторского contenta.
export interface ResolvedRule {
  code: string;
  level: "red" | "yellow";
  message: string;
  type: "drop_from_prev" | "rise_consecutive" | "threshold_high";
  metric: string;
  threshold?: number;
  periods?: number;
}

// Метрика по умолчанию для теста: именованная total-шкала → 'total' (для
// mean_of_all/sum_of_all) → единственная шкала → первая шкала.
function primaryMetric(scoring: ScoringInfo): string | null {
  const t = scoring.total;
  if (t && t !== "mean_of_all" && t !== "sum_of_all") return t;
  if (t) return "total";
  const scales = scoring.scales ?? [];
  return scales[0] ?? null;
}

// Разбор авторского alert_rule (строковый `condition`) в нормализованное правило.
// Если у правила есть явные структурные поля (type) — они в приоритете.
// Возвращает null для нераспознанных и агрегатных-по-отделу правил (Этап 2).
export function resolveRule(rule: AlertRule, scoring: ScoringInfo): ResolvedRule | null {
  const base = (
    type: ResolvedRule["type"],
    metric: string | null,
    extra: { threshold?: number; periods?: number }
  ): ResolvedRule | null =>
    metric
      ? { code: rule.code, level: rule.level, message: rule.message, type, metric, ...extra }
      : null;

  // Явные структурные поля (обратная совместимость с моим прежним форматом)
  if (rule.type) {
    return base(rule.type, rule.metric ?? primaryMetric(scoring), {
      threshold: rule.threshold,
      periods: rule.periods,
    });
  }

  const cond = (rule.condition ?? "").toLowerCase();
  if (!cond) return null;
  if (cond.includes("отдел")) return null; // агрегат по отделу — Этап 2

  const scales = scoring.scales ?? [];
  const primary = primaryMetric(scoring);
  const mentioned =
    scales.find((s) => cond.includes(s.toLowerCase())) ??
    (/total|сумм|score|балл/.test(cond) ? primary : null);

  // Рост N замеров подряд
  if (/(рост|раст|увелич|rise)/.test(cond) && /(подряд|замер|consecutive)/.test(cond)) {
    const num = cond.match(/(\d+)\s*замер/)?.[1];
    const periods = num ? Number(num) : /\bтри\b/.test(cond) ? 3 : 2;
    return base("rise_consecutive", mentioned ?? primary, { periods });
  }
  // Падение относительно прошлого: "X_prev - X_current >= N"
  let m = cond.match(/([a-zа-яё_]+)_prev\s*-\s*[a-zа-яё_]+_current\s*>=\s*([\d.]+)/);
  if (m) {
    const metric = m[1] === "total" ? "total" : scales.includes(m[1]) ? m[1] : mentioned ?? primary;
    return base("drop_from_prev", metric, { threshold: Number(m[2]) });
  }
  if (/(упал|падени|сниж|drop)/.test(cond)) {
    const n = cond.match(/(?:>=|на)\s*([\d.]+)/)?.[1];
    if (n) return base("drop_from_prev", mentioned ?? primary, { threshold: Number(n) });
  }
  // Порог: ">= N"
  m = cond.match(/([a-zа-яё_]+|score)\s*>=\s*([\d.]+)/);
  if (m) {
    const metric = m[1] === "score" ? primary : scales.includes(m[1]) ? m[1] : mentioned ?? primary;
    return base("threshold_high", metric, { threshold: Number(m[2]) });
  }
  return null;
}

// Чистая логика решения по правилу. history — значения метрики из ПРЕДЫДУЩИХ
// замеров, от новейшего к старому (без текущего). Тестируется без БД.
export function applyRule(
  rule: ResolvedRule,
  history: number[],
  current: number
): RuleFire | null {
  switch (rule.type) {
    // Метрика упала на >= threshold относительно прошлого замера
    case "drop_from_prev": {
      const prev = history[0];
      const threshold = rule.threshold ?? 0;
      if (prev != null && prev - current >= threshold) {
        const delta = round2(prev - current);
        return {
          details: { previous: round2(prev), current: round2(current), delta },
          vars: { prev: round2(prev), current: round2(current), delta },
        };
      }
      return null;
    }

    // Метрика растёт N замеров подряд (periods=2 → текущий > пред. > позапрош.)
    case "rise_consecutive": {
      const periods = rule.periods ?? 2;
      if (history.length < periods) return null;
      const series = history.slice(0, periods).reverse().concat(current); // старое→новое
      let rising = true;
      for (let i = 1; i < series.length; i++) {
        if (!(series[i] > series[i - 1])) rising = false;
      }
      if (!rising) return null;
      return {
        details: { series },
        vars: { series: series.join(" → "), current: round2(current) },
      };
    }

    // Метрика в высокой зоне (>= threshold)
    case "threshold_high": {
      const threshold = rule.threshold ?? 0;
      if (current >= threshold) {
        return {
          details: { current: round2(current), threshold },
          vars: { current: round2(current), threshold },
        };
      }
      return null;
    }

    default:
      return null;
  }
}

// Значения метрики из предыдущих результатов (без текущего, только что сохранённого),
// от новейшего к старому.
async function lastMetrics(
  personId: string,
  testId: string,
  metric: string,
  limit: number
): Promise<number[]> {
  const results = await prisma.result.findMany({
    where: { personId, testId },
    orderBy: { createdAt: "desc" },
    take: limit + 1, // +1, чтобы пропустить текущий замер
  });
  return results
    .slice(1, limit + 1)
    .map((r) => (r.scores as Record<string, number>)[metric])
    .filter((n): n is number => typeof n === "number");
}

function renderMessage(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) =>
    key in vars ? String(vars[key]) : `{${key}}`
  );
}

// Кому слать уведомление: руководителю человека и владельцам/HR с привязанным telegram_id.
async function notifyTelegramIds(personId: string): Promise<bigint[]> {
  const ids = new Set<bigint>();

  const person = await prisma.person.findUnique({
    where: { id: personId },
    include: { manager: true },
  });
  if (person?.manager?.telegramId) ids.add(person.manager.telegramId);

  const owners = await prisma.adminUser.findMany({
    where: { role: { in: ["owner", "hr"] }, person: { telegramId: { not: null } } },
    include: { person: true },
  });
  for (const o of owners) if (o.person?.telegramId) ids.add(o.person.telegramId);

  return [...ids];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
