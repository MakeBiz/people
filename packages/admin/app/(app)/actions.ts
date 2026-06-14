"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getScope, isPrivileged } from "@/lib/access";
import { generateInviteToken } from "@/lib/tokens";
import { validateTestContent } from "@/lib/validate-test";

// Гейт для действий уровня компании (создание людей/отделов/кампаний/тестов).
// UI прячет кнопки, но сервер-экшен — последний рубеж: без этой проверки
// manager мог бы вызвать действие напрямую.
async function assertPrivileged(): Promise<boolean> {
  const session = await auth();
  return isPrivileged(session?.user.role);
}

// Optional-селекты в Radix используют сентинел "none" вместо пустой строки.
function optField(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v && v !== "none" ? v : null;
}

export async function createPerson(formData: FormData) {
  if (!(await assertPrivileged())) return;
  const fullName = String(formData.get("fullName") ?? "").trim();
  if (!fullName) return;
  const status = String(formData.get("status") ?? "candidate");
  const position = String(formData.get("position") ?? "").trim() || null;
  const departmentId = optField(formData, "departmentId");
  const managerId = optField(formData, "managerId");

  await prisma.person.create({
    data: { fullName, status, position, departmentId, managerId },
  });
  revalidatePath("/people");
}

export async function createDepartment(formData: FormData) {
  if (!(await assertPrivileged())) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const parentId = optField(formData, "parentId");
  await prisma.department.create({ data: { name, parentId } });
  revalidatePath("/settings");
}

export async function createAssignment(formData: FormData) {
  const session = await auth();
  const personId = String(formData.get("personId") ?? "");
  const testId = String(formData.get("testId") ?? "");
  if (!personId || !testId) return;

  const deadlineRaw = String(formData.get("deadline") ?? "");
  const deadline = deadlineRaw ? new Date(deadlineRaw) : null;

  const [person, test] = await Promise.all([
    prisma.person.findUnique({ where: { id: personId } }),
    prisma.test.findUnique({ where: { id: testId } }),
  ]);

  // manager может назначать только сотрудникам своего отдела.
  const scope = await getScope();
  if (scope.isManager) {
    if (scope.blocked || !person || person.departmentId !== scope.deptFilter) return;
  }

  // Анонимность: явный чекбокс формы, иначе default_anonymous из контента теста
  const anonymousField = formData.get("anonymous");
  const isAnonymous =
    anonymousField !== null
      ? anonymousField === "on" || anonymousField === "true"
      : (test?.content as { default_anonymous?: boolean } | null)?.default_anonymous === true;

  await prisma.assignment.create({
    data: {
      personId,
      testId,
      assignedBy: session?.user.id ?? null,
      status: "pending",
      deadline,
      isAnonymous,
      departmentId: person?.departmentId ?? null,
      inviteToken: generateInviteToken(),
    },
  });
  revalidatePath("/assignments");
  revalidatePath(`/people/${personId}`);
}

// manager вправе работать только с алертами своего отдела.
async function canTouchAlert(id: string): Promise<boolean> {
  const scope = await getScope();
  if (!scope.isManager) return true;
  if (scope.blocked) return false;
  const alert = await prisma.alert.findUnique({
    where: { id },
    select: { departmentId: true, person: { select: { departmentId: true } } },
  });
  if (!alert) return false;
  const dept = alert.departmentId ?? alert.person?.departmentId ?? null;
  return dept === scope.deptFilter;
}

export async function acknowledgeAlert(formData: FormData) {
  const session = await auth();
  const id = String(formData.get("id") ?? "");
  if (!id || !(await canTouchAlert(id))) return;
  await prisma.alert.update({
    where: { id },
    data: { status: "acknowledged", acknowledgedBy: session?.user.id ?? null },
  });
  revalidatePath("/alerts");
  revalidatePath("/");
}

export async function resolveAlert(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id || !(await canTouchAlert(id))) return;
  await prisma.alert.update({
    where: { id },
    data: { status: "resolved", resolvedAt: new Date() },
  });
  revalidatePath("/alerts");
  revalidatePath("/");
}

// --- Кампании мониторинга (планировщик исполняет их в боте) ---
export async function createCampaign(formData: FormData) {
  if (!(await assertPrivileged())) return;
  const testId = String(formData.get("testId") ?? "");
  if (!testId) return;
  const schedule = String(formData.get("schedule") ?? "monthly");
  const departmentId = optField(formData, "departmentId"); // null = вся компания
  const anonymous = formData.get("anonymous") === "on";
  const startRaw = String(formData.get("startDate") ?? "");
  const nextRunAt = startRaw ? new Date(startRaw) : new Date();

  await prisma.campaign.create({
    data: {
      testId,
      schedule,
      target: departmentId ? "department" : "all",
      departmentId,
      isAnonymous: anonymous,
      nextRunAt,
      isActive: true,
    },
  });
  revalidatePath("/campaigns");
}

export async function toggleCampaign(formData: FormData) {
  if (!(await assertPrivileged())) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) return;
  await prisma.campaign.update({ where: { id }, data: { isActive: !c.isActive } });
  revalidatePath("/campaigns");
}

// «Запустить сейчас» — сдвигаем next_run_at в прошлое, бот подхватит на ближайшем тике.
export async function runCampaignNow(formData: FormData) {
  if (!(await assertPrivileged())) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.campaign.update({
    where: { id },
    data: { nextRunAt: new Date(), isActive: true },
  });
  revalidatePath("/campaigns");
}

export async function deleteCampaign(formData: FormData) {
  if (!(await assertPrivileged())) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.campaign.delete({ where: { id } });
  revalidatePath("/campaigns");
}

// --- Редактор тестов: загрузка/обновление JSON с валидацией (раздел 9 ТЗ) ---
export interface TestFormState {
  error?: string;
  message?: string;
}

export async function upsertTestFromJson(
  _prev: TestFormState,
  formData: FormData
): Promise<TestFormState> {
  if (!(await assertPrivileged())) return { error: "Недостаточно прав" };
  const jsonText = String(formData.get("json") ?? "");
  const formCategory = String(formData.get("category") ?? "");
  if (!jsonText.trim()) return { error: "Пустой JSON" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return { error: `Невалидный JSON: ${err instanceof Error ? err.message : "ошибка синтаксиса"}` };
  }

  const { ok, errors, content } = validateTestContent(parsed);
  if (!ok || !content) {
    return { error: "Ошибки схемы:\n• " + errors.join("\n• ") };
  }

  const existing = await prisma.test.findUnique({ where: { code: content.code } });
  const category = content.category ?? (formCategory || existing?.category || "monitoring");
  await prisma.test.upsert({
    where: { code: content.code },
    update: {
      title: content.title,
      description: content.description ?? null,
      category,
      estimatedMinutes: content.estimated_minutes ?? null,
      content: parsed as object,
      version: { increment: 1 },
    },
    create: {
      code: content.code,
      title: content.title,
      description: content.description ?? null,
      category,
      estimatedMinutes: content.estimated_minutes ?? null,
      content: parsed as object,
      isActive: true,
      version: 1,
    },
  });
  revalidatePath("/tests");
  return {
    message: existing
      ? `Тест «${content.title}» обновлён (версия ${existing.version + 1})`
      : `Тест «${content.title}» создан`,
  };
}

export async function toggleTest(formData: FormData) {
  if (!(await assertPrivileged())) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const t = await prisma.test.findUnique({ where: { id } });
  if (!t) return;
  await prisma.test.update({ where: { id }, data: { isActive: !t.isActive } });
  revalidatePath("/tests");
}

// --- Пользователи админки (только owner): создание hr/manager ---
export interface AdminUserFormState {
  error?: string;
  message?: string;
}

export async function createAdminUser(
  _prev: AdminUserFormState,
  formData: FormData
): Promise<AdminUserFormState> {
  const session = await auth();
  if (session?.user.role !== "owner") return { error: "Только owner может создавать пользователей" };

  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "hr");
  const personId = optField(formData, "personId");

  if (!email || !password) return { error: "Email и пароль обязательны" };
  if (password.length < 8) return { error: "Пароль минимум 8 символов" };
  if (!["hr", "manager"].includes(role)) return { error: "Роль должна быть hr или manager" };
  if (role === "manager" && !personId) {
    return { error: "Менеджеру нужна привязка к сотруднику — по ней определяется его отдел" };
  }
  if (await prisma.adminUser.findUnique({ where: { email } })) {
    return { error: "Пользователь с таким email уже существует" };
  }
  if (role === "manager" && personId) {
    const p = await prisma.person.findUnique({
      where: { id: personId },
      select: { departmentId: true },
    });
    if (!p?.departmentId) {
      return { error: "У выбранного сотрудника не указан отдел — менеджер не сможет видеть данные" };
    }
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.adminUser.create({
      data: { email, passwordHash, role, personId: personId ?? undefined },
    });
  } catch {
    return { error: "Не удалось создать: этот сотрудник уже связан с другим аккаунтом" };
  }
  revalidatePath("/settings");
  return { message: `Пользователь ${email} создан (роль: ${role})` };
}
