import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/client";

const prisma = new PrismaClient();

// Папка с JSON-контентом тестов. Переопределяется CONTENT_DIR (в Docker — /app/content).
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CONTENT_DIR =
  process.env.CONTENT_DIR ?? resolve(__dirname, "../../../content");

const MVP_TESTS = ["uwes9", "pss10", "enps", "gerchikov", "rotter", "disc"];

// Категория по коду теста (раздел 8 ТЗ). Авторские JSON поле category не содержат,
// поэтому маппим здесь, а не дефолтим всё в "monitoring".
const CATEGORY_BY_CODE: Record<string, string> = {
  gerchikov: "candidate",
  rotter: "candidate",
  disc: "typing",
  tki: "typing",
  spiral: "typing",
  bigfive: "deep",
  paei: "deep",
  schein: "deep",
  uwes9: "monitoring",
  pss10: "monitoring",
  mbi: "monitoring",
  enps: "monitoring",
};

async function seedTests() {
  const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".json"));
  console.log(`📦 Контент-файлы из ${CONTENT_DIR}: ${files.join(", ") || "—"}`);

  for (const file of files) {
    const raw = readFileSync(join(CONTENT_DIR, file), "utf-8");
    const content = JSON.parse(raw);
    const code: string = content.code ?? file.replace(/\.json$/, "");

    // Обработка data-driven полей: правила алертов и анонимность по умолчанию.
    // Контент хранится целиком в tests.content, бот читает alert_rules оттуда.
    const alertRules: Array<{ code: string }> = Array.isArray(content.alert_rules)
      ? content.alert_rules
      : [];
    const defaultAnonymous = content.default_anonymous === true;
    for (const r of alertRules) {
      if (!r.code) console.warn(`  ⚠ ${code}: alert_rule без поля code`);
    }

    await prisma.test.upsert({
      where: { code },
      update: {
        title: content.title,
        description: content.description ?? null,
        category: content.category ?? CATEGORY_BY_CODE[code] ?? "monitoring",
        estimatedMinutes: content.estimated_minutes ?? null,
        content,
        // версию повышаем при каждом обновлении контента
        version: { increment: 1 },
      },
      create: {
        code,
        title: content.title,
        description: content.description ?? null,
        category: content.category ?? CATEGORY_BY_CODE[code] ?? "monitoring",
        estimatedMinutes: content.estimated_minutes ?? null,
        content,
        isActive: true,
        version: 1,
      },
    });
    console.log(
      `  ✓ тест ${code} — ${content.title}` +
        ` [алертов: ${alertRules.length}${defaultAnonymous ? ", анонимный" : ""}]`
    );
  }

  const missing = MVP_TESTS.filter((c) => !files.some((f) => f.startsWith(c)));
  if (missing.length) {
    console.warn(`  ⚠ нет JSON для MVP-тестов: ${missing.join(", ")}`);
  }
}

async function seedOwner() {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password) {
    console.warn("  ⚠ OWNER_EMAIL/OWNER_PASSWORD не заданы — владелец не создан");
    return;
  }
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`  ✓ владелец ${email} уже существует`);
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.adminUser.create({
    data: { email, passwordHash, role: "owner" },
  });
  console.log(`  ✓ создан владелец админки: ${email}`);
}

async function seedDemoDepartment() {
  // Демонстрационное подразделение, чтобы было куда класть людей на старте.
  const count = await prisma.department.count();
  if (count === 0) {
    await prisma.department.create({ data: { name: "Компания" } });
    console.log("  ✓ создано подразделение «Компания»");
  }
}

async function main() {
  console.log("🌱 Сидирование БД…");
  await seedTests();
  await seedOwner();
  await seedDemoDepartment();
  console.log("✅ Готово.");
}

main()
  .catch((e) => {
    console.error("❌ Ошибка сида:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
