"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { generateInviteToken } from "@/lib/tokens";

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
