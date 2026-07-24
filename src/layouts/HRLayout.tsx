import { ReactNode, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { AUTH_PORTAL } from "@/lib/portalAuth";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart2,
  Bell,
  Calendar,
  CheckSquare,
  LayoutDashboard,
  LogOut,
  Menu,
  PhoneCall,
  Settings,
  UserPlus,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const navItems = [
  { to: "/hr/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/hr/my-leads", label: "My Leads", icon: UserPlus },
  { to: "/hr/assigned-leads", label: "Assigned Leads", icon: Users },
  { to: "/hr/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/hr/reports", label: "Reports", icon: BarChart2 },
  { to: "/hr/notifications", label: "Notifications", icon: Bell },
  { to: "/hr/communications", label: "Communications", icon: PhoneCall },
  { to: "/hr/holidays", label: "Holidays", icon: Calendar },
  { to: "/hr/settings", label: "Settings", icon: Settings },
];

function NavLinks({
  unreadCount,
  onNavigate,
}: {
  unreadCount: number;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-1 px-2 py-2 overflow-y-auto">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={() => onNavigate?.()}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 touch-target",
              isActive
                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-sidebar-primary/20"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            )
          }
        >
          <item.icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">{item.label}</span>
          {item.to === "/hr/notifications" && unreadCount > 0 && (
            <Badge className="bg-[#2ed573] text-[#0f2318] shrink-0">{unreadCount}</Badge>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export default function HRLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const hrUser = api.hr.getStoredUser();
  const [sheetOpen, setSheetOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["hr", "notifications"],
    queryFn: api.hr.notifications,
    refetchInterval: 30000,
  });
  const unreadCount =
    (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []).filter(
      (n: { is_read?: number | boolean }) => !Number(n.is_read),
    ).length;

  const logout = () => {
    api.hr.logout();
    navigate(AUTH_PORTAL.login);
  };

  return (
    <div className="flex h-dvh max-h-dvh bg-background overflow-hidden">
      <aside className="hidden w-60 border-r bg-sidebar text-sidebar-foreground md:flex md:flex-col shrink-0">
        <div className="border-b border-sidebar-border px-4 py-4 text-lg font-bold">HR Portal</div>
        <NavLinks unreadCount={unreadCount} />
      </aside>

      {/* Mobile header — owns safe-area-inset-top */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-50 border-b border-border bg-card/95 backdrop-blur-md"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="flex items-center gap-3 px-4 py-3 min-h-[52px]">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl touch-target shrink-0">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-[min(300px,88vw)] max-w-[300px] bg-sidebar text-sidebar-foreground">
              <SheetTitle className="sr-only">HR navigation</SheetTitle>
              <div className="border-b border-sidebar-border px-4 py-4 text-lg font-bold">HR Portal</div>
              <NavLinks unreadCount={unreadCount} onNavigate={() => setSheetOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="font-semibold text-sm truncate">HR Portal</span>
          <div className="ml-auto flex items-center gap-2 min-w-0">
            <div className="text-right min-w-0 hidden sm:block">
              <p className="text-xs font-semibold truncate max-w-[120px]">{hrUser?.full_name || "HR User"}</p>
            </div>
            <Button variant="ghost" size="icon" className="h-10 w-10 touch-target shrink-0" onClick={logout} aria-label="Logout">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <main className="flex-1 min-w-0 overflow-auto">
        <div className="hidden md:flex items-center justify-between border-b bg-card px-6 py-2">
          <div />
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-right min-w-0">
              <p className="text-sm font-semibold truncate">{hrUser?.full_name || "HR User"}</p>
              <p className="text-xs text-muted-foreground truncate max-w-[220px]">{hrUser?.email || ""}</p>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5 shrink-0" onClick={logout}>
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
        <div
          className="md:hidden shrink-0"
          style={{ height: "calc(52px + env(safe-area-inset-top, 0px))" }}
          aria-hidden
        />
        <div className="mx-auto max-w-7xl p-4 md:p-6 pb-safe w-full min-w-0">{children}</div>
      </main>
    </div>
  );
}
