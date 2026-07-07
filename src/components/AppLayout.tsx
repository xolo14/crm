import * as React from 'react';
import { ReactNode, useEffect, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { AUTH_PORTAL } from '@/lib/portalAuth';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard, Users, GraduationCap, BookOpen, Layers,
  CreditCard, BarChart3, BarChart2, Settings, LogOut, ChevronLeft, ChevronRight, ChevronDown, Menu, CheckSquare, TrendingUp, FileText, ClipboardList, Bell, Mail, MessageSquare, CalendarDays, FileCheck, Building2, Trash2, Award, UserCheck, PhoneCall, Receipt, Link2, IndianRupee
} from 'lucide-react';
import syncpediaIcon from '@/assets/syncpedia-icon.webp';
import syncpediaLogo from '@/assets/syncpedia-logo.webp';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { NotificationBell } from '@/components/NotificationBell';
import { canAccessFresherSalary, canAccessOfferLetters, canAccessCertificates, canAccessPayslip, canAccessPaymentRecords } from '@/lib/orgAccess';
import { featureKeyForPath, isOrgFeatureEnabled } from '@/lib/orgFeatures';

type AppRole = string;

interface NavItem {
  to: string;
  icon: any;
  label: string;
  roles: string[];
  children?: NavItem[];
}

const navItems: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ['super_admin', 'admin', 'manager', 'sales_representative', 'trainer', 'finance', 'sales_marketing'] },
  { to: '/organizations', icon: Building2, label: 'Organizations', roles: ['super_admin'] },
  {
    to: '/leads', icon: Users, label: 'Leads', roles: ['super_admin', 'admin', 'org', 'manager', 'marketing', 'hr'],
    children: [
      { to: '/leads/form-leads', icon: FileText, label: 'Form Leads', roles: ['super_admin', 'admin', 'manager'] },
      { to: '/leads/hr-leads', icon: UserCheck, label: 'HR Leads', roles: ['super_admin', 'admin', 'org'] },
    ],
  },
  { to: '/form-management', icon: ClipboardList, label: 'Form Management', roles: ['super_admin', 'admin', 'org', 'marketing', 'sales_marketing'] },
  { to: '/my-leads', icon: ClipboardList, label: 'My Leads', roles: ['sales_marketing'] },
  {
    to: '/leads-management',
    icon: Users,
    label: 'Leads Management',
    roles: ['sales_representative'],
    children: [
      { to: '/my-leads', icon: ClipboardList, label: 'My Leads', roles: ['sales_representative'] },
      { to: '/assigned-leads', icon: Users, label: 'Assigned Leads', roles: ['sales_representative'] },
    ],
  },
  {
    to: '/my-referrals',
    icon: Users,
    label: 'Sales Tracker',
    roles: ['super_admin', 'admin', 'manager'],
    children: [
      {
        to: '/referral-analytics',
        icon: TrendingUp,
        label: 'Rep Performance',
        roles: ['super_admin', 'admin', 'manager'],
      },
    ],
  },
  { to: '/students', icon: GraduationCap, label: 'Students', roles: ['super_admin', 'admin', 'manager', 'trainer'] },
  { to: '/courses', icon: BookOpen, label: 'Courses', roles: ['super_admin', 'admin', 'trainer', 'manager'] },
  {
    to: '/batches',
    icon: Layers,
    label: 'Batches',
    roles: ['super_admin', 'admin', 'trainer', 'manager', 'sales_representative'],
  },
  {
    to: '/payments',
    icon: Link2,
    label: 'Payment links',
    roles: ['super_admin', 'admin', 'org', 'finance', 'manager', 'sales_representative'],
  },
  {
    to: '/payments/records',
    icon: Receipt,
    label: 'Payment Records',
    roles: ['super_admin', 'admin', 'manager'],
  },
  { to: '/communications', icon: PhoneCall, label: 'Communications', roles: ['super_admin', 'admin', 'org', 'manager', 'sales_representative', 'marketing', 'sales_marketing', 'trainer', 'finance', 'hr'] },
  {
    to: '/daily-reports', icon: ClipboardList, label: 'Daily Reports', roles: ['super_admin', 'admin', 'manager', 'sales_representative'],
    children: [
      { to: '/sales/call-log', icon: PhoneCall, label: 'Call Log', roles: ['super_admin', 'admin', 'org', 'manager', 'sales_representative'] },
      { to: '/daily-reports/analytics', icon: BarChart2, label: 'Analytics', roles: ['super_admin', 'admin', 'manager', 'sales_representative'] },
    ],
  },
  {
    to: '/marketing-admin', icon: Mail, label: 'Marketing', roles: ['super_admin', 'admin'],
    children: [
      { to: '/marketing/analytics', icon: BarChart3, label: 'Email Analytics', roles: ['super_admin', 'admin'] },
      { to: '/marketing/whatsapp-analytics', icon: MessageSquare, label: 'WhatsApp Analytics', roles: ['super_admin', 'admin'] },
    ],
  },
  { to: '/marketing/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['marketing'] },
  {
    to: '/marketing/portal', icon: Mail, label: 'Email Marketing', roles: ['marketing'],
    children: [
      { to: '/marketing/analytics', icon: BarChart3, label: 'Email Analytics', roles: ['marketing'] },
    ],
  },
  {
    to: '/marketing/whatsapp', icon: MessageSquare, label: 'WhatsApp Marketing', roles: ['marketing'],
    children: [
      { to: '/marketing/whatsapp-analytics', icon: BarChart3, label: 'WA Analytics', roles: ['marketing'] },
    ],
  },
  { to: '/marketing/form-leads', icon: FileText, label: 'Form Leads', roles: ['marketing'] },
  { to: '/marketing/imported-leads', icon: Users, label: 'Imported Leads', roles: ['marketing'] },
  { to: '/assigned-leads', icon: ClipboardList, label: 'Assigned Leads', roles: ['marketing'] },
  { to: '/offer-letters', icon: FileCheck, label: 'Offer Letters', roles: ['super_admin', 'admin'] },
  { to: '/certificates', icon: Award, label: 'Certificates', roles: ['super_admin', 'admin'] },
  { to: '/payslip', icon: Receipt, label: 'Payslip', roles: ['super_admin', 'admin', 'org'] },
  {
    to: '/team',
    icon: Users,
    label: 'Team',
    roles: ['super_admin', 'admin', 'manager'],
  },
  {
    to: '/fresher-salary-tracker',
    icon: IndianRupee,
    label: 'Fresher Salary',
    roles: ['super_admin', 'admin'],
  },
  { to: '/tasks', icon: CheckSquare, label: 'Tasks', roles: ['super_admin', 'admin', 'manager', 'sales_representative', 'trainer', 'sales_marketing'] },
  { to: '/notifications', icon: Bell, label: 'Notifications', roles: ['super_admin', 'admin', 'manager', 'sales_representative', 'trainer', 'finance', 'sales_marketing'] },
  { to: '/holidays', icon: CalendarDays, label: 'Holidays', roles: ['super_admin', 'admin', 'manager', 'sales_representative', 'marketing', 'sales_marketing'] },
  { to: '/trash', icon: Trash2, label: 'Trash', roles: ['super_admin', 'admin', 'manager'] },
  { to: '/settings', icon: Settings, label: 'Settings', roles: ['super_admin', 'admin'] },
];

function SidebarNavItem({ item, collapsed, role, organization, currentPath, onNavigate, showNewBadge }: { item: NavItem; collapsed: boolean; role: string | null; organization: { slug?: string | null; features?: Record<string, boolean> | null } | null; currentPath: string; onNavigate?: () => void; showNewBadge: boolean }) {
  const hasChildren = item.children && item.children.length > 0;
  const filteredChildren = hasChildren ? item.children!.filter(c => navItemAllowed(c, role as AppRole | null, organization)) : [];
  const isActive = currentPath === item.to;
  const isChildActive = filteredChildren.some(c => currentPath === c.to);
  const open = isActive || isChildActive || currentPath.startsWith(item.to + '/');

  if (hasChildren && filteredChildren.length > 0 && !collapsed) {
    return (
      <div>
        <div className="flex items-center">
          <NavLink
            to={item.to}
            end
            onClick={onNavigate}
            className={cn(
              "flex-1 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
              isActive && !isChildActive
                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-sidebar-primary/20"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.to === "/certificates" && showNewBadge && (
              <span className="ml-auto text-[9px] font-bold px-[7px] py-[2px] rounded-full bg-[#2ed573] text-[#0f2318]">
                NEW
              </span>
            )}
          </NavLink>
          <NavLink
            to={item.to}
            className="p-1.5 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </NavLink>
        </div>
        {open && (
          <div className="ml-4 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-2">
            {filteredChildren.map(child => (
              <NavLink
                key={child.to}
                to={child.to}
                onClick={onNavigate}
                className={({ isActive: active }) => cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm shadow-sidebar-primary/20"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
              >
                <child.icon className="h-3.5 w-3.5 shrink-0" />
                <span>{child.label}</span>
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      className={({ isActive: active }) => cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
        active
          ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-sidebar-primary/20"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        collapsed && "justify-center px-2"
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {!collapsed && (
        <>
          <span>{item.label}</span>
          {item.to === "/certificates" && showNewBadge && (
            <span className="ml-auto text-[9px] font-bold px-[7px] py-[2px] rounded-full bg-[#2ed573] text-[#0f2318]">
              NEW
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function navItemAllowed(item: NavItem, role: AppRole | null, organization: { slug?: string | null; features?: Record<string, boolean> | null } | null): boolean {
  if (!role || !item.roles.includes(role)) return false;
  if (item.to === "/offer-letters") return canAccessOfferLetters(role, organization);
  if (item.to === "/fresher-salary-tracker") return canAccessFresherSalary(role, organization);
  if (item.to === "/certificates") return canAccessCertificates(role, organization);
  if (item.to === "/payslip") return canAccessPayslip(role, organization);
  if (item.to === "/payments/records") return canAccessPaymentRecords(role);

  const feat = featureKeyForPath(item.to);
  if (feat && !isOrgFeatureEnabled(role, organization, feat)) return false;

  if (item.children) {
    const visibleChildren = item.children.filter((c) => navItemAllowed(c, role, organization));
    if (visibleChildren.length === 0 && item.children.length > 0) return false;
  }

  return true;
}

function SidebarContent({
  collapsed,
  role,
  organization,
  onSignOut,
  profile,
  onNavigate,
}: {
  collapsed: boolean;
  role: AppRole | null;
  organization: { slug?: string | null; features?: Record<string, boolean> | null } | null;
  onSignOut: () => void;
  profile: any;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const currentPath = location.pathname;
  const filteredNav = navItems.filter((item) => navItemAllowed(item, role, organization));
  const [showNewBadge, setShowNewBadge] = React.useState<boolean>(
    !localStorage.getItem("cert_nav_seen")
  );

  useEffect(() => {
    if (location.pathname === "/certificates") {
      localStorage.setItem("cert_nav_seen", "true");
      setShowNewBadge(false);
    }
  }, [location.pathname]);

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      <div className={cn("flex items-center gap-2.5 px-4 py-4 border-b border-sidebar-border", collapsed && "justify-center px-2")}>
        {collapsed ? (
          <img src={syncpediaIcon} alt="Syncpedia" className="h-9 w-9 object-contain brightness-0 invert" />
        ) : (
          <img src={syncpediaLogo} alt="Syncpedia Technologies" className="h-10 object-contain brightness-0 invert" />
        )}
      </div>

      {!collapsed && (
        <div className="px-4 pt-3 pb-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">Menu</span>
        </div>
      )}

      <nav className="flex-1 py-1 px-2 space-y-0.5 overflow-y-auto">
        {filteredNav.map(item => (
          <SidebarNavItem key={item.to} item={item} collapsed={collapsed} role={role} organization={organization} currentPath={currentPath} onNavigate={onNavigate} showNewBadge={showNewBadge} />
        ))}
      </nav>

      <div className={cn("border-t border-sidebar-border p-3", collapsed && "p-2")}>
        {!collapsed && profile && (
          <div className="mb-3 px-1">
            <p className="text-sm font-semibold truncate text-sidebar-foreground">{profile.full_name || profile.email}</p>
            <p className="text-xs text-sidebar-foreground/50 capitalize">{role?.replace(/_/g, ' ')}</p>
          </div>
        )}
        <Button variant="ghost" size={collapsed ? "icon" : "default"} className="w-full justify-start gap-2 text-sidebar-foreground/60 hover:text-destructive hover:bg-destructive/10" onClick={onSignOut}>
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>Sign Out</span>}
        </Button>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { role, profile, signOut, organization, switchOrg } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const showOrgViewingBadge = role === 'super_admin' && !!organization && location.pathname === '/org-crm';

  const handleSignOut = async () => {
    await signOut();
    api.hr.logout();
    const n = String(role || "").toLowerCase();
    if (n === "super_admin" || n === "superadmin") {
      navigate(AUTH_PORTAL.superAdmin);
      return;
    }
    navigate(AUTH_PORTAL.login);
  };

  const handleBackToMaster = async () => {
    try {
      await switchOrg(null as any);
      navigate('/');
    } catch {}
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className={cn(
        "hidden md:flex flex-col transition-all duration-200 relative",
        collapsed ? "w-16" : "w-60"
      )}>
        <SidebarContent collapsed={collapsed} role={role} organization={organization} onSignOut={handleSignOut} profile={profile} />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-7 z-10 h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground transition-all hidden md:flex shadow-sm"
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
        </button>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 border-b border-border bg-card/95 backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl touch-target shrink-0"><Menu className="h-5 w-5" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-[min(300px,88vw)] max-w-[300px]">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarContent
                collapsed={false}
                role={role}
                organization={organization}
                onSignOut={handleSignOut}
                profile={profile}
                onNavigate={() => setSheetOpen(false)}
              />
            </SheetContent>
          </Sheet>
          <img src={syncpediaLogo} alt="Syncpedia Technologies" className="h-7 object-contain" />
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
          </div>
        </div>
      </div>

      <main className="flex-1 overflow-auto">
        {/* Desktop top bar */}
        <div className="hidden md:flex items-center justify-between px-6 py-2 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            {showOrgViewingBadge && (
              <div className="inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2 py-1">
                <span className="text-[10px] text-muted-foreground">Viewing</span>
                <span className="text-[11px] font-semibold text-primary">{organization.name}</span>
              </div>
            )}
          </div>
          <NotificationBell />
        </div>
        {/* Mobile top spacing */}
        <div className="md:hidden h-[60px]" style={{ height: 'calc(60px + env(safe-area-inset-top, 0px))' }} />
        {showOrgViewingBadge && (
          <div className="md:hidden px-4 py-1.5 border-b border-primary/20 bg-primary/5">
            <div className="inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-background px-2 py-1">
              <span className="text-[10px] text-muted-foreground">Viewing</span>
              <span className="text-[11px] font-semibold text-primary">{organization.name}</span>
            </div>
          </div>
        )}
        {/* Content area */}
        <div className="p-4 md:p-6 max-w-7xl mx-auto pb-safe w-full min-w-0">
          {children}
        </div>
      </main>
    </div>
  );
}
