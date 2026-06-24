import { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart2,
  Bell,
  Calendar,
  CheckSquare,
  LayoutDashboard,
  LogOut,
  UserPlus,
  PhoneCall,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const navItems = [
  { to: "/hr/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/hr/my-leads", label: "My Leads", icon: UserPlus },
  { to: "/hr/assigned-leads", label: "Assigned Leads", icon: Users },
  { to: "/hr/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/hr/reports", label: "Reports", icon: BarChart2 },
  { to: "/hr/notifications", label: "Notifications", icon: Bell },
  { to: "/hr/communications", label: "Communications", icon: PhoneCall },
  { to: "/hr/holidays", label: "Holidays", icon: Calendar },
];

export default function HRLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const hrUser = api.hr.getStoredUser();
  const { data } = useQuery({
    queryKey: ["hr", "notifications"],
    queryFn: api.hr.notifications,
    refetchInterval: 30000,
  });
  const unreadCount =
    (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []).filter((n: any) => !Number(n.is_read)).length;

  return (
    <div className="flex h-screen bg-background">
      <aside className="hidden w-60 border-r bg-sidebar text-sidebar-foreground md:flex md:flex-col">
        <div className="border-b border-sidebar-border px-4 py-4 text-lg font-bold">HR Portal</div>
        <nav className="flex-1 space-y-1 px-2 py-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-sidebar-primary/20"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {item.to === "/hr/notifications" && unreadCount > 0 && (
                <Badge className="bg-[#2ed573] text-[#0f2318]">{unreadCount}</Badge>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="flex items-center justify-between border-b bg-card px-6 py-2">
          <div />
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-semibold">{hrUser?.full_name || "HR User"}</p>
              <p className="text-xs text-muted-foreground">{hrUser?.email || ""}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                api.hr.logout();
                navigate("/hr-login");
              }}
            >
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
        <div className="mx-auto max-w-7xl p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
