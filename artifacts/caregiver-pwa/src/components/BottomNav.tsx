import { Link, useLocation } from "wouter";
import { Calendar, MessageSquare, User } from "lucide-react";

const TABS = [
  { href: "/", label: "Schedule", icon: Calendar, match: (p: string) => p === "/" || p.startsWith("/visit/") },
  { href: "/messages", label: "Messages", icon: MessageSquare, match: (p: string) => p.startsWith("/messages") },
  { href: "/profile", label: "Profile", icon: User, match: (p: string) => p.startsWith("/profile") },
];

export default function BottomNav() {
  const [loc] = useLocation();
  return (
    <nav className="safe-bottom sticky bottom-0 z-20 grid grid-cols-3 border-t border-[color:var(--color-border)] bg-[color:var(--color-surface)]/95 backdrop-blur">
      {TABS.map((t) => {
        const active = t.match(loc);
        const Icon = t.icon;
        return (
          <Link key={t.href} href={t.href}>
            <a
              className={`flex flex-col items-center justify-center py-2.5 text-[10px] font-semibold uppercase tracking-wider ${
                active
                  ? "text-[color:var(--color-accent)]"
                  : "text-[color:var(--color-muted)]"
              }`}
            >
              <Icon className="w-5 h-5 mb-0.5" />
              {t.label}
            </a>
          </Link>
        );
      })}
    </nav>
  );
}
