import { Link, useLocation } from "wouter";
import { clearAuth, useAuth } from "@/lib/auth";
import { 
  Heart, 
  CalendarDays, 
  History, 
  ClipboardList, 
  MessageCircle, 
  FileText, 
  Settings,
  LogOut,
  Menu
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useGetClient } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";

export function Layout({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const [, setLocation] = useLocation();

  if (!auth) {
    // Should be handled by router, but just in case
    return <>{children}</>;
  }

  const { data: client, isLoading } = useGetClient(auth.clientId, {
    query: { enabled: !!auth.clientId } as any,
  });

  const handleSignOut = () => {
    clearAuth();
    setLocation("/");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Mobile Nav Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b bg-card">
        <div className="flex items-center gap-2 text-primary font-serif italic">
          <Heart className="w-5 h-5 fill-primary text-primary" />
          <span className="font-semibold text-lg">CareOS</span>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground">
              <Menu className="w-6 h-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[280px] p-0 flex flex-col bg-sidebar border-r-0">
            <SidebarContent client={client} isLoading={isLoading} onSignOut={handleSignOut} />
          </SheetContent>
        </Sheet>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-[280px] flex-col border-r bg-sidebar shrink-0">
        <SidebarContent client={client} isLoading={isLoading} onSignOut={handleSignOut} />
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full max-w-full overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}

function SidebarContent({ client, isLoading, onSignOut }: { client?: any, isLoading: boolean, onSignOut: () => void }) {
  const [location] = useLocation();

  const links = [
    { href: "/today", icon: CalendarDays, label: "Today" },
    { href: "/history", icon: History, label: "History" },
    { href: "/care-plan", icon: ClipboardList, label: "Care Plan" },
    { href: "/messages", icon: MessageCircle, label: "Messages" },
    { href: "/documents", icon: FileText, label: "Documents" },
    { href: "/settings", icon: Settings, label: "Settings" },
  ];

  return (
    <div className="flex flex-col h-full py-6 px-4">
      <div className="flex items-center gap-2 text-primary font-serif italic mb-8 px-2">
        <Heart className="w-6 h-6 fill-primary text-primary" />
        <span className="font-semibold text-xl">CareOS</span>
      </div>

      <div className="mb-8 px-2">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Caring for</h2>
        {isLoading ? (
          <Skeleton className="h-6 w-32" />
        ) : (
          <p className="text-lg font-medium text-foreground">{client?.firstName} {client?.lastName}</p>
        )}
      </div>

      <nav className="flex-1 space-y-1">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = location === link.href || location.startsWith(link.href + "/");
          return (
            <Link key={link.href} href={link.href}>
              <span
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors cursor-pointer ${
                  isActive 
                    ? "bg-primary text-primary-foreground font-medium shadow-sm" 
                    : "text-muted-foreground hover:bg-black/5 hover:text-foreground"
                }`}
              >
                <Icon className="w-5 h-5" />
                {link.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="pt-4 border-t mt-auto">
        <button
          onClick={onSignOut}
          className="flex w-full items-center gap-3 px-3 py-2.5 rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground transition-colors"
        >
          <LogOut className="w-5 h-5" />
          Sign out
        </button>
      </div>
    </div>
  );
}
