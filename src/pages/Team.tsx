import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Search, Plus, Shield, Users, UserCheck, ChevronDown, ChevronRight, MoreHorizontal, Phone, Mail, Edit, Trash2, ClipboardList, Loader2, Send } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { generateTempPassword } from '@/lib/randomPassword';
import {
  canRoleManageRole,
  getRoleLevel,
  isL1OperationalRole,
  normalizeAppRole,
  TEAM_ROLE_GROUPS,
} from '@/lib/roleUtils';
/** Shown for platform-level users (no tenant org) and super admins without org metadata. */
const PLATFORM_ORG_DISPLAY_NAME = 'Syncpedia';

type TeamMember = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: string;
  is_active: number | boolean;
  created_at: string;
  /** FK users.id — user who created this account (when set). */
  created_by?: string | null;
  org_id?: string | null;
  reports_to_id?: string | null;
  reports_to_name?: string | null;
  /** Organization display name (from `organizations.name` when creating an org). */
  org_name?: string | null;
  org_admin_name?: string | null;
  org_admin_email?: string | null;
};

function normalizeRole(roleKey: string) {
  return normalizeAppRole(roleKey);
}

function getRoleInfo(roleKey: string) {
  const normalized = normalizeRole(roleKey);
  return TEAM_ROLE_GROUPS.find((r) => r.key === normalized) || {
    key: normalized,
    label: normalized.replace(/_/g, ' '),
    level: getRoleLevel(normalized),
  };
}

/** Normalize JWT/account role for org-scoping checks (marketing_* → marketing, etc.). */
function normalizeAuthRole(role?: string | null): string {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'superadmin') return 'super_admin';
  if (r === 'organisation') return 'org';
  if (r.startsWith('marketing')) return 'marketing';
  return r;
}

function getRoleBadgeColor(role: string): string {
  const normalized = normalizeRole(role);
  const map: Record<string, string> = {
    super_admin: 'bg-red-500/10 text-red-600 border-red-200',
    admin: 'bg-purple-500/10 text-purple-600 border-purple-200',
    org: 'bg-violet-500/10 text-violet-700 border-violet-200',
    manager: 'bg-blue-500/10 text-blue-600 border-blue-200',
    sales_marketing: 'bg-fuchsia-500/10 text-fuchsia-600 border-fuchsia-200',
    marketing: 'bg-fuchsia-500/10 text-fuchsia-600 border-fuchsia-200',
    hr: 'bg-sky-500/10 text-sky-700 border-sky-200',
    sales_representative: 'bg-teal-500/10 text-teal-600 border-teal-200',
  };
  return map[normalized] || 'bg-muted text-muted-foreground';
}

function getInitials(name: string) { return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2); }
function canManage(currentRole: string, targetRole: string): boolean {
  return canRoleManageRole(currentRole, targetRole);
}

function hasOrgId(member: TeamMember): boolean {
  const id = member.org_id;
  return id !== null && id !== undefined && String(id).trim() !== '';
}

function memberOrgDisplayName(member: TeamMember): string | null {
  const fromOrg = member.org_name?.trim();
  if (fromOrg) return fromOrg;

  const role = normalizeRole(member.role);
  if (role === 'super_admin') return PLATFORM_ORG_DISPLAY_NAME;

  // Tenant admins/reps must not inherit the platform label when they belong to an org.
  if (hasOrgId(member)) {
    const fallback = member.org_admin_name?.trim();
    return fallback || null;
  }

  return PLATFORM_ORG_DISPLAY_NAME;
}

type OrgOption = { id: string; name: string };

export default function Team() {
  const { role: currentRole, user } = useAuth();
  const authNorm = normalizeAuthRole(currentRole);
  const isSuperAdmin = authNorm === 'super_admin';
  const isTenantAdmin = authNorm === 'admin';
  const isManagerViewer = authNorm === 'manager';
  /** Matches backend team GET scope for reps / HR / marketing — defence-in-depth vs stale merges */
  const orgScopedViewer = ['sales_representative', 'hr', 'marketing', 'sales_marketing'].includes(authNorm);
  const callerOrgIdTrim = String(user?.org_id || '').trim();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([]);
  /** Super Admin: filter roster to one tenant; `all` = every org (default). */
  const [selectedOrgId, setSelectedOrgId] = useState<string>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [addReviewOpen, setAddReviewOpen] = useState(false);
  const [addMemberLoading, setAddMemberLoading] = useState(false);
  const [sendWelcomeLoading, setSendWelcomeLoading] = useState(false);
  const [createdMemberId, setCreatedMemberId] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskAssignTo, setTaskAssignTo] = useState<TeamMember | null>(null);
  const [taskForm, setTaskForm] = useState({ title: '', description: '', due_date: '', priority: 'medium' });
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    super_admin: true,
    admin: true,
    org: true,
    manager: true,
    marketing: true,
    sales_marketing: true,
    hr: true,
    sales_representative: true,
  });

  const [newMember, setNewMember] = useState({
    full_name: '',
    email: '',
    phone: '',
    role: 'sales_representative',
    password: generateTempPassword(),
    reports_to_id: '' as string,
  });
  const currentLevel = getRoleLevel(currentRole);
  /** L4/L3: full roster CRUD. L2: add L1 members assigned to self only. */
  const canManageMembers = authNorm === 'super_admin' || authNorm === 'admin';
  const canAddMembers = canManageMembers || isManagerViewer;
  /** Assign L1 members to a manager (reports_to) — Super Admin / Admin only. */
  const canAssignTeam = canManageMembers;
  const isReadOnly = !canAddMembers;
  const assignableRoles = canManageMembers
    ? TEAM_ROLE_GROUPS.filter((r) => r.level < currentLevel)
    : isManagerViewer
      ? TEAM_ROLE_GROUPS.filter((r) => isL1OperationalRole(r.key))
      : [];

  useEffect(() => {
    if (!isSuperAdmin) return;
    void (async () => {
      try {
        const res = (await api.organizations.list()) as { data?: Array<{ id?: string; name?: string }> };
        const rows = Array.isArray(res?.data) ? res.data : [];
        setOrgOptions(
          rows
            .map((o) => ({ id: String(o.id || '').trim(), name: String(o.name || 'Unnamed org').trim() }))
            .filter((o) => o.id !== '')
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch {
        setOrgOptions([]);
      }
    })();
  }, [isSuperAdmin]);

  useEffect(() => {
    void fetchTeam();
  }, [user?.org_id, user?.id, currentRole, isSuperAdmin ? selectedOrgId : 'tenant']);

  const fetchTeam = async () => {
    setLoading(true);
    try {
      const teamOrgArg =
        isSuperAdmin && selectedOrgId !== 'all' ? selectedOrgId : undefined;
      const [teamRes, marketingRes] = await Promise.allSettled([
        api.team.list(teamOrgArg),
        isManagerViewer ? Promise.resolve({ data: [] }) : api.marketing.members(),
      ]);

      const teamRows: TeamMember[] =
        teamRes.status === 'fulfilled'
          ? (teamRes.value?.data || [])
          : [];

      /** Org labels from any CRM user row (marketing_members rows usually omit org_name). */
      const orgMetaById = new Map<string, { org_name?: string | null; org_admin_name?: string | null }>();
      for (const t of teamRows) {
        const oid = String(t.org_id || '').trim();
        if (!oid || orgMetaById.has(oid)) continue;
        orgMetaById.set(oid, { org_name: t.org_name, org_admin_name: t.org_admin_name });
      }

      const marketingRows: TeamMember[] =
        marketingRes.status === 'fulfilled'
          ? ((marketingRes.value?.data || []).map((m: any) => {
              const oidRaw = m.org_id != null && String(m.org_id).trim() !== '' ? String(m.org_id).trim() : '';
              const meta = oidRaw ? orgMetaById.get(oidRaw) : undefined;
              return {
                id: m.user_id || m.id || `mk_${String(m.email || '').toLowerCase()}`,
                full_name: m.name || m.full_name || m.email || 'Marketing User',
                email: m.email || '',
                phone: m.phone || '',
                role: 'marketing',
                is_active: m.status ? String(m.status).toLowerCase() === 'active' : 1,
                created_at: m.created_at || new Date().toISOString(),
                org_id: oidRaw || undefined,
                org_name: meta?.org_name ?? undefined,
                org_admin_name: meta?.org_admin_name ?? undefined,
              };
            }) as TeamMember[])
          : [];

      // Merge marketing stubs + CRM users by email — users row last so JOINed org_name / owner survives.
      const mergedByEmail = new Map<string, TeamMember>();
      [...marketingRows, ...teamRows].forEach((member) => {
        const key = String(member.email || '').trim().toLowerCase();
        if (!key) return;
        mergedByEmail.set(key, member);
      });
      let merged = Array.from(mergedByEmail.values());
      if (orgScopedViewer || isTenantAdmin || isManagerViewer) {
        merged = callerOrgIdTrim
          ? merged.filter((m) => String(m.org_id || '').trim() === callerOrgIdTrim)
          : isTenantAdmin || isManagerViewer
            ? []
            : merged;
      } else if (isSuperAdmin && selectedOrgId !== 'all') {
        merged = merged.filter((m) => String(m.org_id || '').trim() === selectedOrgId);
      }
      setTeam(merged);
    } catch {
      // Fallback if API not deployed yet
      setTeam([]);
    } finally { setLoading(false); }
  };

  const visibleTeam = team.filter((m) => getRoleLevel(m.role) <= currentLevel);
  const filtered = visibleTeam.filter(m => {
    const matchSearch = m.full_name?.toLowerCase().includes(search.toLowerCase()) || m.email?.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === 'all' || normalizeRole(m.role) === roleFilter;
    return matchSearch && matchRole;
  });
  const grouped = TEAM_ROLE_GROUPS.reduce<Record<string, TeamMember[]>>((acc, r) => {
    const members = filtered.filter(m => normalizeRole(m.role) === r.key);
    if (members.length > 0) acc[r.key] = members;
    return acc;
  }, {});
  const toggleGroup = (key: string) => setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));

  const openAddMemberDialog = () => {
    setAddReviewOpen(false);
    setCreatedMemberId(null);
    setAddOpen(true);
  };

  const resetNewMemberForm = () => {
    setNewMember({ full_name: '', email: '', phone: '', role: 'sales_representative', password: generateTempPassword(), reports_to_id: '' });
    setCreatedMemberId(null);
  };

  const closeAddMemberFlow = () => {
    setAddOpen(false);
    setAddReviewOpen(false);
    setAddMemberLoading(false);
    setSendWelcomeLoading(false);
    resetNewMemberForm();
  };

  const buildCreateMemberPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      full_name: newMember.full_name.trim(),
      email: newMember.email.trim(),
      phone: newMember.phone.trim() || undefined,
      role: newMember.role,
      password: newMember.password,
      send_welcome_email: false,
    };
    if (isL1OperationalRole(newMember.role)) {
      if (isManagerViewer && user?.id) {
        payload.reports_to_id = user.id;
      } else if (newMember.reports_to_id) {
        payload.reports_to_id = newMember.reports_to_id;
      }
    }
    return payload;
  };

  const handleAddMember = async () => {
    const name = newMember.full_name.trim();
    const em = newMember.email.trim();
    if (!name || !em) {
      toast({ variant: 'destructive', title: 'Missing fields', description: 'Full name and email are required.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      toast({ variant: 'destructive', title: 'Invalid email', description: 'Enter a valid email address.' });
      return;
    }
    setAddMemberLoading(true);
    try {
      const data = (await api.team.create(buildCreateMemberPayload())) as { id?: string };
      const memberId = typeof data?.id === 'string' ? data.id : null;
      setCreatedMemberId(memberId);
      toast({
        title: 'Member added',
        description: `${em} was added to your team. You can send login credentials by email on the next step.`,
      });
      setAddOpen(false);
      setAddReviewOpen(true);
      void fetchTeam();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setAddMemberLoading(false);
    }
  };

  const handleSendWelcomeEmail = async () => {
    if (!createdMemberId) {
      toast({ variant: 'destructive', title: 'Cannot send email', description: 'Member was not created. Close and try again.' });
      return;
    }
    setSendWelcomeLoading(true);
    try {
      const data = (await api.team.sendWelcomeEmail({
        user_id: createdMemberId,
        password: newMember.password,
      })) as { email_sent?: boolean; email_error?: string };
      if (data.email_sent) {
        toast({
          title: 'Welcome email sent',
          description: `Login credentials sent to ${newMember.email.trim()} from support@syncpedia.in (or your configured mail From address).`,
        });
      } else {
        toast({
          title: 'Email not sent',
          description: data.email_error
            ? data.email_error
            : 'Configure server mail to send welcome emails.',
          variant: 'destructive',
        });
        return;
      }
      closeAddMemberFlow();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setSendWelcomeLoading(false);
    }
  };

  const handleSkipWelcomeEmail = () => {
    toast({
      title: 'Member saved',
      description: `${newMember.email.trim()} is on your team. You can share login credentials manually.`,
    });
    closeAddMemberFlow();
  };

  const handleEdit = async () => {
    if (!editingMember) return;
    try {
      const payload: Record<string, unknown> = {
        full_name: editingMember.full_name,
        phone: editingMember.phone,
        role: editingMember.role,
      };
      if (canAssignTeam && isL1OperationalRole(editingMember.role)) {
        payload.reports_to_id = editingMember.reports_to_id || null;
      }
      await api.team.update(editingMember.id, payload);
      toast({ title: 'Member updated' });
      setEditOpen(false);
      setEditingMember(null);
      fetchTeam();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await api.team.delete(deleteConfirmId);
      toast({ title: 'Member removed' });
      setDeleteConfirmId(null);
      fetchTeam();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    }
  };

  const handleToggleStatus = async (member: TeamMember) => {
    try {
      await api.team.update(member.id, { is_active: member.is_active ? 0 : 1 });
      fetchTeam();
    } catch (err: any) {
      toast({ variant: 'destructive', title: err.message });
    }
  };

  const handleAssignTask = async () => {
    try {
      await api.tasks.create({ title: taskForm.title, description: taskForm.description || null, due_date: taskForm.due_date || null, priority: taskForm.priority, assigned_to: taskAssignTo?.id || null, created_by: user?.id });
      toast({ title: 'Task assigned', description: `Task assigned to ${taskAssignTo?.full_name}` });
      setTaskDialogOpen(false); setTaskAssignTo(null); setTaskForm({ title: '', description: '', due_date: '', priority: 'medium' });
    } catch (err: any) { toast({ variant: 'destructive', title: err.message }); }
  };

  const stats = { total: visibleTeam.length, active: visibleTeam.filter(m => m.is_active).length };

  const activeManagers = team.filter((m) => m.is_active && normalizeRole(m.role) === 'manager');

  const managersForL1Member = (member: TeamMember) => {
    const orgId = String(member.org_id || '').trim();
    return activeManagers.filter((m) => {
      if (m.id === member.id) return false;
      if (!orgId) return true;
      return String(m.org_id || '').trim() === orgId;
    });
  };

  const handleChangeReportsTo = async (member: TeamMember, reportsToId: string) => {
    if (!canAssignTeam) return;
    try {
      await api.team.update(member.id, { reports_to_id: reportsToId === 'none' ? null : reportsToId });
      toast({ title: 'Team updated', description: 'Manager assignment has been saved.' });
      fetchTeam();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    }
  };

  const renderManagerAssignSelect = (member: TeamMember, compact?: boolean) => {
    const options = managersForL1Member(member);
    if (!canAssignTeam) {
      return (
        <span className={compact ? 'text-muted-foreground text-xs' : 'text-muted-foreground text-sm'}>
          {member.reports_to_name || 'Unassigned'}
        </span>
      );
    }
    return (
      <Select value={member.reports_to_id || 'none'} onValueChange={(v) => handleChangeReportsTo(member, v)}>
        <SelectTrigger className={compact ? 'h-8 text-xs mt-1' : 'h-8 text-xs'}>
          <SelectValue placeholder="Select manager" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Unassigned</SelectItem>
          {options.length === 0 ? (
            <SelectItem value="__empty" disabled>
              No managers in this org
            </SelectItem>
          ) : (
            options.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.full_name}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    );
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Team Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {stats.total} members · {stats.active} active
            {isManagerViewer && (
              <span className="ml-2 inline-flex items-center rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 border border-blue-200">
                Your team
              </span>
            )}
          </p>
          {isSuperAdmin && selectedOrgId !== 'all' && (
            <p className="text-xs text-muted-foreground mt-1">
              Showing members in {orgOptions.find((o) => o.id === selectedOrgId)?.name || 'selected organisation'} only.
            </p>
          )}
          {isTenantAdmin && (
            <p className="text-xs text-muted-foreground mt-1">Showing all members in your organisation.</p>
          )}
          {isManagerViewer && (
            <p className="text-xs text-muted-foreground mt-1">
              Showing members assigned to you only. New Sales Rep, HR, Marketing, and Sales Marketing members are auto-assigned to you.
            </p>
          )}
          {canAssignTeam && (
            <p className="text-xs text-muted-foreground mt-1.5 max-w-xl">
              Use the Manager column on Sales Rep, HR, Marketing, and Sales Marketing rows to assign a manager. Only Super Admin and Admin can change assignments.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canAddMembers && assignableRoles.length > 0 && (
            <Button onClick={openAddMemberDialog} size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              {!isMobile && ' Add Member'}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
        {isSuperAdmin && (
          <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="Organisation" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All organisations</SelectItem>
              {orgOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Filter by role" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Roles</SelectItem>{TEAM_ROLE_GROUPS.filter((r) => r.level <= currentLevel).map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {TEAM_ROLE_GROUPS.flatMap((r) => {
          const members = grouped[r.key];
          if (!members?.length) return [];
          const roleKey = r.key;
          const roleInfo = getRoleInfo(roleKey);
          const isExpanded = expandedGroups[roleKey] !== false;
          const manageable = canManageMembers && canManage(currentRole || '', roleKey);

          const roleCollapsible = (
            <Collapsible key={roleKey} open={isExpanded} onOpenChange={() => toggleGroup(roleKey)}>
              <Card className="border-border/50 shadow-none overflow-hidden">
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 sm:gap-3">
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        <Badge variant="outline" className={getRoleBadgeColor(roleKey)}>Lv{roleInfo.level}</Badge>
                        <CardTitle className="text-sm font-semibold">{roleInfo.label}s</CardTitle>
                        <span className="text-xs text-muted-foreground">({members.length})</span>
                      </div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 px-0">
                    {isMobile ? (
                      <div className="space-y-2 px-4 pb-4">
                        {members.map((member) => (
                          <div key={member.id} className="border border-border/50 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Avatar className="h-7 w-7"><AvatarFallback className="text-xs bg-primary/10 text-primary">{getInitials(member.full_name)}</AvatarFallback></Avatar>
                                <div><p className="text-sm font-medium">{member.full_name}</p><p className="text-xs text-muted-foreground">{member.email}</p></div>
                              </div>
                              {manageable && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => { setEditingMember({ ...member }); setEditOpen(true); }}><Edit className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleToggleStatus(member)}>{member.is_active ? 'Deactivate' : 'Activate'}</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => { setTaskAssignTo(member); setTaskDialogOpen(true); }}><ClipboardList className="h-4 w-4 mr-2" /> Assign Task</DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem className="text-destructive" onClick={() => setDeleteConfirmId(member.id)}><Trash2 className="h-4 w-4 mr-2" /> Remove</DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground space-y-1">
                              <p><span className="font-medium text-foreground/80">Org name:</span> {memberOrgDisplayName(member) || '—'}</p>
                              <p><span className="font-medium text-foreground/80">Team:</span> {member.reports_to_name || '—'}</p>
                            </div>
                            {isL1OperationalRole(member.role) && (
                              <div className="pt-2">
                                <Label className="text-[10px] text-muted-foreground">Assigned manager</Label>
                                {renderManagerAssignSelect(member, true)}
                              </div>
                            )}
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant={member.is_active ? 'default' : 'secondary'} className={member.is_active ? 'bg-emerald-500/10 text-emerald-600 border-emerald-200' : ''}>{member.is_active ? 'active' : 'inactive'}</Badge>
                              {member.phone && <span className="text-xs text-muted-foreground">{member.phone}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="pl-6 w-12">#</TableHead><TableHead>Member</TableHead><TableHead>Contact</TableHead>
                            <TableHead>Org name</TableHead><TableHead>Manager</TableHead>
                            <TableHead>Status</TableHead><TableHead>Joined</TableHead>{manageable && <TableHead className="w-10"></TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {members.map((member, index) => {
                            const orgLabel = memberOrgDisplayName(member);
                            return (
                            <TableRow key={member.id}>
                              <TableCell className="pl-6 text-muted-foreground font-medium">{index + 1}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-3"><Avatar className="h-8 w-8"><AvatarFallback className="text-xs bg-primary/10 text-primary">{getInitials(member.full_name)}</AvatarFallback></Avatar>
                                  <div><p className="text-sm font-medium">{member.full_name}</p></div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="space-y-0.5"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="h-3 w-3" />{member.email}</div>
                                  {member.phone && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="h-3 w-3" />{member.phone}</div>}</div>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[140px]">
                                {orgLabel ? (
                                  <span className="line-clamp-2" title={orgLabel}>{orgLabel}</span>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                              <TableCell className="min-w-[160px]">
                                {isL1OperationalRole(member.role)
                                  ? renderManagerAssignSelect(member)
                                  : (
                                    <span className="text-sm text-muted-foreground">{member.reports_to_name || '—'}</span>
                                  )}
                              </TableCell>
                              <TableCell><Badge variant={member.is_active ? 'default' : 'secondary'} className={member.is_active ? 'bg-emerald-500/10 text-emerald-600 border-emerald-200 hover:bg-emerald-500/20' : ''}>{member.is_active ? 'active' : 'inactive'}</Badge></TableCell>
                              <TableCell className="text-sm text-muted-foreground">{new Date(member.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</TableCell>
                              {manageable && (
                                <TableCell>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={() => { setEditingMember({ ...member }); setEditOpen(true); }}><Edit className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => handleToggleStatus(member)}>{member.is_active ? 'Deactivate' : 'Activate'}</DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => { setTaskAssignTo(member); setTaskDialogOpen(true); }}><ClipboardList className="h-4 w-4 mr-2" /> Assign Task</DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem className="text-destructive" onClick={() => setDeleteConfirmId(member.id)}><Trash2 className="h-4 w-4 mr-2" /> Remove</DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </TableCell>
                              )}
                            </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );

          return [roleCollapsible];
        })}
        {Object.keys(grouped).length === 0 && (
          <p className="text-center py-12 text-muted-foreground">No team members found</p>
        )}
      </div>

      {/* Add Member Dialog */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAddOpen(false);
          } else {
            setAddOpen(true);
          }
        }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Full Name *</Label>
              <Input
                value={newMember.full_name}
                onChange={(e) => setNewMember((p) => ({ ...p, full_name: e.target.value }))}
                placeholder="Enter full name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input
                type="email"
                value={newMember.email}
                onChange={(e) => setNewMember((p) => ({ ...p, email: e.target.value }))}
                placeholder="Enter email"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input
                value={newMember.phone}
                onChange={(e) => setNewMember((p) => ({ ...p, phone: e.target.value }))}
                placeholder="+91 XXXXX XXXXX"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Default Password</Label>
              <Input
                value={newMember.password}
                onChange={(e) => setNewMember((p) => ({ ...p, password: e.target.value }))}
                placeholder="Auto-generated secure password"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={newMember.role}
                onValueChange={(v) =>
                  setNewMember((p) => ({
                    ...p,
                    role: v,
                    reports_to_id: isL1OperationalRole(v) ? p.reports_to_id : '',
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isL1OperationalRole(newMember.role) && canAssignTeam && (
              <div className="space-y-1.5">
                <Label>Assign to manager</Label>
                <Select
                  value={newMember.reports_to_id || 'none'}
                  onValueChange={(v) => setNewMember((p) => ({ ...p, reports_to_id: v === 'none' ? '' : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select manager (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {activeManagers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isL1OperationalRole(newMember.role) && isManagerViewer && (
              <p className="text-xs text-muted-foreground">
                New members are automatically assigned to you as their manager.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              The member is added to your team immediately. On the next step you can optionally email login credentials from support@syncpedia.in.
            </p>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addMemberLoading}>
              Cancel
            </Button>
            <Button onClick={() => void handleAddMember()} disabled={addMemberLoading || !newMember.full_name?.trim() || !newMember.email?.trim()}>
              {addMemberLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add Member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review + send welcome email */}
      <Dialog
        open={addReviewOpen}
        onOpenChange={(open) => {
          if (!open && !sendWelcomeLoading) {
            setAddReviewOpen(false);
          }
        }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send welcome email</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-1">
            This member is already on your team. Send login credentials by email, or skip and share them manually.
          </p>
          <div className="rounded-lg border border-border/80 bg-muted/20 px-4 py-3 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground shrink-0">Full name</span>
              <span className="font-medium text-right text-foreground">{newMember.full_name.trim() || '—'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground shrink-0">Email</span>
              <span className="font-medium text-right break-all text-foreground">{newMember.email.trim() || '—'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground shrink-0">Phone</span>
              <span className="font-medium text-right text-foreground">{newMember.phone.trim() || '—'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground shrink-0">Password</span>
              <span className="font-mono text-xs font-medium text-right break-all text-foreground">{newMember.password}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground shrink-0">Role</span>
              <span className="font-medium text-right text-foreground">
                {getRoleInfo(newMember.role).label}
              </span>
            </div>
            {isL1OperationalRole(newMember.role) && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Manager</span>
                <span className="font-medium text-right text-foreground">
                  {isManagerViewer
                    ? (user as { full_name?: string })?.full_name || 'You'
                    : newMember.reports_to_id
                      ? activeManagers.find((m) => m.id === newMember.reports_to_id)?.full_name || '—'
                      : 'Unassigned'}
                </span>
              </div>
            )}
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={sendWelcomeLoading}
              onClick={handleSkipWelcomeEmail}
            >
              Skip for now
            </Button>
            <Button
              type="button"
              className="gap-2 bg-[#2ed573] text-[#0f2318] hover:bg-[#26c968]"
              disabled={sendWelcomeLoading || !createdMemberId}
              onClick={() => void handleSendWelcomeEmail()}
            >
              {sendWelcomeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send mail
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Member Dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setEditingMember(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader><DialogTitle>Edit Team Member</DialogTitle></DialogHeader>
          {editingMember && (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5"><Label>Full Name</Label><Input value={editingMember.full_name} onChange={e => setEditingMember(p => p ? { ...p, full_name: e.target.value } : p)} /></div>
              <div className="space-y-1.5"><Label>Phone</Label><Input value={editingMember.phone || ''} onChange={e => setEditingMember(p => p ? { ...p, phone: e.target.value } : p)} /></div>
              <div className="space-y-1.5"><Label>Role</Label>
                <Select
                  value={editingMember.role}
                  onValueChange={(v) =>
                    setEditingMember((p) =>
                      p
                        ? {
                            ...p,
                            role: v,
                            reports_to_id: isL1OperationalRole(v) ? p.reports_to_id : null,
                            reports_to_name: isL1OperationalRole(v) ? p.reports_to_name : null,
                          }
                        : p,
                    )
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{assignableRoles.map(r => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {canAssignTeam && isL1OperationalRole(editingMember.role) && (
                <div className="space-y-1.5">
                  <Label>Assign to manager</Label>
                  <Select
                    value={editingMember.reports_to_id || 'none'}
                    onValueChange={(v) =>
                      setEditingMember((p) =>
                        p
                          ? {
                              ...p,
                              reports_to_id: v === 'none' ? null : v,
                              reports_to_name:
                                v === 'none'
                                  ? null
                                  : managersForL1Member(p).find((m) => m.id === v)?.full_name ?? p.reports_to_name,
                            }
                          : p,
                      )
                    }
                  >
                    <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {managersForL1Member(editingMember).map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2"><Button variant="outline" onClick={() => { setEditOpen(false); setEditingMember(null); }}>Cancel</Button><Button onClick={handleEdit}>Save Changes</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent className="max-w-[95vw] sm:max-w-lg">
          <AlertDialogHeader><AlertDialogTitle>Remove Team Member</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to remove <strong>{team.find(m => m.id === deleteConfirmId)?.full_name}</strong>?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>No</AlertDialogCancel><AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Yes, Remove</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Assign Task Dialog */}
      <Dialog open={taskDialogOpen} onOpenChange={(open) => { setTaskDialogOpen(open); if (!open) setTaskAssignTo(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader><DialogTitle>Assign Task to {taskAssignTo?.full_name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><Label>Title *</Label><Input value={taskForm.title} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))} placeholder="Task title" /></div>
            <div className="space-y-1.5"><Label>Description</Label><Textarea value={taskForm.description} onChange={e => setTaskForm(p => ({ ...p, description: e.target.value }))} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Due Date</Label><Input type="datetime-local" value={taskForm.due_date} onChange={e => setTaskForm(p => ({ ...p, due_date: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Priority</Label>
                <Select value={taskForm.priority} onValueChange={v => setTaskForm(p => ({ ...p, priority: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="urgent">Urgent</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2"><Button variant="outline" onClick={() => setTaskDialogOpen(false)}>Cancel</Button><Button onClick={handleAssignTask} disabled={!taskForm.title}>Assign Task</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
