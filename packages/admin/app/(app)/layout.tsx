import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Nav } from "@/components/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  const alertCount = await prisma.alert.count({ where: { status: { not: "resolved" } } });

  return (
    <div className="flex min-h-screen bg-background">
      <Nav email={session.user.email} role={session.user.role} alertCount={alertCount} />
      <main className="flex-1 overflow-x-auto px-8 py-6">
        <div className="mx-auto max-w-[1240px]">{children}</div>
      </main>
    </div>
  );
}
