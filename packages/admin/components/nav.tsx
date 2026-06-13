"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Users,
  Send,
  Bell,
  FileText,
  Settings,
  CalendarClock,
  Activity,
  LogOut,
} from "lucide-react";
import { MakeBizLogo } from "@/components/logo";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Дашборд", Icon: LayoutDashboard },
  { href: "/people", label: "Люди", Icon: Users },
  { href: "/assignments", label: "Назначения", Icon: Send },
  { href: "/campaigns", label: "Кампании", Icon: CalendarClock },
  { href: "/pulse", label: "Пульс-опросы", Icon: Activity },
  { href: "/tests", label: "Тесты", Icon: FileText },
  { sep: true as const },
  { href: "/alerts", label: "Алерты", Icon: Bell, badge: true },
  { href: "/settings", label: "Настройки", Icon: Settings },
];

export function Nav({
  email,
  role,
  alertCount = 0,
}: {
  email?: string | null;
  role: string;
  alertCount?: number;
}) {
  const pathname = usePathname();
  return (
    <aside className="flex w-[248px] shrink-0 flex-col gap-6 p-5">
      <div className="px-2.5 pb-1 pt-2">
        <MakeBizLogo className="h-[34px] w-auto" />
      </div>

      <nav className="flex flex-col gap-0.5 rounded-[20px] border border-mk-border bg-card p-2.5 shadow-mk">
        {LINKS.map((l, i) => {
          if ("sep" in l) return <div key={i} className="mx-1 my-1.5 h-px bg-[#EEF1F4]" />;
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "flex items-center gap-2.5 rounded-[16px] px-3.5 py-2.5 text-[15px] transition-colors",
                active
                  ? "bg-mk-c2 font-bold text-primary"
                  : "text-foreground hover:bg-mk-bg"
              )}
            >
              <l.Icon className="h-[18px] w-[18px] opacity-80" />
              {l.label}
              {l.badge && alertCount > 0 && (
                <span className="ml-auto min-w-[20px] rounded-[10px] bg-mk-red px-1.5 py-px text-center text-[11px] font-bold text-white">
                  {alertCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-[20px] border border-mk-border bg-card p-2.5 shadow-mk">
        <div className="px-2 pb-2">
          <div className="truncate text-[13px] font-bold">{email}</div>
          <div className="text-[12px] text-muted-foreground">{role}</div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-2.5 rounded-[16px] px-3.5 py-2.5 text-[15px] text-foreground transition-colors hover:bg-mk-bg"
        >
          <LogOut className="h-[18px] w-[18px] opacity-80" />
          Выйти
        </button>
      </div>
    </aside>
  );
}
