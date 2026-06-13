import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@hr/db";
import {
  EMPLOYEE_TYPING,
  EMPLOYEE_MONITORING,
  MANAGER_PROFILE,
  render,
} from "./prompts.js";

// Спека прямо указывает Claude Sonnet (баланс цены/качества) + низкую температуру.
const MODEL = "claude-sonnet-4-6";
const TEMPERATURE = 0.4;

// Без ANTHROPIC_API_KEY модуль молча отключается (graceful degradation):
// бот покажет детерминированный outro, карточка — слотовую сводку как раньше.
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
export const isLLMEnabled = () => client !== null;

async function callClaude(system: string, user: string, maxTokens = 1024): Promise<string | null> {
  if (!client) return null;
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      temperature: TEMPERATURE,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch (e) {
    console.error("Claude API error:", e);
    return null;
  }
}

// ============ Промт 1 / 1-М: тёплое резюме сотруднику ============
export async function makeEmployeeSummary(p: {
  category: string;
  title: string;
  scores: Record<string, number>;
  employeeBlocks: string[];
  firstName: string;
  highDistress: boolean;
}): Promise<string | null> {
  // Мониторинг → благодарность без баллов (+ мягкий намёк при high_distress).
  if (p.category === "monitoring") {
    const user = render(EMPLOYEE_MONITORING.user, {
      test_title: p.title,
      high_distress: p.highDistress ? "true" : "false",
      first_name: p.firstName,
    });
    return callClaude(EMPLOYEE_MONITORING.system, user, 512);
  }
  // Типирование/личность → тёплое резюме про сильные стороны.
  const user = render(EMPLOYEE_TYPING.user, {
    test_title: p.title,
    scores: JSON.stringify(p.scores),
    employee_blocks: p.employeeBlocks.join("; ") || "—",
    first_name: p.firstName,
  });
  return callClaude(EMPLOYEE_TYPING.system, user, 700);
}

// ============ Промт 2: накопительный профиль руководителю (анамнез) ============
// Пересобирает профиль по ВСЕМ пройденным тестам человека и сохраняет снимок с версией.
export async function rebuildPersonProfile(personId: string): Promise<void> {
  if (!client) return;

  const person = await prisma.person.findUnique({
    where: { id: personId },
    include: { department: true },
  });
  if (!person) return;

  const results = await prisma.result.findMany({
    where: { personId },
    include: { test: true },
    orderBy: { createdAt: "desc" },
  });
  if (!results.length) return;

  // Последний результат по каждому тесту + вся история (для динамики)
  const latestByTest = new Map<string, (typeof results)[number]>();
  const historyByTest = new Map<string, typeof results>();
  for (const r of results) {
    if (!latestByTest.has(r.testId)) latestByTest.set(r.testId, r);
    const arr = historyByTest.get(r.testId) ?? [];
    arr.push(r);
    historyByTest.set(r.testId, arr);
  }
  const latest = [...latestByTest.values()];

  const allResults = latest
    .map((r) => `${r.test.title}: ${JSON.stringify(r.scores)}`)
    .join("\n");
  const managerBlocks = latest
    .flatMap((r) =>
      ((r.interpretation as Array<{ text: string }>) ?? []).map((i) => `[${r.test.title}] ${i.text}`)
    )
    .join("\n");
  const dynamics = buildDynamics(historyByTest) || "нет данных (тесты проходились по одному разу)";

  const text = await callClaude(
    MANAGER_PROFILE.system,
    render(MANAGER_PROFILE.user, {
      full_name: person.fullName,
      position: person.position ?? "—",
      department: person.department?.name ?? "—",
      all_results_with_scores: allResults,
      manager_blocks: managerBlocks || "—",
      dynamics,
    }),
    2048
  );
  if (!text) return;

  const last = await prisma.personProfile.findFirst({
    where: { personId },
    orderBy: { version: "desc" },
  });
  await prisma.personProfile.create({
    data: {
      personId,
      managerText: text,
      basedOnResultIds: latest.map((r) => r.id),
      version: (last?.version ?? 0) + 1,
    },
  });
}

// ============ Динамика (раздел 6 спеки): разная рамка по типу теста ============
// Мониторинг — «лучше/хуже» с направлением; типирование — «изменилось/стабильно».
const MONITORING_METRICS: Record<string, { label: string; metric: string; higherIsBetter: boolean }> = {
  uwes9: { label: "Вовлечённость", metric: "total", higherIsBetter: true },
  pss10: { label: "Стресс", metric: "stress", higherIsBetter: false },
  mbi: { label: "Истощение (MBI)", metric: "exhaustion", higherIsBetter: false },
};

function buildDynamics(historyByTest: Map<string, Array<{ scores: unknown; test: { code: string; title: string; category: string } }>>): string {
  const lines: string[] = [];
  for (const history of historyByTest.values()) {
    if (history.length < 2) continue;
    const [cur, prev] = history; // desc: cur=новейший, prev=предыдущий
    const code = cur.test.code;
    const mon = MONITORING_METRICS[code];
    if (mon) {
      const c = (cur.scores as Record<string, number>)[mon.metric];
      const p = (prev.scores as Record<string, number>)[mon.metric];
      if (typeof c === "number" && typeof p === "number" && c !== p) {
        const rising = c > p;
        const good = rising === mon.higherIsBetter;
        const word = rising ? "рост" : "снижение";
        lines.push(`${mon.label}: ${p} → ${c} (${word}${good ? ", в плюс" : ", в минус"})`);
      }
    } else {
      // типирование: сменилась ли ведущая шкала (нейтральная рамка)
      const curDom = dominantScale(cur.scores as Record<string, number>);
      const prevDom = dominantScale(prev.scores as Record<string, number>);
      if (curDom && prevDom && curDom !== prevDom) {
        lines.push(`${cur.test.title}: ведущая шкала сменилась ${prevDom} → ${curDom} (изменение, стоит пересмотреть подход)`);
      } else if (curDom) {
        lines.push(`${cur.test.title}: профиль стабилен (ведущая шкала ${curDom})`);
      }
    }
  }
  return lines.join("\n");
}

function dominantScale(scores: Record<string, number>): string | null {
  let top: string | null = null;
  let max = -Infinity;
  for (const [k, v] of Object.entries(scores)) {
    if (k === "total") continue;
    if (typeof v === "number" && v > max) {
      max = v;
      top = k;
    }
  }
  return top;
}
