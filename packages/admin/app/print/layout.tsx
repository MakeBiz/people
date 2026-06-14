import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// Минимальный layout для печатных версий: без сайдбара, белый фон, поля страницы.
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="mx-auto max-w-[820px] bg-white px-10 py-8 text-foreground print:px-0 print:py-0">
      {children}
    </div>
  );
}
