import "dotenv/config";
import { Bot, webhookCallback } from "grammy";
import { createServer } from "node:http";
import {
  initEngine,
  handleStart,
  handleConsent,
  handleBegin,
  handleAnswerCallback,
  handleText,
  handleContinue,
  handleMyTests,
} from "./engine.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN не задан");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);
initEngine(bot);

// Меню команд в Telegram
await bot.api.setMyCommands([
  { command: "start", description: "Начать / открыть приглашение" },
  { command: "mytests", description: "Мои тесты" },
  { command: "continue", description: "Продолжить незавершённый тест" },
]);

// --- Команды ---
bot.command("start", async (ctx) => {
  const token = ctx.match?.trim() || undefined;
  await handleStart(ctx, token);
});
bot.command("mytests", handleMyTests);
bot.command("continue", handleContinue);

// --- Колбэки кнопок ---
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  try {
    if (data.startsWith("cs:")) {
      const [, yn, assignmentId] = data.split(":");
      await handleConsent(ctx, yn === "y", assignmentId);
    } else if (data.startsWith("go:")) {
      await handleBegin(ctx, data.slice(3));
    } else if (/^(a|m|l|skip):/.test(data)) {
      await handleAnswerCallback(ctx, data);
    } else {
      await ctx.answerCallbackQuery();
    }
  } catch (e) {
    console.error("Ошибка обработки callback:", e);
    try {
      await ctx.answerCallbackQuery("Произошла ошибка, попробуйте ещё раз.");
    } catch {
      /* ignore */
    }
  }
});

// --- Свободный текст (free_text-вопросы) ---
bot.on("message:text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return; // команды уже обработаны выше
  try {
    await handleText(ctx);
  } catch (e) {
    console.error("Ошибка обработки текста:", e);
  }
});

bot.catch((err) => {
  console.error("Bot error:", err.error);
});

// --- Запуск: polling или webhook ---
const mode = process.env.BOT_MODE ?? "polling";

if (mode === "webhook") {
  const port = Number(process.env.PORT ?? 8080);
  const secret = process.env.BOT_WEBHOOK_SECRET;
  const handle = webhookCallback(bot, "http", { secretToken: secret });

  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/webhook") {
      try {
        await handle(req, res);
      } catch (e) {
        console.error("Webhook error:", e);
        res.statusCode = 500;
        res.end();
      }
    } else if (req.url === "/health") {
      res.statusCode = 200;
      res.end("ok");
    } else {
      res.statusCode = 404;
      res.end();
    }
  });

  const url = process.env.BOT_WEBHOOK_URL;
  if (url) {
    await bot.api.setWebhook(`${url.replace(/\/$/, "")}/webhook`, {
      secret_token: secret,
    });
    console.log(`✅ Webhook установлен: ${url}/webhook`);
  }
  server.listen(port, () => console.log(`🤖 Бот (webhook) слушает :${port}`));
} else {
  await bot.api.deleteWebhook().catch(() => {});
  console.log("🤖 Бот запущен (polling)");
  await bot.start();
}
