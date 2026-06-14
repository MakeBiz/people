import "server-only";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Единая модель доступа. owner/hr видят всю компанию; manager — только свой отдел.
// Менеджер определяется через AdminUser.personId → Person.departmentId.
// Fail-closed: менеджер без привязки к отделу не видит данные людей.

export interface Scope {
  userId: string | null;
  role: string; // owner | hr | manager
  isManager: boolean;
  deptFilter?: string; // departmentId менеджера; для owner/hr — undefined (вся компания)
  blocked: boolean; // менеджер без отдела → нет доступа к данным людей
}

export function isPrivileged(role: string | undefined): boolean {
  return role === "owner" || role === "hr";
}

export async function getScope(requestedDept?: string): Promise<Scope> {
  const session = await auth();
  const role = session?.user.role ?? "hr";
  const userId = session?.user.id ?? null;

  if (role === "manager") {
    if (!session?.user.personId) return { userId, role, isManager: true, blocked: true };
    const viewer = await prisma.person.findUnique({
      where: { id: session.user.personId },
      select: { departmentId: true },
    });
    if (!viewer?.departmentId) return { userId, role, isManager: true, blocked: true };
    return { userId, role, isManager: true, deptFilter: viewer.departmentId, blocked: false };
  }

  return { userId, role, isManager: false, deptFilter: requestedDept || undefined, blocked: false };
}
