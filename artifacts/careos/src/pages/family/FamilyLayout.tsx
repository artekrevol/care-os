import { Link, useLocation } from "wouter";
import { Heart, Home, MessageSquare, Bell, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export type FamilyUser = {
  id: string;
  clientId: string;
  firstName: string;
  lastName: string;
  email: string;
};

export function loadFamilyUser(): FamilyUser | null {
  try {
    const raw = localStorage.getItem("careos.family.user");
    return raw ? (JSON.parse(raw) as FamilyUser) : null;
  } catch {
    return null;
  }
}

export function FamilyLayout({
  children,
  user,
}: {
  children: React.ReactNode;
  user: FamilyUser;
}) {
  const [location, navigate] = useLocation();
  const navItems = [
    { href: "/family/home", label: "Home", icon: Home },
    { href: "/family/messages", label: "Messages", icon: MessageSquare },
    { href: "/family/preferences", label: "Notifications", icon: Bell },
  ];
  function logout() {
    localStorage.removeItem("careos.family.user");
    navigate("/family/login");
  }
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
          <Link href="/family/home" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Heart className="h-4 w-4 text-primary" />
            </div>
            <span className="font-semibold">CareOS Family</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:inline" data-testid="text-family-user-name">
              {user.firstName} {user.lastName}
            </span>
            <Button variant="ghost" size="sm" onClick={logout} data-testid="button-family-logout">
              <LogOut className="h-4 w-4 mr-1" />
              Sign out
            </Button>
          </div>
        </div>
        <nav className="mx-auto max-w-4xl px-6 flex gap-1">
          {navItems.map((item) => {
            const active = location === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={`link-family-${item.label.toLowerCase()}`}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition flex items-center gap-2 ${
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="flex-1 mx-auto max-w-4xl w-full p-6">{children}</main>
    </div>
  );
}
