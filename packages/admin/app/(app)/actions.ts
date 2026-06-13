"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { generateInviteToken } from "@/lib/tokens";
import { validateTestContent } from "@/lib/validate-test";

// Optional-селекты в Radix используют сентинел "none" вместо пустой строки.
function optField(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v && v !== "none" ? v : null;
}

export async function createPerson(formData: FormData) {
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

export async function acknowledgeAlert(formData: FormData) {
  const session = await auth();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.alert.update({
    where: { id },
    data: { status: "acknowledged", acknowledgedBy: session?.user.id ?? null },
  });
  revalidatePath("/alerts");
  revalidatePath("/");
}

export async function resolveAlert(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.alert.update({
    where: { id },
    data: { status: "resolved", resolvedAt: new Date() },
  });
  revalidatePath("/alerts");
  revalidatePath("/");
}

// --- Кампании мониторинга (планировщик исполняет их в боте) ---
export async function createCampaign(formData: FormData) {
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
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) return;
  await prisma.campaign.update({ where: { id }, data: { isActive: !c.isActive } });
  revalidatePath("/campaigns");
}

// «Запустить сейчас» — сдвигаем next_run_at в прошлое, бот подхватит на ближайшем тике.
export async function runCampaignNow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.campaign.update({
    where: { id },
    data: { nextRunAt: new Date(), isActive: true },
  });
  revalidatePath("/campaigns");
}

export async function deleteCampaign(formData: FormData) {
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
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const t = await prisma.test.findUnique({ where: { id } });
  if (!t) return;
  await prisma.test.update({ where: { id }, data: { isActive: !t.isActive } });
  revalidatePath("/tests");
}
