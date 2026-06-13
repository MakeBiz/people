import { randomBytes } from "node:crypto";
import { prisma } from "@hr/db";
import type { Bot } from "grammy";

// Планировщик кампаний мониторинга (Этап 2): автоназначение по расписанию +
// автонапоминания непрошедшим. Работает внутри бота (он всегда онлайн).

const TICK_MS = 5 * 60 * 1000; // тик каждые 5 минут (run-now применится в пределах тика)
const REMIND_AFTER_MS = 3 * 24 * 3600 * 1000; // напоминать, если открыто > 3 дней

const PERIOD_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

function addPeriod(from: Date, schedule: string): Date {
  const months = PERIOD_MONTHS[schedule] ?? 1;
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

function deepLink(token: string): string {
  const username = process.env.BOT_USERNAME ?? "your_bot";
  return `https://t.me/${username}?start=${token}`;
}

async function sendInvite(bot: Bot, tgId: bigint, title: string, token: string, reminder = false) {
  const link = deepLink(token);
  const text = reminder
    ? `🔔 Напоминание: вас ждёт короткий опрос «${title}». Пройдите, пожалуйста: ${link}`
    : `📋 Вам назначен опрос «${title}». Пройдите по ссылке: ${link}`;
  try {
    await bot.api.sendMessage(tgId.toString(), text);
  } catch (e) {
    console.error(`Не удалось отправить приглашение в Telegram ${tgId}:`, e);
  }
}

// --- Автоназначение по наступившим кампаниям ---
export async function runDueCampaigns(bot: Bot): Promise<void> {
  const now = new Date();
  const due = await prisma.campaign.findMany({
    where: { isActive: true, nextRunAt: { not: null, lte: now } },
    include: { test: true },
  });

  for (const c of due) {
    const people = await prisma.person.findMany({
      where: {
        status: { in: ["employee", "candidate"] },
        ...(c.departmentId ? { departmentId: c.departmentId } : {}),
      },
    });

    let assigned = 0;
    for (const p of people) {
      // не дублируем: пропускаем, если по этому тесту уже есть открытое назначение
      const open = await prisma.assignment.findFirst({
        where: { personId: p.id, testId: c.testId, status: { in: ["pending", "in_progress"] } },
      });
      if (open) continue;

      const token = randomBytes(9).toString("base64url");
      await prisma.assignment.create({
        data: {
          personId: p.id,
          testId: c.testId,
          status: "pending",
          isAnonymous: c.isAnonymous,
          inviteToken: token,
          departmentId: p.departmentId,
        },
      });
      assigned++;
      if (p.telegramId) await sendInvite(bot, p.telegramId, c.test.title, token);
    }

    // сдвигаем следующий запуск на период
    await prisma.campaign.update({
      where: { id: c.id },
      data: { nextRunAt: addPeriod(c.nextRunAt ?? now, c.schedule) },
    });
    console.log(`📅 Кампания «${c.test.title}» (${c.schedule}): назначено ${assigned}`);
  }
}

// --- Автонапоминания непрошедшим ---
export async function sendReminders(bot: Bot): Promise<void> {
  const cutoff = new Date(Date.now() - REMIND_AFTER_MS);
  const open = await prisma.assignment.findMany({
    where: {
      status: { in: ["pending", "in_progress"] },
      person: { telegramId: { not: null } },
      OR: [{ remindedAt: null, createdAt: { lt: cutoff } }, { remindedAt: { lt: cutoff } }],
    },
    include: { test: true, person: true },
    take: 200,
  });

  for (const a of open) {
    if (!a.person?.telegramId) continue;
    await sendInvite(bot, a.person.telegramId, a.test.title, a.inviteToken, true);
    await prisma.assignment.update({ where: { id: a.id }, data: { remindedAt: new Date() } });
  }
}

export function startScheduler(bot: Bot): void {
  const tick = async () => {
    try {
      await runDueCampaigns(bot);
      await sendReminders(bot);
    } catch (e) {
      console.error("Ошибка планировщика:", e);
    }
  };
  void tick(); // прогон при старте
  setInterval(() => void tick(), TICK_MS);
  console.log(`⏰ Планировщик кампаний запущен (тик каждые ${TICK_MS / 60000} мин)`);
}
