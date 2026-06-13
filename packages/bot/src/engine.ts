import { InlineKeyboard, type Bot, type Context } from "grammy";
import { prisma } from "@hr/db";
import type { TestContent, Question } from "@hr/db";
import { score, type RawAnswer } from "./scoring.js";
import { evaluateAndNotify } from "./alerts.js";
import { makeEmployeeSummary, rebuildPersonProfile } from "./generate.js";
import {
  CONSENT_TEXT,
  DECLINED_TEXT,
  NO_ASSIGNMENT_TEXT,
  ALREADY_COMPLETED_TEXT,
  NO_TESTS_TEXT,
} from "./text.js";

let botRef: Bot;
export function initEngine(bot: Bot) {
  botRef = bot;
}

interface StepState {
  shownAt?: number;
  mostId?: string;
  awaitingText?: boolean;
}

function contentOf(test: { content: unknown }): TestContent {
  return test.content as TestContent;
}

// Показать сообщение: при callback — редактируем то же сообщение (чат не растёт),
// иначе отправляем новое.
async function present(ctx: Context, text: string, keyboard?: InlineKeyboard, markdown = false) {
  const opts = {
    reply_markup: keyboard,
    ...(markdown ? { parse_mode: "Markdown" as const } : {}),
  };
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, opts);
      return;
    } catch {
      // сообщение слишком старое/не изменилось — отправим новое
    }
  }
  await ctx.reply(text, opts);
}

// ============ ВХОД ============

export async function handleStart(ctx: Context, token: string | undefined) {
  if (!token) {
    await handleMyTests(ctx);
    return;
  }

  const assignment = await prisma.assignment.findUnique({
    where: { inviteToken: token },
    include: { test: true, person: true },
  });

  if (!assignment) {
    await ctx.reply(NO_ASSIGNMENT_TEXT);
    return;
  }
  if (assignment.status === "completed") {
    await ctx.reply(ALREADY_COMPLETED_TEXT);
    return;
  }

  // Привязка telegram_id к person при первом входе
  let person = assignment.person;
  if (person && person.telegramId == null && ctx.from) {
    person = await prisma.person.update({
      where: { id: person.id },
      data: { telegramId: BigInt(ctx.from.id) },
    });
  }

  // Согласие на ПДн обязательно до первого теста
  if (person && !person.consentGivenAt) {
    const kb = new InlineKeyboard()
      .text("✅ Согласен", `cs:y:${assignment.id}`)
      .text("❌ Отказаться", `cs:n:${assignment.id}`);
    await present(ctx, CONSENT_TEXT, kb, true);
    return;
  }

  await showIntro(ctx, assignment.id);
}

export async function handleConsent(ctx: Context, agree: boolean, assignmentId: string) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { person: true },
  });
  if (!assignment?.person) {
    await ctx.answerCallbackQuery();
    return;
  }

  if (!agree) {
    await prisma.person.update({
      where: { id: assignment.person.id },
      data: { consentDeclined: true },
    });
    await present(ctx, DECLINED_TEXT);
    await ctx.answerCallbackQuery();
    return;
  }

  await prisma.person.update({
    where: { id: assignment.person.id },
    data: { consentGivenAt: new Date(), consentDeclined: false },
  });
  await ctx.answerCallbackQuery("Спасибо!");
  await showIntro(ctx, assignmentId);
}

async function showIntro(ctx: Context, assignmentId: string) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { test: true, sessions: { orderBy: { startedAt: "desc" }, take: 1 } },
  });
  if (!assignment) return;
  const content = contentOf(assignment.test);

  const existing = assignment.sessions[0];
  const resuming = existing && !existing.finishedAt && existing.currentQuestion > 0;

  const minutes = assignment.test.estimatedMinutes;
  const text =
    `📋 ${content.title}\n` +
    (minutes ? `⏱ ~${minutes} мин\n` : "") +
    `\n${content.intro}`;

  const kb = new InlineKeyboard().text(
    resuming ? "▶️ Продолжить" : "▶️ Начать",
    `go:${assignment.id}`
  );
  await present(ctx, text, kb);
}

// ============ СТАРТ ПРОХОЖДЕНИЯ ============

export async function handleBegin(ctx: Context, assignmentId: string) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { sessions: { orderBy: { startedAt: "desc" }, take: 1 } },
  });
  if (!assignment) {
    await ctx.answerCallbackQuery();
    return;
  }

  let session = assignment.sessions.find((s) => !s.finishedAt);
  if (!session) {
    session = await prisma.session.create({
      data: { assignmentId: assignment.id, currentQuestion: 0, stepState: { shownAt: Date.now() } },
    });
    await prisma.assignment.update({
      where: { id: assignment.id },
      data: { status: "in_progress" },
    });
  } else if (session.currentQuestion > 0) {
    // возврат к начатому тесту — метрика прерываний (раздел 5 спеки)
    await prisma.session.update({
      where: { id: session.id },
      data: { resumeCount: { increment: 1 } },
    });
  }
  await ctx.answerCallbackQuery();
  await renderCurrent(ctx, session.id);
}

// ============ РЕНДЕР ТЕКУЩЕГО ВОПРОСА ============

async function renderCurrent(ctx: Context, sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { assignment: { include: { test: true } } },
  });
  if (!session) return;
  const content = contentOf(session.assignment.test);
  const idx = session.currentQuestion;

  if (idx >= content.questions.length) {
    await finishSession(ctx, sessionId);
    return;
  }

  const q = content.questions[idx];
  const type = q.type ?? content.question_type;
  const step = (session.stepState ?? {}) as StepState;
  const progress = `Вопрос ${idx + 1} из ${content.questions.length}`;

  switch (type) {
    case "likert":
      await renderLikert(ctx, content, q, idx, progress);
      break;
    case "single_choice":
      await renderSingleChoice(ctx, q, idx, progress);
      break;
    case "forced_pair":
      await renderForcedPair(ctx, q, idx, progress);
      break;
    case "most_least":
      await renderMostLeast(ctx, q, idx, progress, step);
      break;
    case "numeric_scale":
      await renderNumeric(ctx, q, idx, progress);
      break;
    case "free_text":
      await renderFreeText(ctx, q, idx, progress, sessionId);
      break;
    default:
      await present(ctx, `Неподдерживаемый тип вопроса: ${type}`);
  }
}

async function renderLikert(
  ctx: Context,
  content: TestContent,
  q: Question,
  idx: number,
  progress: string
) {
  const kb = new InlineKeyboard();
  for (const opt of content.options_preset ?? []) {
    kb.text(opt.label, `a:${idx}:${opt.id}`).row();
  }
  await present(ctx, `${progress}\n\n${q.text}`, kb);
}

async function renderSingleChoice(ctx: Context, q: Question, idx: number, progress: string) {
  const kb = new InlineKeyboard();
  for (const opt of q.options ?? []) {
    kb.text(opt.label, `a:${idx}:${opt.id}`).row();
  }
  await present(ctx, `${progress}\n\n${q.text}`, kb);
}

async function renderForcedPair(ctx: Context, q: Question, idx: number, progress: string) {
  const kb = new InlineKeyboard();
  for (const opt of q.options ?? []) {
    kb.text(opt.label, `a:${idx}:${opt.id}`).row();
  }
  const text = `${progress}\n\nВыберите утверждение, с которым вы больше согласны:`;
  await present(ctx, text, kb);
}

async function renderMostLeast(
  ctx: Context,
  q: Question,
  idx: number,
  progress: string,
  step: StepState
) {
  const kb = new InlineKeyboard();
  if (!step.mostId) {
    for (const opt of q.options ?? []) kb.text(opt.label, `m:${idx}:${opt.id}`).row();
    const text = `${progress}${q.prompt ? `\n${q.prompt}` : ""}\n\nЧто *больше* всего похоже на вас?`;
    await present(ctx, text, kb, true);
  } else {
    for (const opt of q.options ?? []) {
      if (opt.id === step.mostId) continue;
      kb.text(opt.label, `l:${idx}:${opt.id}`).row();
    }
    const text = `${progress}${q.prompt ? `\n${q.prompt}` : ""}\n\nА теперь — что *меньше* всего похоже на вас?`;
    await present(ctx, text, kb, true);
  }
}

async function renderNumeric(ctx: Context, q: Question, idx: number, progress: string) {
  const kb = new InlineKeyboard();
  for (let n = 0; n <= 10; n++) {
    kb.text(String(n), `a:${idx}:${n}`);
    if (n === 5) kb.row(); // 0-5 в первом ряду, 6-10 во втором
  }
  await present(ctx, `${progress}\n\n${q.text}`, kb);
}

async function renderFreeText(
  ctx: Context,
  q: Question,
  idx: number,
  progress: string,
  sessionId: string
) {
  await prisma.session.update({
    where: { id: sessionId },
    data: { stepState: { shownAt: Date.now(), awaitingText: true } },
  });
  const kb = new InlineKeyboard().text("Пропустить", `skip:${idx}`);
  await present(ctx, `${progress}\n\n${q.text}\n\n✍️ Напишите ответ сообщением или нажмите «Пропустить».`, kb);
}

// ============ ОБРАБОТКА ОТВЕТОВ ============

export async function handleAnswerCallback(ctx: Context, data: string) {
  const [kind, idxStr, ...rest] = data.split(":");
  const optId = rest.join(":");
  const qIdx = Number(idxStr);

  const session = await getActiveSession(ctx);
  if (!session) {
    await ctx.answerCallbackQuery("Сессия не найдена. Откройте ссылку заново.");
    return;
  }
  // Защита от устаревших кнопок
  if (qIdx !== session.currentQuestion) {
    await ctx.answerCallbackQuery();
    return;
  }

  const content = contentOf(session.assignment.test);
  const q = content.questions[qIdx];
  const type = q.type ?? content.question_type;
  const step = (session.stepState ?? {}) as StepState;
  const responseMs = step.shownAt ? Math.max(0, Date.now() - step.shownAt) : null;

  await ctx.answerCallbackQuery();

  if (kind === "m") {
    // most_least, шаг 1: запомнили "most", показываем "least"
    await prisma.session.update({
      where: { id: session.id },
      data: { stepState: { shownAt: step.shownAt, mostId: optId } },
    });
    await renderCurrent(ctx, session.id);
    return;
  }

  if (kind === "l") {
    // most_least, шаг 2: пишем оба ответа блока
    await prisma.answer.createMany({
      data: [
        { sessionId: session.id, questionId: q.id, optionId: `most:${step.mostId}`, responseMs },
        { sessionId: session.id, questionId: q.id, optionId: `least:${optId}`, responseMs },
      ],
    });
    await advance(ctx, session.id, qIdx);
    return;
  }

  if (kind === "skip") {
    await prisma.answer.create({
      data: { sessionId: session.id, questionId: q.id, optionId: "skip", responseMs },
    });
    await advance(ctx, session.id, qIdx);
    return;
  }

  // kind === 'a' — likert / single_choice / forced_pair / numeric_scale
  let answerValue: number | null = null;
  if (type === "likert") {
    const opt = content.options_preset?.find((o) => o.id === optId);
    answerValue = opt?.value ?? null;
  } else if (type === "numeric_scale") {
    answerValue = Number(optId);
  }
  await prisma.answer.create({
    data: { sessionId: session.id, questionId: q.id, optionId: optId, answerValue, responseMs },
  });
  await advance(ctx, session.id, qIdx);
}

export async function handleText(ctx: Context) {
  const session = await getActiveSession(ctx);
  if (!session) return; // не в процессе теста — игнорируем обычный текст
  const step = (session.stepState ?? {}) as StepState;
  if (!step.awaitingText) return;

  const content = contentOf(session.assignment.test);
  const qIdx = session.currentQuestion;
  const q = content.questions[qIdx];
  const responseMs = step.shownAt ? Math.max(0, Date.now() - step.shownAt) : null;

  await prisma.answer.create({
    data: {
      sessionId: session.id,
      questionId: q.id,
      optionId: (ctx.message?.text ?? "").slice(0, 2000),
      responseMs,
    },
  });
  await advance(ctx, session.id, qIdx);
}

async function advance(ctx: Context, sessionId: string, fromIdx: number) {
  await prisma.session.update({
    where: { id: sessionId },
    data: { currentQuestion: fromIdx + 1, stepState: { shownAt: Date.now() } },
  });
  await renderCurrent(ctx, sessionId);
}

// ============ ЗАВЕРШЕНИЕ ============

async function finishSession(ctx: Context, sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      answers: true,
      assignment: { include: { test: true, person: true } },
    },
  });
  if (!session || session.finishedAt) return;

  const content = contentOf(session.assignment.test);
  const raw: RawAnswer[] = session.answers.map((a) => ({
    questionId: a.questionId,
    optionId: a.optionId,
    answerValue: a.answerValue,
    responseMs: a.responseMs,
  }));

  const result = score(content, raw);

  const isAnon = session.assignment.isAnonymous;
  const personId = isAnon ? null : session.assignment.personId;
  const departmentId = isAnon
    ? session.assignment.departmentId
    : session.assignment.person?.departmentId ?? null;

  // Метрики прохождения (раздел 5 спеки) — длительность и среднее время ответа.
  const durationSeconds = Math.round((Date.now() - session.startedAt.getTime()) / 1000);
  const respTimes = session.answers
    .map((a) => a.responseMs)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const avgResponseMs = respTimes.length
    ? Math.round(respTimes.reduce((s, v) => s + v, 0) / respTimes.length)
    : null;

  const created = await prisma.result.create({
    data: {
      sessionId: session.id,
      personId,
      testId: session.assignment.testId,
      departmentId,
      scores: result.scores,
      interpretation: result.interpretation,
      validityFlag: result.validityFlag,
    },
  });
  await prisma.$transaction([
    prisma.session.update({
      where: { id: session.id },
      data: { finishedAt: new Date(), durationSeconds, avgResponseMs },
    }),
    prisma.assignment.update({
      where: { id: session.assignment.id },
      data: { status: "completed" },
    }),
  ]);

  // Алерты для персональных (не анонимных) прохождений: правила берутся из
  // content.alert_rules, плюс встроенная проверка валидности (invalid_session).
  if (!isAnon && personId) {
    await evaluateAndNotify({
      bot: botRef,
      personId,
      personName: session.assignment.person?.fullName ?? "сотрудник",
      departmentId,
      testId: session.assignment.testId,
      testCode: content.code,
      scores: result.scores,
      alertRules: content.alert_rules ?? [],
      scoring: content.scoring,
      validityFlag: result.validityFlag,
    });
  }

  // Тёплое резюме сотруднику (промт 1/1-М). Только для персональных прохождений.
  let summary: string | null = null;
  if (!isAnon && personId) {
    const firstName = (session.assignment.person?.fullName ?? "").split(/\s+/)[0] || "коллега";
    summary = await makeEmployeeSummary({
      category: session.assignment.test.category,
      title: content.title,
      scores: result.scores,
      employeeBlocks: result.interpretation.map((i) => i.text),
      firstName,
      highDistress: isHighDistress(content.code, result.scores),
    });
    if (summary) {
      await prisma.result.update({ where: { id: created.id }, data: { employeeSummary: summary } });
    }
  }

  // Показ: тёплый текст LLM, иначе — детерминированный outro (graceful degradation).
  let text = `✅ ${content.outro}`;
  if (summary) {
    text = `✅ ${content.outro}\n\n${summary}`;
  } else if (content.show_result_to_respondent && result.interpretation.length) {
    text += "\n\nВаш результат:\n" + result.interpretation.map((i) => `• ${i.text}`).join("\n");
  }
  await present(ctx, text);

  // Пересборка накопительного профиля-анамнеза (промт 2) — после показа сотруднику,
  // чтобы он не ждал. Сохраняется снимок с версией для карточки руководителя.
  if (!isAnon && personId) {
    await rebuildPersonProfile(personId).catch((e) => console.error("rebuildProfile:", e));
  }
}

// high_distress для промта 1-М: тревожные показатели мониторинга (раздел 1 спеки).
function isHighDistress(code: string, scores: Record<string, number>): boolean {
  if (code === "pss10") return (scores.stress ?? 0) >= 27;
  if (code === "mbi") return (scores.exhaustion ?? 0) >= 27;
  if (code === "uwes9") return (scores.total ?? 99) <= 2.5;
  return false;
}

// ============ ВСПОМОГАТЕЛЬНОЕ ============

async function getActiveSession(ctx: Context) {
  if (!ctx.from) return null;
  const person = await prisma.person.findUnique({
    where: { telegramId: BigInt(ctx.from.id) },
  });
  if (!person) return null;
  return prisma.session.findFirst({
    where: {
      finishedAt: null,
      assignment: { personId: person.id },
    },
    orderBy: { startedAt: "desc" },
    include: { assignment: { include: { test: true } } },
  });
}

// /continue и /mytests
export async function handleContinue(ctx: Context) {
  const session = await getActiveSession(ctx);
  if (!session) {
    await ctx.reply("У вас нет незавершённых тестов.");
    return;
  }
  await prisma.session.update({
    where: { id: session.id },
    data: { resumeCount: { increment: 1 } },
  });
  await renderCurrent(ctx, session.id);
}

export async function handleMyTests(ctx: Context) {
  if (!ctx.from) return;
  const person = await prisma.person.findUnique({
    where: { telegramId: BigInt(ctx.from.id) },
    include: {
      assignments: { include: { test: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!person || person.assignments.length === 0) {
    await ctx.reply(NO_TESTS_TEXT);
    return;
  }
  const lines = person.assignments.map((a) => {
    const mark =
      a.status === "completed" ? "✅" : a.status === "in_progress" ? "▶️" : "🕒";
    return `${mark} ${a.test.title} — ${statusRu(a.status)}`;
  });
  await ctx.reply(`Ваши тесты:\n\n${lines.join("\n")}\n\nПродолжить незавершённый: /continue`);
}

function statusRu(status: string): string {
  return (
    { pending: "ожидает", in_progress: "в процессе", completed: "пройден", expired: "истёк" }[
      status
    ] ?? status
  );
}
