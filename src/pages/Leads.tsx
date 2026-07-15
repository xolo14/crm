import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { sendNotificationWithEmail } from '@/lib/notifications';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  Plus, Search, Filter, Download, Upload, MoreHorizontal, Pencil, Trash2, Loader2, Phone, Mail,
  UserPlus, Users, Target, CheckCircle2, Clock, Eye, History, CalendarDays, Building2, GraduationCap,
  StickyNote, ArrowUpRight, XCircle, Shuffle, ChevronLeft, ChevronRight, Megaphone, Globe2,
  MessageCircle, MapPin, School, CircleHelp, Youtube, FileText, Upload as UploadIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BulkActionsBar } from '@/components/BulkActions';
import { BulkAssignDialog } from '@/components/BulkAssignDialog';
import { LeadActivityTimeline } from '@/components/LeadActivityTimeline';
import { LeadEnrollDialog } from '@/components/leads/LeadEnrollDialog';
import { FormSubmissionDetails } from '@/components/leads/FormSubmissionDetails';
import { SourceLeadsDialog } from '@/components/leads/SourceLeadsDialog';
import * as perms from '@/lib/permissions';
import { isMarketingFamilyRole } from '@/lib/roleUtils';
import { mapCsvRowsToLeads, parseCsvText } from '@/lib/leadImportCsv';
import {
  IMPORT_SET_PREFIX,
  buildSourceSummaries,
  filterLeadsBySourceBucket,
  type LeadSourceBucket,
} from '@/lib/leadSources';
import { useIsMobile } from '@/hooks/use-mobile';

const LEAD_STATUSES = ['new', 'contacted', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'] as const;

const formatLeadStatus = (s?: string | null) => {
  if (!s) return '';
  if (s === 'enrolled' || s === 'converted') return 'Enroll';
  return s.replace(/_/g, ' ');
};

const statusBadgeKey = (s?: string | null) => (s === 'converted' ? 'enrolled' : s || '');
const LEAD_SOURCES = ['google_ads', 'instagram', 'facebook', 'youtube', 'website', 'normal_form', 'google_forms', 'whatsapp', 'referral', 'walkin', 'college_seminar', 'other'] as const;

const statusColors: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-700 border-blue-200',
  contacted: 'bg-amber-500/10 text-amber-700 border-amber-200',
  interested: 'bg-emerald-500/10 text-emerald-700 border-emerald-200',
  demo_scheduled: 'bg-indigo-500/10 text-indigo-700 border-indigo-200',
  demo_attended: 'bg-violet-500/10 text-violet-700 border-violet-200',
  considering: 'bg-orange-500/10 text-orange-700 border-orange-200',
  enrolled: 'bg-teal-500/10 text-teal-800 border-teal-200',
  converted: 'bg-green-500/10 text-green-700 border-green-200',
  lost: 'bg-red-500/10 text-red-700 border-red-200',
};

const statusIcons: Record<string, any> = {
  new: Clock, contacted: Phone, interested: Target, demo_scheduled: CalendarDays,
  demo_attended: CheckCircle2, considering: Eye, enrolled: GraduationCap, converted: ArrowUpRight, lost: XCircle,
};

const SOURCE_LABELS: Record<string, string> = {
  google_ads: 'Google Ads', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube',
  website: 'Website', normal_form: 'Normal Form', google_forms: 'Google Forms', whatsapp: 'WhatsApp', referral: 'Referral',
  walkin: 'Walk-in', college_seminar: 'College Seminar', other: 'Other',
};

const SALES_MEMBER_ROLES = new Set(['sales_representative']);
const isAssignableRole = (role?: string | null) => {
  const normalized = String(role || '').trim().toLowerCase();
  return SALES_MEMBER_ROLES.has(normalized) || isMarketingFamilyRole(normalized);
};
const isActiveMember = (value: any) => value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true';
const normalizeMember = (m: any) => ({
  id: m.id,
  full_name: m.full_name || m.name || m.email || 'User',
  email: m.email || '',
  phone: m.phone || '',
  role: String(m.role || 'marketing').trim().toLowerCase(),
  is_active: isActiveMember(m.is_active),
  created_at: m.created_at || new Date().toISOString(),
  org_id: m.org_id != null && String(m.org_id).trim() !== '' ? String(m.org_id).trim() : undefined,
});
const getRoleCategoryLabel = (role?: string | null) => {
  const normalized = String(role || '').trim().toLowerCase();
  if (isMarketingFamilyRole(normalized)) return 'Marketing';
  if (normalized === 'sales_representative') return 'Sales Representative';
  if (normalized === 'manager') return 'Manager';
  return normalized ? normalized.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Other';
};

const SOURCE_BUCKET_ICONS: Record<LeadSourceBucket, LucideIcon> = {
  google_ads: Megaphone,
  meta_ads: Megaphone,
  youtube: Youtube,
  website: Globe2,
  form_leads: FileText,
  import: UploadIcon,
  whatsapp: MessageCircle,
  referral: Users,
  walkin: MapPin,
  college_seminar: School,
  other: CircleHelp,
};

const SOURCE_STATUS_CHIP_ORDER = ['new', 'contacted', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'] as const;

export default function Leads() {
  const { toast } = useToast();
  const { user, role, profile, organization } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const isFormLeadsPage = location.pathname === '/leads/form-leads';
  const useSourceCards = location.pathname === '/leads';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<any>(null);
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
   const [assignOpen, setAssignOpen] = useState(false);
  const [assignLeadId, setAssignLeadId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [detailLead, setDetailLead] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [leadAssignments, setLeadAssignments] = useState<Record<string, string[]>>({});
  const [assignSelectedReps, setAssignSelectedReps] = useState<Set<string>>(new Set());
  const [assignSaving, setAssignSaving] = useState(false);
  const [enrollLead, setEnrollLead] = useState<any | null>(null);
  const [leadForms, setLeadForms] = useState<{ slug: string; name: string }[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importOrgId, setImportOrgId] = useState('');
  const [importOrgs, setImportOrgs] = useState<{ id: string; name: string }[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [sourceDialogKey, setSourceDialogKey] = useState<LeadSourceBucket | null>(null);
  const [sourceDialogStatus, setSourceDialogStatus] = useState<string>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasCreate = perms.canCreate(role);
  const hasEditAll = perms.canEditAll(role);
  const hasDelete = perms.canDelete(role);
  const hasBulkDelete = perms.canBulkDelete(role);
  const hasImport = perms.canImport(role);
  const hasExport = perms.canExport(role);
  const isManager =
    role === 'admin' || role === 'org' || role === 'super_admin' || role === 'manager';
  const normalizedLeadRole = String(role || '')
    .trim()
    .toLowerCase()
    .replace(/^superadmin$/, 'super_admin')
    .replace(/^organisation$/, 'org');
  /** Sales rep / exec: hub lists all org-visible rows from API; My Leads shows only referral-link form submissions. */
  const isSalesRepMyLeadsPage =
    location.pathname === '/my-leads' &&
    SALES_MEMBER_ROLES.has(normalizedLeadRole);
  const rosterMarketingLike = isMarketingFamilyRole(normalizedLeadRole);
  /** Includes managers plus roles that assign leads using same-org reps */
  const needsAssignmentRoster =
    isManager ||
    rosterMarketingLike ||
    normalizedLeadRole === 'hr';
  const scopeLabel = normalizedLeadRole === 'super_admin'
    ? 'Scope: all leads'
    : normalizedLeadRole === 'admin' || normalizedLeadRole === 'org'
      ? 'Scope: organization leads'
      : normalizedLeadRole === 'manager'
        ? 'Scope: own + team leads'
        : isSalesRepMyLeadsPage
          ? 'Scope: your referral forms only'
          : rosterMarketingLike || normalizedLeadRole === 'hr'
            ? 'Scope: your assigned, referred & created leads'
            : 'Scope: own leads';

  useEffect(() => {
    fetchLeads();
    if (needsAssignmentRoster) {
      fetchTeam();
      fetchProfiles();
      fetchAssignments();
    }
    if (!isFormLeadsPage) {
      api.forms.list()
        .then((res) => {
          const rows = Array.isArray(res) ? res : res?.data || [];
          setLeadForms(
            rows
              .filter((f: { slug?: string; name?: string }) => f?.slug && f?.name)
              .map((f: { slug: string; name: string }) => ({ slug: String(f.slug), name: String(f.name) })),
          );
        })
        .catch(() => {});
    }
  }, [isFormLeadsPage, isSalesRepMyLeadsPage, role, profile?.referral_code]);

  const fetchAssignments = async () => {
    try {
      const result = await api.leadAssignments.list();
      const data = result?.data || [];
      const map: Record<string, string[]> = {};
      (data || []).forEach((a: any) => {
        if (!map[a.lead_id]) map[a.lead_id] = [];
        map[a.lead_id].push(a.user_id);
      });
      setLeadAssignments(map);
    } catch {}
  };

  const fetchProfiles = async () => {
    try {
      const data = await api.profiles.list();
      setProfiles((Array.isArray(data) ? data : data.profiles || data.data || []).filter((p: any) => p.referral_code));
    } catch {}
  };

  const codeToName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of profiles) { if (p.referral_code) map[p.referral_code] = p.full_name || 'Unknown'; }
    return map;
  }, [profiles]);

  const codeToUserId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of profiles) { if (p.referral_code) map[p.referral_code] = p.user_id; }
    return map;
  }, [profiles]);

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const data = await api.leads.list();
      const allLeads = data.data || [];
      const isFormLead = (l: any) => !!l.referred_by || l.source === 'google_forms';

      if (isFormLeadsPage) {
        // Form Leads page: only form-generated leads.
        setLeads(allLeads.filter(isFormLead));
      } else if (isSalesRepMyLeadsPage) {
        const code = String(profile?.referral_code ?? '').trim();
        setLeads(
          allLeads.filter((l: any) => {
            if (!l?.referred_by) return false;
            if (code) return String(l.referred_by).trim() === code;
            return true;
          }),
        );
      } else {
        // Main leads / hub: show ALL rows returned by API for this user.
        setLeads(allLeads);
      }
    } catch (err) { console.error('Failed to load leads:', err); }
    finally { setLoading(false); }
  };

  const fetchTeam = async () => {
    try {
      const [teamRes, marketingRes] = await Promise.allSettled([
        api.team.list(),
        // Managers: only hierarchy roster — marketing.members includes org peers outside reports_to
        // and assigning to them hides the lead from the manager list.
        normalizedLeadRole === 'manager'
          ? Promise.resolve({ data: [] })
          : api.marketing.members(),
      ]);

      const teamRows =
        teamRes.status === 'fulfilled'
          ? (teamRes.value?.data || []).map((m: any) => normalizeMember(m))
          : [];

      const marketingRows =
        marketingRes.status === 'fulfilled'
          ? (marketingRes.value?.data || []).map((m: any) =>
              normalizeMember({
                id: m.user_id || m.id,
                full_name: m.name || m.full_name,
                email: m.email,
                phone: m.phone,
                role: 'marketing',
                is_active: m.status ? String(m.status).toLowerCase() === 'active' : 1,
                created_at: m.created_at,
                org_id: m.org_id,
              })
            )
          : [];

      const mergedById = new Map<string, any>();
      [...marketingRows, ...teamRows]
        .filter((m: any) => m.id && isAssignableRole(m.role) && isActiveMember(m.is_active))
        .forEach((m: any) => mergedById.set(m.id, m));

      setTeamMembers(Array.from(mergedById.values()));
    } catch {}
  };

  const canEditLead = (lead: any) => hasEditAll || lead.assigned_to === user?.id;
  const canDeleteLead = () => hasDelete;

  const handleExport = () => {
    const headers = ['S.No', 'Name', 'Email', 'Phone', 'College', 'Course Interest', 'Source', 'Status', 'Assigned To', 'Created'];
    const rows = filtered.map((l, i) => [i + 1, l.name, l.email, l.phone, l.college, l.course_interest, l.source, l.status, getAssignedName(l.assigned_to), l.created_at]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v || ''}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Leads exported successfully' });
  };

  const isSuperAdmin = normalizedLeadRole === 'super_admin';
  const importTargetOrgName = useMemo(() => {
    if (isSuperAdmin) {
      return importOrgs.find((o) => o.id === importOrgId)?.name || '';
    }
    return organization?.name || '';
  }, [isSuperAdmin, importOrgs, importOrgId, organization?.name]);

  useEffect(() => {
    if (!isSuperAdmin || !hasImport) return;
    void (async () => {
      try {
        const res = (await api.organizations.list()) as { data?: Array<{ id?: string; name?: string }> };
        const rows = Array.isArray(res?.data) ? res.data : [];
        const opts = rows
          .map((o) => ({ id: String(o.id || '').trim(), name: String(o.name || 'Unnamed').trim() }))
          .filter((o) => o.id);
        setImportOrgs(opts);
        const preferred = String(organization?.id || '').trim();
        if (preferred && opts.some((o) => o.id === preferred)) {
          setImportOrgId(preferred);
        } else if (opts[0] && !importOrgId) {
          setImportOrgId(opts[0].id);
        }
      } catch {
        setImportOrgs([]);
      }
    })();
  }, [isSuperAdmin, hasImport, organization?.id]);

  const runCsvImport = async (file: File, orgIdForImport?: string) => {
    setImportBusy(true);
    try {
      const text = await file.text();
      const importSetTag = `${IMPORT_SET_PREFIX}${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
      const { leads: mapped, skipped, errors } = mapCsvRowsToLeads(parseCsvText(text), { importSetTag });
      if (mapped.length === 0) {
        toast({
          variant: 'destructive',
          title: 'No leads imported',
          description: errors[0] || 'CSV needs a header and at least one row with name, phone, or email.',
        });
        return;
      }
      const payload = mapped.map((row) => ({
        ...row,
        ...(role === 'manager' && user?.id ? { assigned_to: user.id } : {}),
      }));
      const res: any = await api.leads.bulkCreate(
        payload,
        orgIdForImport ? { org_id: orgIdForImport } : undefined,
      );
      const created = Number(res?.created ?? mapped.length);
      const orgLabel = res?.org_name || importTargetOrgName || organization?.name || '';
      fetchLeads();
      toast({
        title: `${created} leads imported`,
        description: [
          orgLabel ? `Organization: ${orgLabel}` : null,
          `Import set: ${importSetTag.replace(IMPORT_SET_PREFIX, '')}`,
          skipped ? `${skipped} row(s) skipped` : null,
          Array.isArray(res?.errors) && res.errors.length ? `${res.errors.length} row error(s)` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      });
      setImportOpen(false);
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Import failed',
        description: err?.message || 'Could not import CSV',
      });
    } finally {
      setImportBusy(false);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void runCsvImport(file, isSuperAdmin ? importOrgId : undefined);
  };

  const openImport = () => {
    if (isSuperAdmin) {
      setImportOpen(true);
      return;
    }
    fileInputRef.current?.click();
  };
  const filtered = useMemo(() => {
    return leads.filter((lead) => {
      const matchSearch = !search || lead.name?.toLowerCase().includes(search.toLowerCase()) || lead.email?.toLowerCase().includes(search.toLowerCase()) || lead.phone?.includes(search);
      const matchStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'enrolled' || statusFilter === 'converted'
            ? lead.status === 'enrolled' || lead.status === 'converted'
            : lead.status === statusFilter;
      const matchSource = sourceFilter === 'all' || lead.source === sourceFilter;
      const matchUnassigned = !unassignedOnly || !lead.assigned_to;
      return matchSearch && matchStatus && matchSource && matchUnassigned;
    });
  }, [leads, search, statusFilter, sourceFilter, unassignedOnly]);
  const groupedTeamMembers = useMemo(() => {
    const groups: Record<string, any[]> = {};
    teamMembers.forEach((member) => {
      const label = getRoleCategoryLabel(member.role);
      if (!groups[label]) groups[label] = [];
      groups[label].push(member);
    });
    return groups;
  }, [teamMembers]);

  useEffect(() => { setCurrentPage(1); }, [search, statusFilter, sourceFilter, unassignedOnly]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedLeads = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  const totalLeads = leads.length;
  const newLeads = leads.filter(l => l.status === 'new').length;
  const inPipeline = leads.filter(l => ['interested', 'demo_scheduled', 'demo_attended'].includes(l.status)).length;
  const enrollLeads = leads.filter(l => l.status === 'enrolled' || l.status === 'converted').length;
  const lostLeads = leads.filter(l => l.status === 'lost').length;
  const unassignedCount = leads.filter(l => !l.assigned_to).length;
  const convRate = totalLeads > 0 ? Math.round((enrollLeads / totalLeads) * 100) : 0;

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.leads.update(id, { status });
      setLeads(prev => prev.map(l => l.id === id ? { ...l, status } : l));
      if (status === 'enrolled') {
        toast({ title: 'Enroll', description: 'Lead status set to Enroll and a student record was created (if not already).' });
      } else {
        toast({ title: `Status updated to ${formatLeadStatus(status)}` });
      }
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
  };

  const onLeadStatusSelect = (lead: any, newStatus: string) => {
    if (!newStatus) return;
    if (newStatus === 'enrolled') {
      const em = String(lead?.email || '').trim();
      if (!em) {
        toast({
          variant: 'destructive',
          title: 'Email required',
          description: 'Add an email on the lead before enrolling.',
        });
        return;
      }
      setEnrollLead(lead);
      return;
    }
    void updateStatus(lead.id, newStatus);
  };

  const handleCreate = async (data: any) => {
    try {
      const payload = { ...data };
      if (SALES_MEMBER_ROLES.has(normalizedLeadRole)) {
        const at = payload.assigned_to;
        if (at === '' || at == null) {
          payload.assigned_to = user?.id;
        }
        const ref = String(profile?.referral_code ?? '').trim();
        if (ref && !String(payload.referred_by ?? '').trim()) {
          payload.referred_by = ref;
        }
      }
      // Managers only see downline-assigned / self-created leads — default assign to self
      if (normalizedLeadRole === 'manager') {
        const at = payload.assigned_to;
        if (at === '' || at == null || at === 'unassigned') {
          payload.assigned_to = user?.id;
        }
      }
      // Form Leads page only lists form/referral rows — stamp referral so manual adds appear
      if (isFormLeadsPage) {
        const ref = String(profile?.referral_code ?? '').trim();
        if (ref && !String(payload.referred_by ?? '').trim()) {
          payload.referred_by = ref;
        }
      }
      await api.leads.create(payload);
      fetchLeads();
      toast({ title: 'Lead created successfully' });
      setDialogOpen(false);
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
  };

  const handleEdit = async (data: any) => {
    if (!editingLead) return;
    try {
      await api.leads.update(editingLead.id, data);
      fetchLeads();
      toast({ title: 'Lead updated successfully' });
      setEditDialogOpen(false);
      setEditingLead(null);
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
  };

  const handleDelete = async (id: string) => {
    if (!canDeleteLead()) { toast({ variant: 'destructive', title: 'Permission denied' }); return; }
    if (confirm('Delete this lead permanently?')) {
      try { await api.leads.delete(id); setLeads(prev => prev.filter(l => l.id !== id)); toast({ title: 'Lead deleted' }); }
      catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
    }
  };

  const handleBulkDelete = async (idsOverride?: string[]) => {
    const ids = idsOverride ?? Array.from(selectedIds);
    const count = ids.length;
    if (count === 0) return;
    if (!idsOverride && !confirm(`Delete ${count} leads permanently?`)) return;
    try {
      const res = await api.leads.bulkDelete(ids);
      const deleted = typeof res?.deleted === 'number' ? res.deleted : count;
      const skipped = typeof res?.skipped === 'number' ? res.skipped : 0;
      await fetchLeads();
      setSelectedIds(new Set());
      toast({
        title: `${deleted} leads deleted`,
        description: skipped > 0 ? `${skipped} skipped (not found or no permission)` : undefined,
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Bulk delete failed', description: err?.message || 'Request failed' });
    }
  };

  const handleMultiAssign = async () => {
    if (!assignLeadId || assignSelectedReps.size === 0) return;
    setAssignSaving(true);
    try {
      // Delete existing assignments for this lead, then recreate via PHP API.
      const existing = await api.leadAssignments.list(assignLeadId);
      for (const a of existing?.data || []) {
        if (a?.id) await api.leadAssignments.delete(a.id);
      }
      for (const uid of Array.from(assignSelectedReps)) {
        await api.leadAssignments.assign({ lead_id: assignLeadId, user_id: uid });
      }
      // Update assigned_to with first selected rep for backward compat
      const firstRep = Array.from(assignSelectedReps)[0];
      await api.leads.update(assignLeadId, { assigned_to: firstRep });
      setLeads(prev => prev.map(l => l.id === assignLeadId ? { ...l, assigned_to: firstRep } : l));
      setLeadAssignments(prev => ({ ...prev, [assignLeadId]: Array.from(assignSelectedReps) }));
      const repNames = Array.from(assignSelectedReps).map(id => getAssignedName(id)).filter(Boolean).join(', ');
      toast({ title: `Lead assigned to ${repNames}` });
      // Send notifications to all assigned reps
      const lead = leads.find(l => l.id === assignLeadId);
      for (const repId of assignSelectedReps) {
        await sendNotificationWithEmail({
          userId: repId,
          title: 'New Lead Assigned',
          message: `Lead "${lead?.name || 'Unknown'}" has been assigned to you.`,
          type: 'lead_assigned',
          link: '/leads',
          leadName: lead?.name || 'Unknown',
          assignedByName: profile?.full_name || 'Manager',
        });
      }
      setAssignOpen(false);
      setAssignLeadId(null);
      setAssignSelectedReps(new Set());
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
    finally { setAssignSaving(false); }
  };

  const handleBulkAssign = async (repId: string, leadIds?: string[]) => {
    const ids = leadIds ?? Array.from(selectedIds);
    if (ids.length === 0) return;
    const assignedLeadNames: string[] = [];
    for (const id of ids) {
      try {
        await api.leads.update(id, { assigned_to: repId });
        const lead = leads.find(l => l.id === id);
        if (lead) assignedLeadNames.push(lead.name);
      } catch {}
    }
    try {
      await api.leadAssignments.bulkAssign(ids, repId);
    } catch {}
    const assigneePatch = Object.fromEntries(ids.map((id) => [id, true]));
    setLeads((prev) =>
      prev.map((l) => (assigneePatch[l.id] ? { ...l, assigned_to: repId } : l)),
    );
    fetchLeads();
    fetchAssignments();
    const repName = teamMembers.find(m => m.id === repId)?.full_name || 'Rep';
    toast({ title: `${ids.length} leads assigned to ${repName}` });
    await sendNotificationWithEmail({
      userId: repId,
      title: `${ids.length} Leads Assigned`,
      message: `You have been assigned ${ids.length} new leads: ${assignedLeadNames.slice(0, 3).join(', ')}${assignedLeadNames.length > 3 ? '...' : ''}.`,
      type: 'lead_assigned',
      link: '/leads',
      leadName: assignedLeadNames.slice(0, 3).join(', '),
      assignedByName: profile?.full_name || 'Manager',
    });
    setSelectedIds(new Set());
  };

  const handleBulkAutoAssign = async (count: number, repIds: string[]) => {
    setBulkAssigning(true);
    try {
      const toAssign = leads.slice(0, count);
      if (toAssign.length === 0) return;
      const repAssignments: Record<string, string[]> = {};
      repIds.forEach(id => { repAssignments[id] = []; });
      toAssign.forEach((lead, i) => {
        const repId = repIds[i % repIds.length];
        repAssignments[repId].push(lead.id);
      });
      let totalAssigned = 0;
      for (const [repId, leadIds] of Object.entries(repAssignments)) {
        const names: string[] = [];
        for (const lid of leadIds) {
          try { await api.leads.update(lid, { assigned_to: repId }); totalAssigned++; const l = leads.find(x => x.id === lid); if (l) names.push(l.name); } catch {}
        }
        if (names.length > 0) {
          await sendNotificationWithEmail({
            userId: repId, title: `${names.length} Leads Assigned`,
            message: `You have been assigned ${names.length} new leads: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '...' : ''}.`,
            type: 'lead_assigned', link: '/leads',
            leadName: names.slice(0, 3).join(', '), assignedByName: profile?.full_name || 'Manager',
          });
        }
      }
      fetchLeads();
      toast({ title: `${totalAssigned} leads distributed across ${repIds.length} reps` });
    } finally { setBulkAssigning(false); }
  };

  const openEdit = (lead: any) => {
    if (!canEditLead(lead)) { toast({ variant: 'destructive', title: 'Permission denied' }); return; }
    setEditingLead(lead); setEditDialogOpen(true);
  };

  const openDetail = (lead: any) => {
    setDetailLead(lead);
    setDetailOpen(true);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(l => l.id)));
  };
  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < filtered.length;

  const getAssignedName = (id: string) => {
    const member = teamMembers.find(m => m.id === id);
    if (member) return member.full_name;
    const prof = profiles.find(p => p.user_id === id);
    return prof?.full_name || '';
  };

  const getLeadAssignedNames = (lead: any) => {
    const assignedUserIds = leadAssignments[lead.id] || (lead.assigned_to ? [lead.assigned_to] : []);
    return assignedUserIds.map((id: string) => getAssignedName(id)).filter(Boolean);
  };

  const openAssignDialog = (leadId: string) => {
    const currentAssignees = leadAssignments[leadId] || [];
    const lead = leads.find(l => l.id === leadId);
    if (currentAssignees.length > 0) {
      setAssignSelectedReps(new Set(currentAssignees));
    } else if (lead?.assigned_to) {
      setAssignSelectedReps(new Set([lead.assigned_to]));
    } else {
      setAssignSelectedReps(new Set());
    }
    setAssignLeadId(leadId);
    setAssignOpen(true);
  };

  // Get unique sources for source filter tabs
  const availableSources = useMemo(() => {
    const sources = new Set(leads.map(l => l.source).filter(Boolean));
    return Array.from(sources);
  }, [leads]);

  const formSourceKey = (slug: string) => `form_${slug}`;

  const extendedSourceLabels = useMemo(() => {
    const labels: Record<string, string> = { ...SOURCE_LABELS };
    leadForms.forEach((f) => {
      labels[formSourceKey(f.slug)] = f.name;
    });
    availableSources.forEach((s) => {
      if (s.startsWith('form_') && !labels[s]) {
        labels[s] = s.replace(/^form_/, '').replace(/_/g, ' ');
      }
    });
    return labels;
  }, [leadForms, availableSources]);

  const sourceFilterOptions = useMemo(() => {
    const formOpts = leadForms.map((f) => ({
      value: formSourceKey(f.slug),
      label: f.name,
    }));
    const seen = new Set(formOpts.map((o) => o.value));
    availableSources.forEach((s) => {
      if (s.startsWith('form_') && !seen.has(s)) {
        formOpts.push({
          value: s,
          label: extendedSourceLabels[s] || s.replace(/^form_/, '').replace(/_/g, ' '),
        });
        seen.add(s);
      }
    });
    const staticOpts = LEAD_SOURCES.filter((s) => !String(s).startsWith('form_')).map((s) => ({
      value: s,
      label: SOURCE_LABELS[s] || s.replace(/_/g, ' '),
    }));
    return [
      ...formOpts.sort((a, b) => a.label.localeCompare(b.label)),
      ...staticOpts,
    ];
  }, [leadForms, availableSources, extendedSourceLabels]);

  const sourceSummaries = useMemo(() => buildSourceSummaries(leads), [leads]);

  const sourceDialogLeads = useMemo(() => {
    if (!sourceDialogKey) return [];
    return filterLeadsBySourceBucket(leads, sourceDialogKey);
  }, [leads, sourceDialogKey]);

  const openSourceDialog = (key: LeadSourceBucket, status: string = 'all') => {
    setSourceDialogKey(key);
    setSourceDialogStatus(status);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            {isSalesRepMyLeadsPage ? 'My Leads' : 'Leads Management'}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {totalLeads}{' '}
            {isFormLeadsPage || isSalesRepMyLeadsPage ? 'form leads' : 'leads'}
            {' · '}
            {unassignedCount > 0 && <span className="text-amber-600 font-medium">{unassignedCount} unassigned</span>}
          </p>
          {!isFormLeadsPage && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{scopeLabel}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          {hasImport && (
            <>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8"
                onClick={openImport}
                disabled={importBusy}
              >
                <Upload className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Import CSV</span>
              </Button>
              {!isSuperAdmin && organization?.name ? (
                <span className="text-[11px] text-muted-foreground hidden md:inline">
                  → {organization.name}
                </span>
              ) : null}
            </>
          )}
          {hasExport && (
            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">Export</span>
            </Button>
          )}
          {isManager && (
            <Button
              size="sm"
              variant="default"
              className="gap-1.5 h-8"
              onClick={() => setBulkAssignOpen(true)}
            >
              <Shuffle className="h-3.5 w-3.5" /><span className="hidden sm:inline">Bulk Assign</span>
            </Button>
          )}
          {isManager && (
            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => navigate('/leads/history')}>
              <History className="h-3.5 w-3.5" /><span className="hidden sm:inline">History</span>
            </Button>
          )}
          {hasCreate && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5 h-8"><Plus className="h-3.5 w-3.5" /><span className="hidden sm:inline">Add Lead</span></Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[min(90dvh,calc(100dvh-2rem))] overflow-y-auto">
                <DialogHeader><DialogTitle>Add New Lead</DialogTitle></DialogHeader>
                <LeadForm
                  onSubmit={handleCreate}
                  teamMembers={isManager ? teamMembers : []}
                  currentUserId={user?.id}
                  showAssignToSelf={normalizedLeadRole === 'manager'}
                />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>


      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3 mb-5">
        {[
          { label: 'Total Leads', value: totalLeads, icon: Users, color: 'text-blue-600', bg: 'bg-blue-500/10', sub: 'Imported' },
          { label: 'New', value: newLeads, icon: Clock, color: 'text-sky-600', bg: 'bg-sky-500/10', sub: 'Untouched' },
          { label: 'In Pipeline', value: inPipeline, icon: Target, color: 'text-amber-600', bg: 'bg-amber-500/10', sub: 'Active' },
          { label: 'Enroll', value: enrollLeads, icon: GraduationCap, color: 'text-teal-700', bg: 'bg-teal-500/10', sub: `${convRate}% won` },
          { label: 'Lost', value: lostLeads, icon: XCircle, color: 'text-red-600', bg: 'bg-red-500/10', sub: 'Dropped' },
          { label: 'Unassigned', value: unassignedCount, icon: UserPlus, color: 'text-amber-600', bg: 'bg-amber-500/10', sub: 'Need action' },
        ].map(c => (
          <Card key={c.label} className={`border-border/50 shadow-none ${useSourceCards ? '' : 'hover:shadow-md transition-shadow cursor-pointer'}`} onClick={() => {
            if (useSourceCards) return;
            if (c.label === 'Unassigned') {
              setUnassignedOnly(true);
              setStatusFilter('all');
              setSourceFilter('all');
            } else {
              setUnassignedOnly(false);
              if (c.label === 'New') setStatusFilter('new');
              else if (c.label === 'Enroll') setStatusFilter('enrolled');
              else if (c.label === 'Lost') setStatusFilter('lost');
              else setStatusFilter('all');
            }
          }}>
            <CardContent className="pt-3 pb-2.5 px-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{c.label}</span>
                <div className={`h-6 w-6 rounded-md ${c.bg} flex items-center justify-center`}><c.icon className={`h-3 w-3 ${c.color}`} /></div>
              </div>
              <div className="text-lg font-bold">{c.value}</div>
              <p className="text-[10px] text-muted-foreground">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {useSourceCards ? (
        <>
          <div className="mb-2">
            <h2 className="text-sm font-semibold tracking-tight">Leads by source</h2>
            <p className="text-xs text-muted-foreground">Open a source to view leads, filter by status, and bulk assign.</p>
          </div>
          {sourceSummaries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 rounded-lg border border-dashed border-border/60">
              <Users className="h-12 w-12 text-muted-foreground/20 mb-4" />
              <p className="text-sm font-medium text-muted-foreground">No leads yet</p>
              <p className="text-xs text-muted-foreground mt-1">Import a CSV or add a lead to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {sourceSummaries.map((summary) => {
                const Icon = SOURCE_BUCKET_ICONS[summary.key] || CircleHelp;
                const statusChips = SOURCE_STATUS_CHIP_ORDER.filter((s) => (summary.byStatus[s] || 0) > 0);
                const visibleChips = statusChips.slice(0, 4);
                const hiddenChipCount = statusChips.length - visibleChips.length;
                return (
                  <Card
                    key={summary.key}
                    className="border-border/50 shadow-none hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group"
                    onClick={() => openSourceDialog(summary.key, 'all')}
                  >
                    <CardContent className="pt-4 pb-3 px-4">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                            <Icon className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-sm truncate">{summary.label}</p>
                            <p className="text-xs text-muted-foreground">{summary.total} lead{summary.total === 1 ? '' : 's'}</p>
                          </div>
                        </div>
                        {summary.unassigned > 0 && (
                          <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-200 bg-amber-500/10 shrink-0">
                            {summary.unassigned} unassigned
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {visibleChips.map((status) => (
                          <button
                            key={status}
                            type="button"
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] capitalize transition-colors hover:ring-1 hover:ring-primary/40 min-h-8 ${statusColors[status] || 'bg-muted'}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openSourceDialog(summary.key, status);
                            }}
                          >
                            <span>{formatLeadStatus(status)}</span>
                            <span className="font-semibold tabular-nums">{summary.byStatus[status]}</span>
                          </button>
                        ))}
                        {hiddenChipCount > 0 && (
                          <span className="inline-flex items-center rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground">
                            +{hiddenChipCount} more
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          <SourceLeadsDialog
            open={!!sourceDialogKey}
            onOpenChange={(open) => {
              if (!open) setSourceDialogKey(null);
            }}
            sourceKey={sourceDialogKey}
            initialStatus={sourceDialogStatus}
            leads={sourceDialogLeads}
            teamMembers={teamMembers}
            groupedTeamMembers={groupedTeamMembers}
            isManager={isManager}
            canBulkAssign={isManager || hasBulkDelete}
            canBulkDelete={hasBulkDelete}
            statusColors={statusColors}
            getLeadAssignedNames={getLeadAssignedNames}
            onOpenDetail={openDetail}
            onOpenAssign={openAssignDialog}
            onBulkAssign={handleBulkAssign}
            onBulkDelete={hasBulkDelete ? handleBulkDelete : undefined}
          />
        </>
      ) : (
      <>
      {/* Filters Row */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1 max-w-xs sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name, email, phone..." value={search} onChange={(e: any) => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-9"><Filter className="h-3.5 w-3.5 mr-1.5" /><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {LEAD_STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{formatLeadStatus(s)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Source" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              {sourceFilterOptions.map(s => <SelectItem key={s.value} value={s.value} className="capitalize">{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Active Filters Display */}
      {(statusFilter !== 'all' || sourceFilter !== 'all' || search || unassignedOnly) && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs text-muted-foreground">Filters:</span>
          {statusFilter !== 'all' && (
            <Badge variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => setStatusFilter('all')}>
              Status: {formatLeadStatus(statusFilter)} <XCircle className="h-3 w-3" />
            </Badge>
          )}
          {sourceFilter !== 'all' && (
            <Badge variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => setSourceFilter('all')}>
              Source: {extendedSourceLabels[sourceFilter] || sourceFilter?.replace(/_/g, ' ')} <XCircle className="h-3 w-3" />
            </Badge>
          )}
          {search && (
            <Badge variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => setSearch('')}>
              Search: "{search}" <XCircle className="h-3 w-3" />
            </Badge>
          )}
          {unassignedOnly && (
            <Badge variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => setUnassignedOnly(false)}>
              Unassigned <XCircle className="h-3 w-3" />
            </Badge>
          )}
          <button
            onClick={() => {
              setStatusFilter('all');
              setSourceFilter('all');
              setSearch('');
              setUnassignedOnly(false);
            }}
            className="text-xs text-primary hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Bulk Actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 mb-3 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
          <span className="text-sm font-medium text-primary">{selectedIds.size} selected</span>
          <div className="h-4 w-px bg-border" />
          {isManager && teamMembers.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="gap-1.5 h-7"><UserPlus className="h-3.5 w-3.5" />Assign</Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                {Object.entries(groupedTeamMembers).map(([group, members], idx) => (
                  <div key={group}>
                    {idx > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel>{group}</DropdownMenuLabel>
                    {members.map((m: any) => <DropdownMenuItem key={m.id} onClick={() => handleBulkAssign(m.id)}>{m.full_name}</DropdownMenuItem>)}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {hasBulkDelete && (
            <Button size="sm" variant="destructive" className="h-7 gap-1" onClick={handleBulkDelete}>
              <Trash2 className="h-3 w-3" />Delete
            </Button>
          )}
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-muted-foreground hover:text-foreground ml-auto">Deselect</button>
        </div>
      )}

      {/* Results Count & Pagination Info */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">{filtered.length} of {totalLeads} leads</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Per page:</span>
          <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setCurrentPage(1); }}>
            <SelectTrigger className="h-7 w-[70px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[10, 25, 50, 100].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table / Card View */}
      {isMobile ? (
        <div className="space-y-2.5">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16"><Users className="h-12 w-12 text-muted-foreground/20 mb-4" /><p className="text-sm font-medium text-muted-foreground">No leads found</p><p className="text-xs text-muted-foreground mt-1">Try adjusting your filters</p></div>
          ) : paginatedLeads.map((lead, i) => (
            <div key={lead.id} className="mobile-card p-4 cursor-pointer" onClick={() => openDetail(lead)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] text-muted-foreground font-mono w-5">#{(currentPage - 1) * pageSize + i + 1}</span>
                    <p className="font-semibold text-[15px] truncate leading-tight">{lead.name}</p>
                  </div>
                  {(lead.college || lead.company) && (
                    <p className="text-xs text-muted-foreground ml-7 flex items-center gap-1">
                      {lead.college ? <><GraduationCap className="h-3 w-3 shrink-0" />{lead.college}</> : <><Building2 className="h-3 w-3 shrink-0" />{lead.company}</>}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {canEditLead(lead) ? (
                    <Select
                      value={lead.status === 'converted' ? 'enrolled' : lead.status}
                      onValueChange={(v: string) => {
                        if (v) onLeadStatusSelect(lead, v);
                      }}
                    >
                      <SelectTrigger className="h-7 w-auto border-0 p-0" onClick={(e) => e.stopPropagation()}>
                        <Badge variant="outline" className={`${statusColors[statusBadgeKey(lead.status)]} capitalize text-[11px] px-2 py-0.5`}>{formatLeadStatus(lead.status)}</Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {LEAD_STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{formatLeadStatus(s)}</SelectItem>)}
                        {lead.status === 'considering' && <SelectItem value="considering" className="capitalize">Considering</SelectItem>}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline" className={`${statusColors[statusBadgeKey(lead.status)]} capitalize text-[11px] px-2 py-0.5`}>{formatLeadStatus(lead.status)}</Badge>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openDetail(lead); }}><Eye className="h-4 w-4 mr-2" /> View</DropdownMenuItem>
                      {canEditLead(lead) && <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(lead); }}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>}
                      {isManager && teamMembers.length > 0 && (
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openAssignDialog(lead.id); }}><UserPlus className="h-4 w-4 mr-2" /> Assign</DropdownMenuItem>
                      )}
                      {canDeleteLead() && <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); handleDelete(lead.id); }}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem></>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <div className="flex items-center gap-x-4 gap-y-1 mt-2.5 ml-7 flex-wrap">
                {lead.phone && <span className="text-[13px] text-muted-foreground flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{lead.phone}</span>}
                {lead.email && <span className="text-[13px] text-muted-foreground flex items-center gap-1.5 truncate max-w-[200px]"><Mail className="h-3.5 w-3.5 shrink-0" />{lead.email}</span>}
              </div>
              <div className="flex items-center justify-between mt-3 ml-7">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[11px] capitalize rounded-md">{extendedSourceLabels[lead.source] || lead.source?.replace(/_/g, ' ')}</Badge>
                  <span className="text-[11px] text-muted-foreground">{new Date(lead.created_at).toLocaleDateString()}</span>
                </div>
                {isManager && (() => {
                  const names = getLeadAssignedNames(lead);
                  return names.length > 0 ? (
                    <span className="text-[11px] text-primary font-medium">{names.join(', ')}</span>
                  ) : (
                    <span className="text-[11px] text-amber-600 font-medium">Unassigned</span>
                  );
                })()}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card className="border-border/50 shadow-none">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {hasBulkDelete && <TableHead className="w-10"><Checkbox checked={allSelected ? true : someSelected ? 'indeterminate' : false} onCheckedChange={toggleSelectAll} /></TableHead>}
                <TableHead className="w-10">#</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                {isManager && <TableHead>Assigned To</TableHead>}
                <TableHead>Created</TableHead>
                {isManager && <TableHead className="w-24">Action</TableHead>}
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={isManager ? 10 : 8} className="text-center py-12">
                  <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No leads found</p>
                  <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters or add a new lead</p>
                </TableCell></TableRow>
              ) : paginatedLeads.map((lead: any, index: number) => (
                <TableRow key={lead.id} className={`cursor-pointer transition-colors ${selectedIds.has(lead.id) ? 'bg-primary/5' : 'hover:bg-muted/50'}`} onClick={() => openDetail(lead)}>
                  {hasBulkDelete && <TableCell onClick={(e) => e.stopPropagation()}><Checkbox checked={selectedIds.has(lead.id)} onCheckedChange={() => toggleSelect(lead.id)} /></TableCell>}
                  <TableCell className="text-muted-foreground text-xs font-mono">{(currentPage - 1) * pageSize + index + 1}</TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{lead.name}</p>
                      <p className="text-xs text-muted-foreground">{lead.college || lead.company || ''}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{lead.email || '—'}</div>
                    {lead.phone && <div className="text-xs text-muted-foreground">{lead.phone}</div>}
                  </TableCell>
                  <TableCell><Badge variant="secondary" className="text-xs capitalize">{extendedSourceLabels[lead.source] || lead.source?.replace(/_/g, ' ')}</Badge></TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {canEditLead(lead) ? (
                      <Select
                        value={lead.status === 'converted' ? 'enrolled' : lead.status}
                        onValueChange={(v: string) => onLeadStatusSelect(lead, v)}
                      >
                        <SelectTrigger className="h-7 w-auto border-0 p-0">
                          <Badge variant="outline" className={`${statusColors[statusBadgeKey(lead.status)]} capitalize text-xs`}>{formatLeadStatus(lead.status)}</Badge>
                        </SelectTrigger>
                        <SelectContent>
                          {LEAD_STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{formatLeadStatus(s)}</SelectItem>)}
                          {lead.status === 'considering' && <SelectItem value="considering" className="capitalize">Considering</SelectItem>}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline" className={`${statusColors[statusBadgeKey(lead.status)]} capitalize text-xs`}>{formatLeadStatus(lead.status)}</Badge>
                    )}
                  </TableCell>
                  {isManager && (
                    <TableCell>
                      {(() => {
                        const names = getLeadAssignedNames(lead);
                        return names.length > 0 ? (
                          <span className="text-sm font-medium">{names.join(', ')}</span>
                        ) : (
                          <span className="text-xs text-amber-600 font-medium">Unassigned</span>
                        );
                      })()}
                    </TableCell>
                  )}
                  <TableCell className="text-sm text-muted-foreground">{new Date(lead.created_at).toLocaleDateString()}</TableCell>
                  {isManager && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={() => openAssignDialog(lead.id)}>
                        <UserPlus className="h-3 w-3" />
                        {getLeadAssignedNames(lead).length > 0 ? 'Reassign' : 'Assign'}
                      </Button>
                    </TableCell>
                  )}
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openDetail(lead)}><Eye className="h-4 w-4 mr-2" /> View Details</DropdownMenuItem>
                        {canEditLead(lead) && <DropdownMenuItem onClick={() => openEdit(lead)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>}
                        {canDeleteLead() && <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onClick={() => handleDelete(lead.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem></>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Pagination Controls */}
      {filtered.length > pageSize && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 mt-4 px-1">
          <p className="text-xs text-muted-foreground">
            Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: Math.min(totalPages, isMobile ? 3 : 5) }, (_, i) => {
              let page: number;
              const maxPages = isMobile ? 3 : 5;
              if (totalPages <= maxPages) page = i + 1;
              else if (currentPage <= Math.ceil(maxPages / 2)) page = i + 1;
              else if (currentPage >= totalPages - Math.floor(maxPages / 2)) page = totalPages - maxPages + 1 + i;
              else page = currentPage - Math.floor(maxPages / 2) + i;
              return (
                <button key={page} onClick={() => setCurrentPage(page)} className={`h-8 w-8 rounded-md text-xs font-medium transition-colors ${currentPage === page ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}>
                  {page}
                </button>
              );
            })}
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      </>
      )}

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {detailLead && (
            <>
              <SheetHeader className="pb-4 border-b border-border">
                <SheetTitle className="text-lg">{detailLead.name}</SheetTitle>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className={`${statusColors[detailLead.status]} capitalize text-xs`}>{formatLeadStatus(detailLead.status)}</Badge>
                  <Badge variant="secondary" className="text-xs capitalize">{extendedSourceLabels[detailLead.source] || detailLead.source?.replace(/_/g, ' ')}</Badge>
                </div>
              </SheetHeader>

              <div className="mt-5 space-y-5">
                {/* Contact Info */}
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Contact Information</h4>
                  <div className="space-y-2.5">
                    {detailLead.email && (
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center"><Mail className="h-4 w-4 text-blue-600" /></div>
                        <div><p className="text-xs text-muted-foreground">Email</p><p className="text-sm font-medium">{detailLead.email}</p></div>
                      </div>
                    )}
                    {detailLead.phone && (
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center"><Phone className="h-4 w-4 text-green-600" /></div>
                        <div><p className="text-xs text-muted-foreground">Phone</p><p className="text-sm font-medium">{detailLead.phone}</p></div>
                      </div>
                    )}
                    {detailLead.college && (
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center"><GraduationCap className="h-4 w-4 text-purple-600" /></div>
                        <div><p className="text-xs text-muted-foreground">College</p><p className="text-sm font-medium">{detailLead.college}</p></div>
                      </div>
                    )}
                    {detailLead.company && (
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-indigo-500/10 flex items-center justify-center"><Building2 className="h-4 w-4 text-indigo-600" /></div>
                        <div><p className="text-xs text-muted-foreground">Company</p><p className="text-sm font-medium">{detailLead.company}</p></div>
                      </div>
                    )}
                    {detailLead.year_of_study && (
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center"><CalendarDays className="h-4 w-4 text-amber-600" /></div>
                        <div><p className="text-xs text-muted-foreground">Year of Study</p><p className="text-sm font-medium">{detailLead.year_of_study}</p></div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Assignment & Tracking */}
                <div className="border-t border-border pt-4">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Assignment & Tracking</h4>
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div>
                        <p className="text-xs text-muted-foreground">Assigned To</p>
                        <p className="text-sm font-medium">{getLeadAssignedNames(detailLead).join(', ') || 'Unassigned'}</p>
                      </div>
                      {isManager && teamMembers.length > 0 && (
                        <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={() => openAssignDialog(detailLead.id)}>
                          <UserPlus className="h-3 w-3" />{getLeadAssignedNames(detailLead).length > 0 ? 'Reassign' : 'Assign'}
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div><p className="text-xs text-muted-foreground">Created</p><p className="text-sm font-medium">{new Date(detailLead.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p></div>
                    </div>
                    {detailLead.next_follow_up && (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/5 border border-amber-200/50">
                        <div><p className="text-xs text-amber-600">Next Follow-up</p><p className="text-sm font-medium">{new Date(detailLead.next_follow_up).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p></div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Notes */}
                {detailLead.notes && !String(detailLead.notes).includes('Answers:') && (
                  <div className="border-t border-border pt-4">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5"><StickyNote className="h-3.5 w-3.5" />Notes</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed bg-muted/50 p-3 rounded-lg">{detailLead.notes}</p>
                  </div>
                )}
                <FormSubmissionDetails notes={detailLead.notes} resumePath={detailLead.resume_path} />

                {/* Activity History */}
                <LeadActivityTimeline
                  leadId={detailLead.id}
                  getProfileName={(uid) => getAssignedName(uid) || profiles.find(p => p.user_id === uid)?.full_name || 'Unknown'}
                />

                {/* Action Buttons */}
                <div className="border-t border-border pt-4 flex gap-2">
                  {canEditLead(detailLead) && (
                    <Button variant="outline" size="sm" className="gap-1.5 flex-1" onClick={() => { setDetailOpen(false); openEdit(detailLead); }}>
                      <Pencil className="h-3.5 w-3.5" /> Edit Lead
                    </Button>
                  )}
                  {canDeleteLead() && (
                    <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => { handleDelete(detailLead.id); setDetailOpen(false); }}>
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Edit Lead Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={(open) => { setEditDialogOpen(open); if (!open) setEditingLead(null); }}>
        <DialogContent className="max-w-lg max-h-[min(90dvh,calc(100dvh-2rem))] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Lead</DialogTitle></DialogHeader>
          {editingLead && (
            <LeadForm
              initialData={editingLead}
              onSubmit={handleEdit}
              isEdit
              teamMembers={isManager ? teamMembers : []}
              currentUserId={user?.id}
              showAssignToSelf={normalizedLeadRole === 'manager'}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Assign Lead Dialog - Multi-select with Checkboxes */}
      <Dialog open={assignOpen} onOpenChange={(open) => { if (!assignSaving) { setAssignOpen(open); if (!open) { setAssignLeadId(null); setAssignSelectedReps(new Set()); } } }}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Assign Lead to Team Members</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2 max-h-64 overflow-y-auto">
            {Object.entries(groupedTeamMembers).map(([group, members]) => (
              <div key={group} className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">{group}</p>
                {members.map((m: any) => (
                  <label
                    key={m.id}
                    className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${
                      assignSelectedReps.has(m.id)
                        ? 'bg-primary/5 border-primary/30'
                        : 'bg-muted/30 border-border hover:bg-muted/50'
                    } ${assignSaving ? 'opacity-60 pointer-events-none' : ''}`}
                  >
                    <Checkbox
                      checked={assignSelectedReps.has(m.id)}
                      onCheckedChange={() => {
                        setAssignSelectedReps(prev => {
                          const next = new Set(prev);
                          if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                          return next;
                        });
                      }}
                      disabled={assignSaving}
                    />
                    <span className="text-sm font-medium">{m.full_name}</span>
                  </label>
                ))}
              </div>
            ))}
            {teamMembers.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No team members available</p>}
          </div>
          {assignSelectedReps.size > 0 && (
            <p className="text-xs text-muted-foreground">{assignSelectedReps.size} rep{assignSelectedReps.size > 1 ? 's' : ''} selected</p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setAssignOpen(false); setAssignLeadId(null); setAssignSelectedReps(new Set()); }} disabled={assignSaving}>Cancel</Button>
            <Button onClick={handleMultiAssign} disabled={assignSelectedReps.size === 0 || assignSaving} className="gap-1.5">
              {assignSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {assignSaving ? 'Saving...' : `Assign to ${assignSelectedReps.size} Rep${assignSelectedReps.size !== 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Assign Dialog */}
      <BulkAssignDialog
        open={bulkAssignOpen}
        onOpenChange={setBulkAssignOpen}
        teamMembers={teamMembers}
        unassignedCount={totalLeads}
        onAssign={handleBulkAutoAssign}
        isAssigning={bulkAssigning}
      />

      <LeadEnrollDialog
        open={!!enrollLead}
        onOpenChange={(open) => {
          if (!open) setEnrollLead(null);
        }}
        lead={enrollLead}
        orgId={(enrollLead?.org_id ?? enrollLead?.organization_id ?? organization?.id) as string | undefined}
        onEnrolled={() => {
          setEnrollLead(null);
          void fetchLeads();
        }}
      />

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import leads (CSV)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Organization *</Label>
              <Select value={importOrgId || undefined} onValueChange={setImportOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select organization" />
                </SelectTrigger>
                <SelectContent>
                  {importOrgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Imported leads will be created under this organization only.
              </p>
            </div>
            {importTargetOrgName ? (
              <p className="text-sm rounded-lg bg-muted/50 px-3 py-2">
                Importing into: <span className="font-medium">{importTargetOrgName}</span>
              </p>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importBusy}>Cancel</Button>
            <Button
              disabled={!importOrgId || importBusy}
              className="gap-1.5"
              onClick={() => {
                if (!importOrgId) {
                  toast({ variant: 'destructive', title: 'Select an organization' });
                  return;
                }
                fileInputRef.current?.click();
              }}
            >
              {importBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {importBusy ? 'Importing…' : 'Choose CSV'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LeadForm({
  onSubmit,
  initialData,
  isEdit,
  teamMembers = [],
  currentUserId,
  showAssignToSelf = false,
}: {
  onSubmit: (data: any) => void;
  initialData?: any;
  isEdit?: boolean;
  teamMembers?: any[];
  currentUserId?: string;
  showAssignToSelf?: boolean;
}) {
  const [form, setForm] = useState(
    initialData || {
      name: '',
      email: '',
      phone: '',
      college: '',
      year_of_study: '',
      course_interest: '',
      source: 'other',
      notes: '',
      assigned_to: showAssignToSelf && currentUserId ? currentUserId : '',
    },
  );
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      <div className="space-y-2"><Label>Name *</Label><Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Enter lead name" /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" /></div>
        <div className="space-y-2"><Label>Phone</Label><Input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+91 XXXXX XXXXX" /></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2"><Label>College</Label><Input value={form.college || ''} onChange={e => setForm({ ...form, college: e.target.value })} placeholder="College name" /></div>
        <div className="space-y-2"><Label>Year of Study</Label><Input value={form.year_of_study || ''} onChange={e => setForm({ ...form, year_of_study: e.target.value })} placeholder="e.g. 3rd Year" /></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2"><Label>Course Interest</Label><Input value={form.course_interest || ''} onChange={e => setForm({ ...form, course_interest: e.target.value })} placeholder="Course name" /></div>
        <div className="space-y-2">
          <Label>Source</Label>
          <Select value={form.source} onValueChange={v => setForm({ ...form, source: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{LEAD_SOURCES.map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      {(teamMembers.length > 0 || showAssignToSelf) && (
        <div className="space-y-2">
          <Label>Assign to Team Member</Label>
            <Select
              value={form.assigned_to || (showAssignToSelf && currentUserId ? currentUserId : '')}
              onValueChange={v => setForm({ ...form, assigned_to: v })}
            >
            <SelectTrigger><SelectValue placeholder="Select assignee..." /></SelectTrigger>
              <SelectContent>
                {showAssignToSelf && currentUserId ? (
                  <SelectItem value={currentUserId}>Myself (Manager)</SelectItem>
                ) : null}
                {teamMembers
                  .filter((m) => m.id !== currentUserId)
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.full_name} ({getRoleCategoryLabel(m.role)})
                    </SelectItem>
                  ))}
              </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Add any relevant notes..." rows={3} /></div>
      <Button type="submit" className="w-full">{isEdit ? 'Update Lead' : 'Create Lead'}</Button>
    </form>
  );
}
