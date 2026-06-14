import { InlineKeyboard, InputMediaBuilder, type Bot, type Context } from "grammy";
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

// ============ АБСТРАКЦИЯ ОТПРАВКИ ============
// Вопрос отправляется либо в ответ на действие пользователя (ctx — можно
// редактировать сообщение), либо по таймеру без ctx (через botRef.api в чат).
interface Sink {
  send(text: string, keyboard?: InlineKeyboard, markdown?: boolean): Promise<void>;
  photo(url: string, caption: string, keyboard?: InlineKeyboard): Promise<void>;
  album(items: { url: string; caption: string }[]): Promise<void>;
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

function ctxSink(ctx: Context): Sink {
  return {
    send: (text, keyboard, markdown) => present(ctx, text, keyboard, markdown),
    async photo(url, caption, keyboard) {
      await ctx.replyWithPhoto(url, { caption, reply_markup: keyboard });
    },
    async album(items) {
      await ctx.replyWithMediaGroup(
        items.map((it) => InputMediaBuilder.photo(it.url, { caption: it.caption }))
      );
    },
  };
}

function chatSink(chatId: number): Sink {
  return {
    async send(text, keyboard, markdown) {
      await botRef.api.sendMessage(chatId, text, {
        reply_markup: keyboard,
        ...(markdown ? { parse_mode: "Markdown" as const } : {}),
      });
    },
    async photo(url, caption, keyboard) {
      await botRef.api.sendPhoto(chatId, url, { caption, reply_markup: keyboard });
    },
    async album(items) {
      await botRef.api.sendMediaGroup(
        chatId,
        items.map((it) => InputMediaBuilder.photo(it.url, { caption: it.caption }))
      );
    },
  };
}

// ============ ТАЙМЕРЫ ВОПРОСОВ ============
// Авто-переход по истечении timer_seconds. Хранение в памяти процесса: при
// рестарте таймеры теряются (пользователь всё ещё может ответить вручную).
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(sessionId: string) {
  const t = timers.get(sessionId);
  if (t) {
    clearTimeout(t);
    timers.delete(sessionId);
  }
}

function scheduleTimer(sessionId: string, idx: number, seconds: number, chatId: number | null) {
  clearTimer(sessionId);
  if (!chatId || !seconds || seconds <= 0) return;
  const handle = setTimeout(() => {
    onTimeout(sessionId, idx, chatId).catch((e) => console.error("timer:", e));
  }, seconds * 1000);
  timers.set(sessionId, handle);
}

async function onTimeout(sessionId: string, idx: number, chatId: number) {
  timers.delete(sessionId);
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { assignment: { include: { test: true } } },
  });
  // Уже завершено или пользователь успел ответить и перешёл дальше — выходим.
  if (!session || session.finishedAt || session.currentQuestion !== idx) return;

  const content = contentOf(session.assignment.test);
  const q = content.questions[idx];
  const secs = q.timer_seconds ?? 0;
  // Пустой ответ-таймаут: скоринг его игнорирует (нет совпадения опции / нет значения).
  await prisma.answer.create({
    data: { sessionId, questionId: q.id, optionId: "timeout", responseMs: secs * 1000 },
  });
  const sink = chatSink(chatId);
  await sink.send("⏱ Время на ответ вышло — переходим к следующему вопросу.");
  await advance(sink, sessionId, idx, chatId);
}

const timerNote = (q: Question) =>
  q.timer_seconds ? `\n\n⏱ Ограничение: ${q.timer_seconds} сек` : "";

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
  await renderCurrent(ctxSink(ctx), session.id, ctx.chat?.id ?? null);
}

// ============ РЕНДЕР ТЕКУЩЕГО ВОПРОСА ============

async function renderCurrent(sink: Sink, sessionId: string, chatId: number | null) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { assignment: { include: { test: true } } },
  });
  if (!session) return;
  const content = contentOf(session.assignment.test);
  const idx = session.currentQuestion;

  if (idx >= content.questions.length) {
    clearTimer(sessionId);
    await finishSession(sink, sessionId);
    return;
  }

  const q = content.questions[idx];
  const type = q.type ?? content.question_type;
  const step = (session.stepState ?? {}) as StepState;
  const progress = `Вопрос ${idx + 1} из ${content.questions.length}`;

  switch (type) {
    case "likert":
      await renderLikert(sink, content, q, idx, progress);
      break;
    case "single_choice":
      await renderSingleChoice(sink, q, idx, progress);
      break;
    case "forced_pair":
      await renderForcedPair(sink, q, idx, progress);
      break;
    case "most_least":
      await renderMostLeast(sink, q, idx, progress, step);
      break;
    case "image_choice":
      await renderImageChoice(sink, q, idx, progress);
      break;
    case "numeric_scale":
      await renderNumeric(sink, q, idx, progress);
      break;
    case "free_text":
      await renderFreeText(sink, q, idx, progress, sessionId);
      break;
    default:
      await sink.send(`Неподдерживаемый тип вопроса: ${type}`);
  }

  // Таймер вопроса (если задан и известен чат). Двухшаговый most_least
  // перезапускает таймер на каждом шаге — это норм.
  scheduleTimer(sessionId, idx, q.timer_seconds ?? 0, chatId);
}

async function renderLikert(
  sink: Sink,
  content: TestContent,
  q: Question,
  idx: number,
  progress: string
) {
  const kb = new InlineKeyboard();
  for (const opt of content.options_preset ?? []) {
    kb.text(opt.label, `a:${idx}:${opt.id}`).row();
  }
  await sink.send(`${progress}\n\n${q.text}${timerNote(q)}`, kb);
}

async function renderSingleChoice(sink: Sink, q: Question, idx: number, progress: string) {
  const kb = new InlineKeyboard();
  for (const opt of q.options ?? []) {
    kb.text(opt.label, `a:${idx}:${opt.id}`).row();
  }
  await sink.send(`${progress}\n\n${q.text}${timerNote(q)}`, kb);
}

async function renderForcedPair(sink: Sink, q: Question, idx: number, progress: string) {
  const kb = new InlineKeyboard();
  for (const opt of q.options ?? []) {
    kb.text(opt.label, `a:${idx}:${opt.id}`).row();
  }
  const text = `${progress}\n\nВыберите утверждение, с которым вы больше согласны:${timerNote(q)}`;
  await sink.send(text, kb);
}

async function renderMostLeast(
  sink: Sink,
  q: Question,
  idx: number,
  progress: string,
  step: StepState
) {
  const kb = new InlineKeyboard();
  if (!step.mostId) {
    for (const opt of q.options ?? []) kb.text(opt.label, `m:${idx}:${opt.id}`).row();
    const text = `${progress}${q.prompt ? `\n${q.prompt}` : ""}\n\nЧто *больше* всего похоже на вас?${timerNote(q)}`;
    await sink.send(text, kb, true);
  } else {
    for (const opt of q.options ?? []) {
      if (opt.id === step.mostId) continue;
      kb.text(opt.label, `l:${idx}:${opt.id}`).row();
    }
    const text = `${progress}${q.prompt ? `\n${q.prompt}` : ""}\n\nА теперь — что *меньше* всего похоже на вас?`;
    await sink.send(text, kb, true);
  }
}

// image_choice: варианты-картинки. Если у всех опций есть image_url — шлём
// альбом пронумерованных картинок + клавиатуру с номерами. Если есть только
// стимул q.image_url — фото с подписью и кнопками-вариантами. Иначе — как
// single_choice (движок адаптируется к авторскому формату).
async function renderImageChoice(sink: Sink, q: Question, idx: number, progress: string) {
  const opts = q.options ?? [];
  const head = `${progress}\n\n${q.text ?? "Выберите вариант:"}${timerNote(q)}`;
  // Альбом Telegram принимает 2–10 элементов.
  const allImages =
    opts.length >= 2 && opts.length <= 10 && opts.every((o) => o.image_url);

  if (allImages) {
    await sink.album(opts.map((o, i) => ({ url: o.image_url as string, caption: `${i + 1}) ${o.label}` })));
    const kb = new InlineKeyboard();
    opts.forEach((o, i) => kb.text(String(i + 1), `a:${idx}:${o.id}`));
    await sink.send(head, kb);
  } else if (q.image_url) {
    const kb = new InlineKeyboard();
    for (const o of opts) kb.text(o.label, `a:${idx}:${o.id}`).row();
    await sink.photo(q.image_url, head, kb);
  } else {
    const kb = new InlineKeyboard();
    for (const o of opts) kb.text(o.label, `a:${idx}:${o.id}`).row();
    await sink.send(head, kb);
  }
}

async function renderNumeric(sink: Sink, q: Question, idx: number, progress: string) {
  const kb = new InlineKeyboard();
  for (let n = 0; n <= 10; n++) {
    kb.text(String(n), `a:${idx}:${n}`);
    if (n === 5) kb.row(); // 0-5 в первом ряду, 6-10 во втором
  }
  await sink.send(`${progress}\n\n${q.text}${timerNote(q)}`, kb);
}

async function renderFreeText(
  sink: Sink,
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
  await sink.send(
    `${progress}\n\n${q.text}${timerNote(q)}\n\n✍️ Напишите ответ сообщением или нажмите «Пропустить».`,
    kb
  );
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

  // Пользователь ответил вовремя — снимаем таймер вопроса.
  clearTimer(session.id);

  const content = contentOf(session.assignment.test);
  const q = content.questions[qIdx];
  const type = q.type ?? content.question_type;
  const step = (session.stepState ?? {}) as StepState;
  const responseMs = step.shownAt ? Math.max(0, Date.now() - step.shownAt) : null;
  const chatId = ctx.chat?.id ?? null;
  const sink = ctxSink(ctx);

  await ctx.answerCallbackQuery();

  if (kind === "m") {
    // most_least, шаг 1: запомнили "most", показываем "least"
    await prisma.session.update({
      where: { id: session.id },
      data: { stepState: { shownAt: step.shownAt, mostId: optId } },
    });
    await renderCurrent(sink, session.id, chatId);
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
    await advance(sink, session.id, qIdx, chatId);
    return;
  }

  if (kind === "skip") {
    await prisma.answer.create({
      data: { sessionId: session.id, questionId: q.id, optionId: "skip", responseMs },
    });
    await advance(sink, session.id, qIdx, chatId);
    return;
  }

  // kind === 'a' — likert / single_choice / forced_pair / image_choice / numeric_scale
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
  await advance(sink, session.id, qIdx, chatId);
}

export async function handleText(ctx: Context) {
  const session = await getActiveSession(ctx);
  if (!session) return; // не в процессе теста — игнорируем обычный текст
  const step = (session.stepState ?? {}) as StepState;
  if (!step.awaitingText) return;

  clearTimer(session.id);

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
  await advance(ctxSink(ctx), session.id, qIdx, ctx.chat?.id ?? null);
}

async function advance(sink: Sink, sessionId: string, fromIdx: number, chatId: number | null) {
  clearTimer(sessionId);
  await prisma.session.update({
    where: { id: sessionId },
    data: { currentQuestion: fromIdx + 1, stepState: { shownAt: Date.now() } },
  });
  await renderCurrent(sink, sessionId, chatId);
}

// ============ ЗАВЕРШЕНИЕ ============

async function finishSession(sink: Sink, sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      answers: true,
      assignment: { include: { test: true, person: true } },
    },
  });
  if (!session || session.finishedAt) return;
  clearTimer(sessionId);

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
  await sink.send(text);

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
  await renderCurrent(ctxSink(ctx), session.id, ctx.chat?.id ?? null);
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
