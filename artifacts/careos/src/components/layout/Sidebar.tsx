import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Users, 
  UserSquare2, 
  Calendar, 
  Clock, 
  Wallet, 
  ShieldAlert, 
  Scale, 
  FileText 
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/caregivers", label: "Caregivers", icon: UserSquare2 },
  { href: "/schedule", label: "Schedule", icon: Calendar },
  { href: "/visits", label: "Visits & EVV", icon: Clock },
  { href: "/payroll", label: "Payroll", icon: Wallet },
  { href: "/compliance", label: "Compliance", icon: ShieldAlert },
  { href: "/labor-rules", label: "Labor Rules", icon: Scale },
  { href: "/audit-log", label: "Audit Log", icon: FileText },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <div className="flex h-screen w-64 flex-col bg-sidebar border-r border-sidebar-border">
      <div className="p-6">
        <h2 className="text-xl font-bold tracking-tight text-sidebar-foreground">CareOS</h2>
        <p className="text-sm text-sidebar-foreground/70">Command Center</p>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href}>
              <span
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-medium">
            A
          </div>
          <div className="text-sm">
            <p className="font-medium text-sidebar-foreground">Administrator</p>
            <p className="text-xs text-sidebar-foreground/70">Main Office</p>
          </div>
        </div>
      </div>
    </div>
  );
}