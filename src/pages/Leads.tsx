import { useState, useRef, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { sendNotificationWithEmail } from '@/lib/notifications';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import {
  Plus, Search, Filter, Download, Upload, MoreHorizontal, Pencil, Trash2, Loader2, Phone, Mail,
  UserPlus, Users, Target, Clock, Eye, History, CalendarDays, Building2, GraduationCap,
  StickyNote, XCircle, ChevronLeft, ChevronRight, Megaphone, Globe2,
  MessageCircle, MapPin, School, CircleHelp, Youtube, FileText, Upload as UploadIcon, ClipboardCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { LeadActivityTimeline } from '@/components/LeadActivityTimeline';
import { LeadEnrollDialog } from '@/components/leads/LeadEnrollDialog';
import { FormSubmissionDetails } from '@/components/leads/FormSubmissionDetails';
import { SourceLeadsDialog } from '@/components/leads/SourceLeadsDialog';
import * as perms from '@/lib/permissions';
import { isMarketingFamilyRole, isSalesRepRole } from '@/lib/roleUtils';
import { filterAndSortAssignRoster } from '@/lib/assignRoster';
import {
  downloadLeadImportTemplate,
  downloadLeadImportTemplateExcel,
  mapCsvRowsToLeads,
  parseLeadImportFile,
} from '@/lib/leadImportCsv';
import {
  IMPORT_SET_PREFIX,
  ADDED_LEAD_TAG,
  buildSourceSummaries,
  filterLeadsBySourceBucket,
  getFormSourceKey,
  getLeadSourceBucket,
  isFormLead as isFormLeadRow,
  isFormSourceBucket,
  isPeaklyySourceBucket,
  resolveFormAssigneesForSourceKey,
  type LeadSourceBucket,
} from '@/lib/leadSources';
import { downloadLeadsDetailCsv } from '@/lib/leadsExportCsv';
import { useIsMobile } from '@/hooks/use-mobile';

const LEAD_STATUSES = ['new', 'contacted', 'not_answered', 'messaged', 'qualified', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'] as const;

const formatLeadStatus = (s?: string | null) => {
  if (!s) return 'New';
  if (s === 'enrolled' || s === 'converted') return 'Enroll';
  if (s === 'considering') return 'Interested';
  if (s === 'not_interested') return 'Lost';
  if (s === 'not_answered') return 'Not answered';
  if (s === 'messaged') return 'Messaged';
  return s.replace(/_/g, ' ');
};

/** Canonical Select value — empty/truncated ENUM values show as New. */
const leadStatusSelectValue = (s?: string | null) => {
  const raw = String(s || '').trim();
  if (!raw) return 'new';
  if (raw === 'converted') return 'enrolled';
  if (raw === 'considering') return 'interested';
  if (raw === 'not_interested') return 'lost';
  return raw;
};

const statusBadgeKey = (s?: string | null) => {
  if (!s) return 'new';
  if (s === 'converted') return 'enrolled';
  if (s === 'considering') return 'interested';
  if (s === 'not_interested') return 'lost';
  return s;
};
const LEAD_SOURCES = ['google_ads', 'instagram', 'facebook', 'youtube', 'website', 'normal_form', 'google_forms', 'whatsapp', 'referral', 'walkin', 'college_seminar', 'other'] as const;

const statusColors: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-700 border-blue-200',
  contacted: 'bg-amber-500/10 text-amber-700 border-amber-200',
  not_answered: 'bg-slate-500/10 text-slate-700 border-slate-200',
  messaged: 'bg-sky-500/10 text-sky-700 border-sky-200',
  qualified: 'bg-cyan-500/10 text-cyan-700 border-cyan-200',
  interested: 'bg-emerald-500/10 text-emerald-700 border-emerald-200',
  demo_scheduled: 'bg-indigo-500/10 text-indigo-700 border-indigo-200',
  demo_attended: 'bg-violet-500/10 text-violet-700 border-violet-200',
  enrolled: 'bg-teal-500/10 text-teal-800 border-teal-200',
  lost: 'bg-red-500/10 text-red-700 border-red-200',
};

const SOURCE_LABELS: Record<string, string> = {
  google_ads: 'Google Ads', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube',
  website: 'Website', normal_form: 'Normal Form', google_forms: 'Google Forms', whatsapp: 'WhatsApp', referral: 'Referral',
  walkin: 'Walk-in', college_seminar: 'College Seminar', other: 'Other',
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
  reports_to_id: m.reports_to_id != null ? String(m.reports_to_id) : null,
  reports_to_name: m.reports_to_name != null ? String(m.reports_to_name) : null,
});
const getRoleCategoryLabel = (role?: string | null) => {
  const normalized = String(role || '').trim().toLowerCase();
  if (isMarketingFamilyRole(normalized)) return 'Marketing';
  if (normalized === 'sales_representative') return 'Sales Representative';
  if (normalized === 'manager') return 'Manager';
  if (normalized === 'hr') return 'HR';
  if (normalized === 'trainer') return 'Trainer';
  if (normalized === 'finance') return 'Finance';
  return normalized ? normalized.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Other';
};

const SOURCE_BUCKET_ICONS: Record<LeadSourceBucket, LucideIcon> = {
  added_leads: UserPlus,
  google_ads: Megaphone,
  meta_ads: Megaphone,
  youtube: Youtube,
  website: Globe2,
  form_leads: FileText,
  peaklyy: ClipboardCheck,
  import: UploadIcon,
  whatsapp: MessageCircle,
  referral: Users,
  walkin: MapPin,
  college_seminar: School,
  other: CircleHelp,
};

const SOURCE_STATUS_CHIP_ORDER = ['new', 'contacted', 'not_answered', 'messaged', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'] as const;

export default function Leads() {
  const { toast } = useToast();
  const { user, role, profile, organization } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const isFormLeadsPage = location.pathname === '/leads/form-leads';
  const useSourceCards = [
    '/leads',
    '/leads-management',
    '/my-leads',
    '/leads/form-leads',
  ].includes(location.pathname);
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
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [leadAssignments, setLeadAssignments] = useState<Record<string, string[]>>({});
  const [assignSelectedReps, setAssignSelectedReps] = useState<Set<string>>(new Set());
  const [assignSaving, setAssignSaving] = useState(false);
  const [enrollLead, setEnrollLead] = useState<any | null>(null);
  const [leadForms, setLeadForms] = useState<{ id: string; slug: string; name: string }[]>([]);
  const [formAssignmentsByFormId, setFormAssignmentsByFormId] = useState<
    Record<string, Array<{ member_id: string; full_name?: string | null }>>
  >({});
  const [importOpen, setImportOpen] = useState(false);
  const [importOrgId, setImportOrgId] = useState('');
  const [importOrgs, setImportOrgs] = useState<{ id: string; name: string }[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [sourceDialogKey, setSourceDialogKey] = useState<string | null>(null);
  const [sourceDialogLabel, setSourceDialogLabel] = useState<string>('');
  const [sourceDialogStatus, setSourceDialogStatus] = useState<string>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasCreate = perms.canCreate(role);
  const hasEditAll = perms.canEditAll(role);
  const hasDelete = perms.canDelete(role);
  const hasBulkDelete = perms.canBulkDelete(role);
  const hasImport = perms.canImport(role);
  const isManager =
    role === 'admin' || role === 'org' || role === 'super_admin' || role === 'manager';
  const normalizedLeadRole = String(role || '')
    .trim()
    .toLowerCase()
    .replace(/^superadmin$/, 'super_admin')
    .replace(/^organisation$/, 'org');
  /** Leads export: super_admin / admin only (not manager / org / L1). */
  const canExportLeads = normalizedLeadRole === 'super_admin' || normalizedLeadRole === 'admin';
  const [exportCardsOpen, setExportCardsOpen] = useState(false);
  const [exportCardKeys, setExportCardKeys] = useState<Set<string>>(new Set());
  /** Sales rep / exec: hub lists all org-visible rows from API; My Leads shows only referral-link form submissions. */
  const isSalesRepMyLeadsPage =
    location.pathname === '/my-leads' && isSalesRepRole(normalizedLeadRole);
  const rosterMarketingLike = isMarketingFamilyRole(normalizedLeadRole);
  /** Includes managers plus roles that assign leads using same-org reps */
  const needsAssignmentRoster =
    isManager ||
    rosterMarketingLike ||
    normalizedLeadRole === 'hr';
  const scopeLabel = normalizedLeadRole === 'super_admin'
    ? 'Scope: all leads'
    : normalizedLeadRole === 'admin' || normalizedLeadRole === 'org' || normalizedLeadRole === 'manager'
      ? 'Scope: organization leads'
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
    api.forms.list()
      .then(async (res) => {
        const rows = Array.isArray(res) ? res : res?.data || [];
        const forms = rows
          .filter((f: { id?: string; slug?: string; name?: string }) => f?.id && f?.slug && f?.name)
          .map((f: { id: string; slug: string; name: string }) => ({
            id: String(f.id),
            slug: String(f.slug),
            name: String(f.name),
          }));
        setLeadForms(forms);
        if (!needsAssignmentRoster || forms.length === 0) {
          setFormAssignmentsByFormId({});
          return;
        }
        const pairs = await Promise.all(
          forms.map(async (form) => {
            try {
              const a = await api.forms.assignments(form.id);
              return [form.id, (a?.data || []) as Array<{ member_id: string; full_name?: string | null }>] as const;
            } catch {
              return [form.id, []] as const;
            }
          }),
        );
        const next: Record<string, Array<{ member_id: string; full_name?: string | null }>> = {};
        for (const [id, list] of pairs) next[id] = list;
        setFormAssignmentsByFormId(next);
      })
      .catch(() => {});
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

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const data = await api.leads.list();
      const allLeads = data.data || [];

      if (isFormLeadsPage) {
        // Form Leads page: only form-generated leads (per-form cards).
        setLeads(allLeads.filter((l: any) => isFormLeadRow(l)));
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
      [...marketingRows, ...teamRows].forEach((m: any) => {
        if (m?.id) mergedById.set(m.id, m);
      });

      setTeamMembers(
        filterAndSortAssignRoster(Array.from(mergedById.values()), {
          excludeUserId: user?.id,
        }),
      );
    } catch {}
  };

  const canEditLead = (lead: any) => {
    if (hasEditAll) return true;
    const uid = user?.id ? String(user.id) : '';
    if (!uid) return false;
    // Match backend userCanUpdateLeadForCallLog: assignee, creator, or referral owner
    if (String(lead.assigned_to || '') === uid) return true;
    if (String(lead.created_by || '') === uid) return true;
    const ref = String(profile?.referral_code ?? '').trim();
    if (ref && String(lead.referred_by || '').trim() === ref) return true;
    const assignees = leadAssignments[lead.id];
    if (Array.isArray(assignees) && assignees.some((id: string) => String(id) === uid)) return true;
    return false;
  };
  const canDeleteLead = () => hasDelete;

  const downloadLeadsCsv = (rows: any[], filenameHint: string) => {
    if (!rows.length) {
      toast({ variant: 'destructive', title: 'Nothing to export', description: 'No leads match the selection.' });
      return;
    }
    const result = downloadLeadsDetailCsv(rows, filenameHint, {
      getAssignedTo: (lead) => {
        const names = getLeadAssignedNames(lead);
        if (names.length) return names.join(', ');
        return getAssignedName(lead?.assigned_to) || '';
      },
      getCollectedBy: (lead) => {
        const code = String(lead?.referred_by || '').trim();
        if (!code) return '';
        const fromProfile = profiles.find((p) => p.referral_code === code)?.full_name;
        return fromProfile || code;
      },
      getCreatedBy: (lead) => {
        const fromApi = String(lead?.created_by_name || '').trim();
        if (fromApi) return fromApi;
        const id = String(lead?.created_by || '').trim();
        if (!id) return '';
        return getAssignedName(id) || profiles.find((p) => p.user_id === id)?.full_name || '';
      },
    });
    if (result.ok) {
      toast({ title: 'Leads exported', description: `${result.count} lead(s) with full details downloaded.` });
    }
  };

  const openExportCardsDialog = () => {
    setExportCardKeys(new Set(sourceSummaries.map((s) => s.key)));
    setExportCardsOpen(true);
  };

  const handleExportSelectedCards = () => {
    if (exportCardKeys.size === 0) {
      toast({ variant: 'destructive', title: 'Select at least one card' });
      return;
    }
    const rows = leads.filter((l) => exportCardKeys.has(getLeadSourceBucket(l)));
    downloadLeadsCsv(rows, `leads-${exportCardKeys.size}-cards`);
    setExportCardsOpen(false);
  };

  const isSuperAdmin = normalizedLeadRole === 'super_admin';
  const importTargetOrgName = useMemo(() => {
    if (isSuperAdmin) {
      return importOrgs.find((o) => o.id === importOrgId)?.name || '';
    }
    return organization?.name || '';
  }, [isSuperAdmin, importOrgs, importOrgId, organization?.name]);

  useEffect(() => {
    if (!hasImport) return;
    if (isSuperAdmin) {
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
      return;
    }
    const orgId = String(organization?.id || '').trim();
    if (orgId) {
      setImportOrgId(orgId);
    }
  }, [isSuperAdmin, hasImport, organization?.id]);

  const runLeadImport = async (file: File, orgIdForImport?: string) => {
    setImportBusy(true);
    try {
      const isExcel = /\.(xlsx|xls)$/i.test(file.name);
      const rows = await parseLeadImportFile(file);
      const importSetTag = `${IMPORT_SET_PREFIX}${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
      const { leads: mapped, skipped, errors } = mapCsvRowsToLeads(rows, {
        importSetTag,
        fileType: isExcel ? 'excel' : 'csv',
        fileName: file.name,
      });
      if (mapped.length === 0) {
        toast({
          variant: 'destructive',
          title: 'No leads imported',
          description: errors[0] || 'The file needs a header and at least one row with name, phone, or email.',
        });
        return;
      }
      const payload = mapped.map((row) => ({ ...row }));
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
        description: err?.message || 'Could not import the selected file',
      });
    } finally {
      setImportBusy(false);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({
        variant: 'destructive',
        title: 'File is too large',
        description: 'Choose a CSV or Excel file smaller than 10 MB.',
      });
      return;
    }
    const orgId = isSuperAdmin ? importOrgId : String(organization?.id || importOrgId || '').trim();
    void runLeadImport(file, orgId || undefined);
  };

  const openImport = () => {
    setImportOpen(true);
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
  const formAssigneeNameById = useMemo(() => {
    const map: Record<string, string> = {};
    Object.values(formAssignmentsByFormId).forEach((rows) => {
      rows.forEach((row) => {
        const id = String(row?.member_id || '').trim();
        const name = String(row?.full_name || '').trim();
        if (id && name) map[id] = name;
      });
    });
    return map;
  }, [formAssignmentsByFormId]);

  const getFormAssigneesForKey = (sourceKey: string | null | undefined) =>
    resolveFormAssigneesForSourceKey(sourceKey, leadForms, formAssignmentsByFormId);

  const getAssignRosterForLead = (lead: any | null | undefined) => {
    if (!lead) return teamMembers;
    const formOnes = getFormAssigneesForKey(getFormSourceKey(lead));
    return formOnes.length > 0 ? formOnes : teamMembers;
  };

  /** Prefer form-assigned people when assigning from a form card / form lead. */
  const assignRosterMembers = useMemo(() => {
    if (assignLeadId) {
      const lead = leads.find((l) => l.id === assignLeadId);
      return getAssignRosterForLead(lead);
    }
    if (sourceDialogKey) {
      const formOnes = getFormAssigneesForKey(sourceDialogKey);
      if (formOnes.length > 0) return formOnes;
    }
    return teamMembers;
  }, [assignLeadId, leads, sourceDialogKey, leadForms, formAssignmentsByFormId, teamMembers]);

  const groupedAssignRoster = useMemo(() => {
    const groups: Record<string, any[]> = {};
    assignRosterMembers.forEach((member: any) => {
      const label =
        member.role === 'form_assignee' ? 'Form assignees' : getRoleCategoryLabel(member.role);
      if (!groups[label]) groups[label] = [];
      groups[label].push(member);
    });
    return groups;
  }, [assignRosterMembers]);

  const sourceDialogAssignMembers = useMemo(() => {
    const formOnes = getFormAssigneesForKey(sourceDialogKey);
    return formOnes.length > 0 ? formOnes : teamMembers;
  }, [sourceDialogKey, leadForms, formAssignmentsByFormId, teamMembers]);

  useEffect(() => { setCurrentPage(1); }, [search, statusFilter, sourceFilter, unassignedOnly]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedLeads = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  const totalLeads = leads.length;
  const newLeads = leads.filter(l => l.status === 'new').length;
  const inPipeline = leads.filter(l => ['qualified', 'interested', 'demo_scheduled', 'demo_attended', 'considering'].includes(l.status)).length;
  const enrollLeads = leads.filter(l => l.status === 'enrolled' || l.status === 'converted').length;
  const lostLeads = leads.filter(l => l.status === 'lost' || l.status === 'not_interested').length;
  const unassignedCount = leads.filter(l => !l.assigned_to).length;
  const convRate = totalLeads > 0 ? Math.round((enrollLeads / totalLeads) * 100) : 0;

  const normalizeLeadStatusForApi = (status: string) => {
    if (status === 'converted') return 'enrolled';
    if (status === 'considering') return 'interested';
    if (status === 'not_interested') return 'lost';
    return status;
  };

  const updateStatus = async (id: string, status: string) => {
    const normalized = normalizeLeadStatusForApi(status);
    try {
      await api.leads.update(id, { status: normalized });
      setLeads(prev => prev.map(l => l.id === id ? { ...l, status: normalized } : l));
      setDetailLead(prev => (prev?.id === id ? { ...prev, status: normalized } : prev));
      if (normalized === 'enrolled') {
        toast({ title: 'Enroll', description: 'Lead status set to Enroll and a student record was created (if not already).' });
      } else {
        toast({ title: `Status updated to ${formatLeadStatus(normalized)}` });
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
      // L1 (sales / marketing / HR): own the lead so status/edit controls appear
      if (isSalesRepRole(normalizedLeadRole) || rosterMarketingLike || normalizedLeadRole === 'hr') {
        const at = String(payload.assigned_to ?? '').trim();
        if (at === '' || at === 'unassigned') {
          payload.assigned_to = user?.id;
        }
        const ref = String(profile?.referral_code ?? '').trim();
        if (ref && !String(payload.referred_by ?? '').trim()) {
          payload.referred_by = ref;
        }
      }
      // Form Leads page only lists form/referral rows — stamp referral so manual adds appear
      if (isFormLeadsPage) {
        const ref = String(profile?.referral_code ?? '').trim();
        if (ref && !String(payload.referred_by ?? '').trim()) {
          payload.referred_by = ref;
        }
      }
      const tags = Array.isArray(payload.tags) ? [...payload.tags] : [];
      if (!tags.some((t: unknown) => String(t).trim().toLowerCase() === ADDED_LEAD_TAG)) {
        tags.push(ADDED_LEAD_TAG);
      }
      payload.tags = tags;
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
    if (assignSelectedReps.size === 0) return;
    const repIds = Array.from(assignSelectedReps);
    const primary = repIds[0];
    setAssignSaving(true);
    try {
      if (assignLeadId) {
        await api.leadAssignments.setAssignees(assignLeadId, repIds);
        setLeads(prev => prev.map(l => l.id === assignLeadId ? { ...l, assigned_to: primary } : l));
        setLeadAssignments(prev => ({ ...prev, [assignLeadId]: repIds }));
        if (detailLead?.id === assignLeadId) {
          setDetailLead({ ...detailLead, assigned_to: primary });
        }
        const lead = leads.find(l => l.id === assignLeadId);
        const repNames = repIds.map(id => getAssignedName(id)).filter(Boolean).join(', ');
        toast({ title: `Lead assigned to ${repNames}` });
        for (const repId of repIds) {
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
      } else {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) {
          toast({ variant: 'destructive', title: 'No leads selected' });
          return;
        }
        const res = await api.leadAssignments.bulkAssign(ids, repIds);
        const assigned = typeof res?.assigned === 'number' ? res.assigned : ids.length;
        const failed = typeof res?.failed === 'number' ? res.failed : 0;
        const assigneePatch = Object.fromEntries(ids.map((id) => [id, true]));
        setLeads((prev) =>
          prev.map((l) => (assigneePatch[l.id] ? { ...l, assigned_to: primary } : l)),
        );
        setLeadAssignments((prev) => {
          const next = { ...prev };
          for (const id of ids) next[id] = repIds;
          return next;
        });
        await fetchLeads();
        await fetchAssignments();
        const repNames = repIds.map(id => getAssignedName(id)).filter(Boolean).join(', ');
        toast({
          title: `${assigned} leads assigned to ${repNames}`,
          description: failed > 0 ? `${failed} failed` : undefined,
          variant: failed > 0 && assigned === 0 ? 'destructive' : undefined,
        });
        for (const repId of repIds) {
          await sendNotificationWithEmail({
            userId: repId,
            title: `${assigned} Leads Assigned`,
            message: `You have been assigned ${assigned} lead(s) (with ${repIds.length} teammate(s) on each).`,
            type: 'lead_assigned',
            link: '/leads',
            leadName: `${assigned} leads`,
            assignedByName: profile?.full_name || 'Manager',
          });
        }
        setSelectedIds(new Set());
      }
      setAssignOpen(false);
      setAssignLeadId(null);
      setAssignSelectedReps(new Set());
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setAssignSaving(false);
    }
  };

  const handleBulkAssign = async (repId: string, leadIds?: string[]) => {
    const ids = leadIds ?? Array.from(selectedIds);
    if (ids.length === 0) return;
    const assignedLeadNames: string[] = [];
    try {
      const res = await api.leadAssignments.bulkAssign(ids, repId);
      const assigned = typeof res?.assigned === 'number' ? res.assigned : ids.length;
      const failed = typeof res?.failed === 'number' ? res.failed : 0;
      for (const id of ids) {
        const lead = leads.find(l => l.id === id);
        if (lead) assignedLeadNames.push(lead.name);
      }
      setLeads((prev) =>
        prev.map((l) => (ids.includes(l.id) ? { ...l, assigned_to: repId } : l)),
      );
      await fetchLeads();
      await fetchAssignments();
      const repName = teamMembers.find(m => m.id === repId)?.full_name || 'Rep';
      toast({
        title: `${assigned} leads assigned to ${repName}`,
        description: failed > 0 ? `${failed} failed` : undefined,
        variant: failed > 0 && assigned === 0 ? 'destructive' : undefined,
      });
      if (assigned > 0) {
        await sendNotificationWithEmail({
          userId: repId,
          title: `${assigned} Leads Assigned`,
          message: `You have been assigned ${assigned} new leads: ${assignedLeadNames.slice(0, 3).join(', ')}${assignedLeadNames.length > 3 ? '...' : ''}.`,
          type: 'lead_assigned',
          link: '/leads',
          leadName: assignedLeadNames.slice(0, 3).join(', '),
          assignedByName: profile?.full_name || 'Manager',
        });
      }
      setSelectedIds(new Set());
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Bulk assign failed',
        description: err?.message || 'Could not assign leads',
      });
    }
  };

  const handleBulkAutoAssign = async (count: number, repIds: string[], poolLeadIds?: string[]) => {
    setBulkAssigning(true);
    try {
      // Trust IDs from the source dialog (may include already-assigned leads for reassign).
      const pool = poolLeadIds?.length
        ? leads.filter((l) => poolLeadIds.includes(l.id))
        : leads.filter((l) => !l.assigned_to);
      const toAssign = pool.slice(0, count);
      if (toAssign.length === 0) {
        toast({
          variant: 'destructive',
          title: 'No leads to assign',
          description: 'Select leads in the source card, or choose a source with leads available.',
        });
        return;
      }
      if (!repIds.length) {
        toast({ variant: 'destructive', title: 'Select at least one team member' });
        return;
      }
      const repAssignments: Record<string, string[]> = {};
      repIds.forEach((id) => { repAssignments[id] = []; });
      toAssign.forEach((lead, i) => {
        const repId = repIds[i % repIds.length];
        repAssignments[repId].push(lead.id);
      });
      let totalAssigned = 0;
      let failed = 0;
      const errorHints: string[] = [];
      for (const [repId, leadIds] of Object.entries(repAssignments)) {
        if (leadIds.length === 0) continue;
        const names: string[] = [];
        try {
          const res = await api.leadAssignments.bulkAssign(leadIds, repId);
          const ok = typeof res?.assigned === 'number' ? res.assigned : leadIds.length;
          const fail = typeof res?.failed === 'number' ? res.failed : 0;
          totalAssigned += ok;
          failed += fail;
          if (Array.isArray(res?.errors) && res.errors.length) {
            errorHints.push(...res.errors.slice(0, 3));
          }
          for (const lid of leadIds) {
            const l = leads.find((x) => x.id === lid);
            if (l) names.push(l.name);
          }
        } catch (err: any) {
          failed += leadIds.length;
          if (err?.message) errorHints.push(String(err.message));
        }
        if (names.length > 0) {
          await sendNotificationWithEmail({
            userId: repId,
            title: `${names.length} Leads Assigned`,
            message: `You have been assigned ${names.length} new leads: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '...' : ''}.`,
            type: 'lead_assigned',
            link: '/leads',
            leadName: names.slice(0, 3).join(', '),
            assignedByName: profile?.full_name || 'Manager',
          });
        }
      }
      await fetchLeads();
      await fetchAssignments();
      if (failed > 0 && totalAssigned === 0) {
        toast({
          variant: 'destructive',
          title: 'Bulk assign failed',
          description: errorHints[0] || 'Could not distribute leads',
        });
      } else {
        toast({
          title: `${totalAssigned} leads distributed across ${repIds.length} member${repIds.length === 1 ? '' : 's'}`,
          description: failed ? `${failed} failed${errorHints[0] ? `: ${errorHints[0]}` : ''}` : undefined,
        });
      }
    } finally {
      setBulkAssigning(false);
    }
  };

  const handleBulkUndoAssign = async (snapshots: { leadId: string; userIds: string[] }[]) => {
    if (snapshots.length === 0) return;
    setBulkAssigning(true);
    try {
      let ok = 0;
      let failed = 0;
      for (const snap of snapshots) {
        try {
          await api.leadAssignments.setAssignees(snap.leadId, snap.userIds);
          ok++;
        } catch {
          failed++;
        }
      }
      await fetchLeads();
      await fetchAssignments();
      toast({
        title: ok > 0 ? `Undid assignment on ${ok} lead${ok === 1 ? '' : 's'}` : 'Undo failed',
        description: failed > 0 ? `${failed} could not be restored` : undefined,
        variant: ok === 0 ? 'destructive' : undefined,
      });
    } finally {
      setBulkAssigning(false);
    }
  };

  const openEdit = (lead: any) => {
    if (!canEditLead(lead)) { toast({ variant: 'destructive', title: 'Permission denied' }); return; }
    setEditingLead(lead); setEditDialogOpen(true);
  };

  const openDetail = (lead: any) => {
    setDetailLead(lead);
    if (sourceDialogKey) {
      setDetailOpen(false);
      return;
    }
    setDetailOpen(true);
  };

  const closeSourceCard = () => {
    setSourceDialogKey(null);
    setDetailLead(null);
    setDetailOpen(false);
  };

  const closeInlineDetail = () => {
    setDetailLead(null);
    setDetailOpen(false);
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
    if (user?.id && String(id) === String(user.id)) return 'Assigned to self';
    const member = teamMembers.find(m => m.id === id);
    if (member) return member.full_name;
    if (formAssigneeNameById[id]) return formAssigneeNameById[id];
    const prof = profiles.find(p => p.user_id === id);
    return prof?.full_name || '';
  };

  const getLeadAssignedNames = (lead: any) => {
    const assignedUserIds = leadAssignments[lead.id] || (lead.assigned_to ? [lead.assigned_to] : []);
    return assignedUserIds.map((id: string) => getAssignedName(id)).filter(Boolean);
  };

  /** True when CRM has an assignee, even if this manager cannot resolve the name. */
  const isLeadAssigned = (lead: any) => {
    if (lead?.assigned_to) return true;
    const ids = leadAssignments[lead?.id];
    return Array.isArray(ids) && ids.length > 0;
  };

  /** Assigned column: show names when known; otherwise "Assigned" (not "Unassigned"). */
  const formatAssignedColumn = (lead: any) => {
    const names = getLeadAssignedNames(lead);
    if (names.length > 0) return { label: names.join(', '), isAssigned: true };
    if (isLeadAssigned(lead)) return { label: 'Assigned', isAssigned: true };
    return { label: 'Unassigned', isAssigned: false };
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

  const openBulkMultiAssignDialog = () => {
    setAssignLeadId(null);
    setAssignSelectedReps(new Set());
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

  const formLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    leadForms.forEach((f) => {
      labels[f.slug] = f.name;
      labels[`form_${f.slug}`] = f.name;
    });
    return labels;
  }, [leadForms]);

  const sourceSummaries = useMemo(
    () => buildSourceSummaries(leads, { formLabels }),
    [leads, formLabels],
  );

  const sourceDialogLeads = useMemo(() => {
    if (!sourceDialogKey) return [];
    return filterLeadsBySourceBucket(leads, sourceDialogKey);
  }, [leads, sourceDialogKey]);

  const openSourceDialog = (key: string, label: string, status: string = 'all') => {
    setSourceDialogKey(key);
    setSourceDialogLabel(label);
    setSourceDialogStatus(status);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  const sourceCardDetailPanel =
    sourceDialogKey && detailLead ? (
      <div className="space-y-5">
        <div className="pb-4 border-b border-border">
          <h3 className="text-lg font-semibold leading-tight">{detailLead.name}</h3>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Select
              value={leadStatusSelectValue(detailLead.status)}
              onValueChange={(v: string) => {
                if (!v) return;
                onLeadStatusSelect(detailLead, v);
              }}
            >
              <SelectTrigger className="h-7 w-auto border-0 p-0">
                <Badge
                  variant="outline"
                  className={`${statusColors[statusBadgeKey(detailLead.status)] || statusColors[detailLead.status] || ''} capitalize text-xs`}
                >
                  {formatLeadStatus(detailLead.status)}
                </Badge>
              </SelectTrigger>
              <SelectContent className="z-[210]">
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {formatLeadStatus(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="secondary" className="text-xs capitalize">
              {extendedSourceLabels[detailLead.source] || detailLead.source?.replace(/_/g, ' ')}
            </Badge>
          </div>
        </div>
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Contact Information</h4>
          <div className="space-y-2.5">
            {detailLead.email && (
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center"><Mail className="h-4 w-4 text-blue-600" /></div>
                <div><p className="text-xs text-muted-foreground">Email</p><p className="text-sm font-medium break-all">{detailLead.email}</p></div>
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
          </div>
        </div>
        <div className="border-t border-border pt-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Assignment & Tracking</h4>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Assigned To</p>
                <p className="text-sm font-medium">{formatAssignedColumn(detailLead).label}</p>
              </div>
              {isManager && (teamMembers.length > 0 || !!user?.id) && (
                <Button variant="outline" size="sm" className="gap-1 h-7 text-xs shrink-0" onClick={() => openAssignDialog(detailLead.id)}>
                  <UserPlus className="h-3 w-3" />{isLeadAssigned(detailLead) ? 'Reassign' : 'Assign'}
                </Button>
              )}
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="text-sm font-medium">{new Date(detailLead.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
              </div>
            </div>
          </div>
        </div>
        {detailLead.notes && !String(detailLead.notes).includes('Answers:') && (
          <div className="border-t border-border pt-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5"><StickyNote className="h-3.5 w-3.5" />Notes</h4>
            <p className="text-sm text-muted-foreground leading-relaxed bg-muted/50 p-3 rounded-lg">{detailLead.notes}</p>
          </div>
        )}
        <FormSubmissionDetails notes={detailLead.notes} resumePath={detailLead.resume_path} />
        <LeadActivityTimeline
          leadId={detailLead.id}
          getProfileName={(uid) => getAssignedName(uid) || profiles.find((p) => p.user_id === uid)?.full_name || 'Unknown'}
        />
        <div className="border-t border-border pt-4 flex gap-2">
          {canEditLead(detailLead) && (
            <Button variant="outline" size="sm" className="gap-1.5 flex-1" onClick={() => openEdit(detailLead)}>
              <Pencil className="h-3.5 w-3.5" /> Edit Lead
            </Button>
          )}
          {canDeleteLead() && (
            <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => { handleDelete(detailLead.id); closeInlineDetail(); }}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          )}
        </div>
      </div>
    ) : null;

  return (
    <div>
      {!!sourceDialogKey && (
        <SourceLeadsDialog
          open
          onOpenChange={(open) => { if (!open) closeSourceCard(); }}
          sourceKey={sourceDialogKey}
          title={sourceDialogLabel}
          initialStatus={sourceDialogStatus}
          leads={sourceDialogLeads}
          teamMembers={sourceDialogAssignMembers}
          isManager={isManager}
          canBulkAssign={isManager || hasBulkDelete}
          canBulkDelete={hasBulkDelete}
          statusColors={statusColors}
          getLeadAssignedNames={getLeadAssignedNames}
          onOpenDetail={openDetail}
          onOpenAssign={openAssignDialog}
          onBulkAutoAssign={handleBulkAutoAssign}
          isAutoAssigning={bulkAssigning}
          onBulkUndoAssign={handleBulkUndoAssign}
          getLeadAssignedIds={(lead) =>
            leadAssignments[lead.id] || (lead.assigned_to ? [lead.assigned_to] : [])
          }
          currentUserId={user?.id}
          onBulkDelete={hasBulkDelete ? handleBulkDelete : undefined}
          canEditLead={() => true}
          onStatusChange={onLeadStatusSelect}
          selectedLeadId={detailLead?.id ?? null}
          detailPanel={sourceCardDetailPanel}
          onCloseDetail={closeInlineDetail}
          backLabel="Back to Leads Management"
          getCreatedByName={(lead) => {
            const fromApi = String(lead?.created_by_name || '').trim();
            if (fromApi) return fromApi;
            const id = String(lead?.created_by || '').trim();
            if (!id) return '';
            return getAssignedName(id) || profiles.find((p) => p.user_id === id)?.full_name || '';
          }}
          canExport={canExportLeads}
          onExport={(rows) => downloadLeadsCsv(rows, sourceDialogLabel || String(sourceDialogKey || 'leads'))}
        />
      )}
      {!sourceDialogKey && (
      <>
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
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="hidden"
                onChange={handleImport}
              />
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8"
                onClick={openImport}
                disabled={importBusy}
              >
                <Upload className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Import</span>
              </Button>
              {!isSuperAdmin && organization?.name ? (
                <span className="text-[11px] text-muted-foreground hidden md:inline">
                  → {organization.name}
                </span>
              ) : null}
            </>
          )}
          {canExportLeads && (
            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={openExportCardsDialog}>
              <Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">Export</span>
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
                  showAssignToSelf={
                    isManager ||
                    isSalesRepRole(normalizedLeadRole) ||
                    rosterMarketingLike ||
                    normalizedLeadRole === 'hr'
                  }
                />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>


      {/* KPI Cards */}
      <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3 mb-5`}>
        {[
          { label: 'Total Leads', value: totalLeads, icon: Users, color: 'text-blue-600', bg: 'bg-blue-500/10', sub: 'Imported' },
          { label: 'New', value: newLeads, icon: Clock, color: 'text-sky-600', bg: 'bg-sky-500/10', sub: 'Untouched' },
          { label: 'In Pipeline', value: inPipeline, icon: Target, color: 'text-amber-600', bg: 'bg-amber-500/10', sub: 'Active' },
          { label: 'Enroll', value: enrollLeads, icon: GraduationCap, color: 'text-teal-700', bg: 'bg-teal-500/10', sub: `${convRate}% won` },
          { label: 'Lost', value: lostLeads, icon: XCircle, color: 'text-red-600', bg: 'bg-red-500/10', sub: 'Dropped' },
          { label: 'Unassigned', value: unassignedCount, icon: UserPlus, color: 'text-amber-600', bg: 'bg-amber-500/10', sub: 'Need action' },
        ].map(c => (
          <Card key={c.label} className={`border-border/50 shadow-none ${useSourceCards ? '' : 'hover:shadow-md transition-shadow cursor-pointer'} ${
            !useSourceCards && c.label === 'Unassigned' && unassignedOnly
              ? 'ring-2 ring-primary/40'
              : ''
          }`} onClick={() => {
            if (useSourceCards) return;
            if (c.label === 'Unassigned') {
              setUnassignedOnly((v) => !v);
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
            <h2 className="text-sm font-semibold tracking-tight">
              {isFormLeadsPage || isSalesRepMyLeadsPage ? 'Leads by form' : 'Leads by source'}
            </h2>
            <p className="text-xs text-muted-foreground">
              {isFormLeadsPage || isSalesRepMyLeadsPage
                ? 'Each form has its own card. Open a card to view leads, filter, and assign.'
                : 'Open a source or form card to view leads, filter by status, and bulk assign.'}
            </p>
          </div>
          {sourceSummaries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 rounded-lg border border-dashed border-border/60">
              <Users className="h-12 w-12 text-muted-foreground/20 mb-4" />
              <p className="text-sm font-medium text-muted-foreground">No leads yet</p>
              <p className="text-xs text-muted-foreground mt-1">Import a CSV or Excel file, or add a lead to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {sourceSummaries.map((summary) => {
                const Icon = summary.isImport
                  ? UploadIcon
                  : summary.isPeaklyy || isPeaklyySourceBucket(summary.key)
                    ? ClipboardCheck
                    : summary.isAdded || summary.key === 'added_leads'
                      ? UserPlus
                      : summary.isForm || isFormSourceBucket(summary.key)
                        ? FileText
                        : SOURCE_BUCKET_ICONS[summary.key as LeadSourceBucket] || CircleHelp;
                const statusChips = SOURCE_STATUS_CHIP_ORDER.filter((s) => (summary.byStatus[s] || 0) > 0);
                const visibleChips = statusChips.slice(0, 4);
                const hiddenChipCount = statusChips.length - visibleChips.length;
                return (
                  <Card
                    key={summary.key}
                    className="border-border/50 shadow-none hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group"
                    onClick={() => openSourceDialog(summary.key, summary.label, 'all')}
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
                              openSourceDialog(summary.key, summary.label, status);
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

        </>
      ) : (
      <>
      {/* Filters Row */}
      <div className="flex flex-col gap-2 mb-4 md:flex-row md:items-center">
        <div className="relative flex-1 min-w-0 md:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name, email, phone..." value={search} onChange={(e: any) => setSearch(e.target.value)} className="pl-9 h-11 md:h-9" />
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex md:w-auto">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full min-w-0 h-11 md:h-9 md:w-[160px]"><Filter className="h-3.5 w-3.5 mr-1.5 shrink-0" /><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {LEAD_STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{formatLeadStatus(s)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-full min-w-0 h-11 md:h-9 md:w-[160px]"><SelectValue placeholder="Source" /></SelectTrigger>
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
          {isManager && (teamMembers.length > 0 || !!user?.id) && (
            <Button size="sm" variant="outline" className="gap-1.5 h-7" onClick={openBulkMultiAssignDialog}>
              <UserPlus className="h-3.5 w-3.5" />Assign
            </Button>
          )}
          {hasBulkDelete && (
            <Button size="sm" variant="destructive" className="h-7 gap-1" onClick={() => void handleBulkDelete()}>
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
                    <p className="text-xs text-muted-foreground ml-7 flex items-center gap-1 min-w-0">
                      {lead.college ? <><GraduationCap className="h-3 w-3 shrink-0" /><span className="truncate">{lead.college}</span></> : <><Building2 className="h-3 w-3 shrink-0" /><span className="truncate">{lead.company}</span></>}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Select
                    value={leadStatusSelectValue(lead.status)}
                    onValueChange={(v: string) => {
                      if (v) onLeadStatusSelect(lead, v);
                    }}
                  >
                    <SelectTrigger className="h-7 w-auto border-0 p-0" onClick={(e) => e.stopPropagation()}>
                      <Badge variant="outline" className={`${statusColors[statusBadgeKey(lead.status)]} capitalize text-[11px] px-2 py-0.5`}>{formatLeadStatus(lead.status)}</Badge>
                    </SelectTrigger>
                    <SelectContent>
                      {LEAD_STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{formatLeadStatus(s)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-10 w-10 max-md:h-11 max-md:w-11 rounded-lg touch-target" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openDetail(lead); }}><Eye className="h-4 w-4 mr-2" /> View</DropdownMenuItem>
                      {canEditLead(lead) && <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(lead); }}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>}
                      {isManager && (teamMembers.length > 0 || !!user?.id) && (
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
                  const col = formatAssignedColumn(lead);
                  return (
                    <span
                      className={`text-[11px] font-medium shrink-0 max-w-[45%] truncate text-right ${
                        col.isAssigned ? 'text-primary' : 'text-amber-600'
                      }`}
                    >
                      {col.label}
                    </span>
                  );
                })()}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card className="border-border/50 shadow-none overflow-hidden">
          <div className="crm-table-scroll overflow-x-auto">
          <Table className="min-w-[720px]">
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
                  <TableCell className="max-w-[220px]">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{lead.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{lead.college || lead.company || ''}</p>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <div className="text-sm truncate">{lead.email || '—'}</div>
                    {lead.phone && <div className="text-xs text-muted-foreground truncate">{lead.phone}</div>}
                  </TableCell>
                  <TableCell><Badge variant="secondary" className="text-xs capitalize">{extendedSourceLabels[lead.source] || lead.source?.replace(/_/g, ' ')}</Badge></TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={leadStatusSelectValue(lead.status)}
                      onValueChange={(v: string) => onLeadStatusSelect(lead, v)}
                    >
                      <SelectTrigger className="h-7 w-auto border-0 p-0">
                        <Badge variant="outline" className={`${statusColors[statusBadgeKey(lead.status)]} capitalize text-xs`}>{formatLeadStatus(lead.status)}</Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {LEAD_STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{formatLeadStatus(s)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  {isManager && (
                    <TableCell className="max-w-[160px]">
                      {(() => {
                        const col = formatAssignedColumn(lead);
                        return (
                          <span
                            className={`text-sm font-medium truncate block ${
                              col.isAssigned ? '' : 'text-xs text-amber-600'
                            }`}
                          >
                            {col.label}
                          </span>
                        );
                      })()}
                    </TableCell>
                  )}
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{new Date(lead.created_at).toLocaleDateString()}</TableCell>
                  {isManager && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Button variant="outline" size="sm" className="gap-1 h-9 text-xs" onClick={() => openAssignDialog(lead.id)}>
                        <UserPlus className="h-3 w-3" />
                        {isLeadAssigned(lead) ? 'Reassign' : 'Assign'}
                      </Button>
                    </TableCell>
                  )}
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-9 w-9"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
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
          </div>
        </Card>
      )}

      {/* Pagination Controls */}
      {filtered.length > pageSize && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 mt-4 px-1">
          <p className="text-xs text-muted-foreground">
            Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-10 w-10 max-md:h-11 max-md:w-11" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>
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
            <Button variant="outline" size="icon" className="h-10 w-10 max-md:h-11 max-md:w-11" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      </>
      )}
      </>
      )}

      <Sheet open={detailOpen && !sourceDialogKey} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {detailLead && (
            <>
              <SheetHeader className="pb-4 border-b border-border">
                <SheetTitle className="text-lg">{detailLead.name}</SheetTitle>
                <div className="flex items-center gap-2 mt-1">
                  <Select
                    value={leadStatusSelectValue(detailLead.status)}
                    onValueChange={(v: string) => {
                      if (!v) return;
                      onLeadStatusSelect(detailLead, v);
                    }}
                  >
                    <SelectTrigger className="h-7 w-auto border-0 p-0">
                      <Badge variant="outline" className={`${statusColors[statusBadgeKey(detailLead.status)] || statusColors[detailLead.status] || ''} capitalize text-xs`}>
                        {formatLeadStatus(detailLead.status)}
                      </Badge>
                    </SelectTrigger>
                    <SelectContent>
                      {LEAD_STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{formatLeadStatus(s)}</SelectItem>)}
                    </SelectContent>
                  </Select>
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
                        <p className="text-sm font-medium">{formatAssignedColumn(detailLead).label}</p>
                      </div>
                      {isManager && (teamMembers.length > 0 || !!user?.id) && (
                        <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={() => openAssignDialog(detailLead.id)}>
                          <UserPlus className="h-3 w-3" />{isLeadAssigned(detailLead) ? 'Reassign' : 'Assign'}
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
              showAssignToSelf={
                isManager ||
                isSalesRepRole(normalizedLeadRole) ||
                rosterMarketingLike ||
                normalizedLeadRole === 'hr'
              }
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Assign Lead Dialog - Multi-select with Checkboxes */}
      <Dialog open={assignOpen} onOpenChange={(open) => { if (!assignSaving) { setAssignOpen(open); if (!open) { setAssignLeadId(null); setAssignSelectedReps(new Set()); } } }}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              {assignLeadId
                ? 'Assign Lead to Team Members'
                : `Assign ${selectedIds.size} Leads to Team Members`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2 max-h-64 overflow-y-auto">
            {isManager && user?.id ? (
              <div className="space-y-1.5 mb-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">Yourself</p>
                <label
                  className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${
                    assignSelectedReps.has(user.id)
                      ? 'bg-primary/5 border-primary/30'
                      : 'bg-muted/30 border-border hover:bg-muted/50'
                  } ${assignSaving ? 'opacity-60 pointer-events-none' : ''}`}
                >
                  <Checkbox
                    checked={assignSelectedReps.has(user.id)}
                    onCheckedChange={() => {
                      setAssignSelectedReps((prev) => {
                        const next = new Set(prev);
                        if (next.has(user.id)) next.delete(user.id);
                        else next.add(user.id);
                        return next;
                      });
                    }}
                    disabled={assignSaving}
                  />
                  <span className="text-sm font-medium">Assign to self</span>
                </label>
              </div>
            ) : null}
            {Object.entries(groupedAssignRoster).map(([group, members]) => (
              <div key={group} className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">{group}</p>
                {members
                  .filter((m: any) => !user?.id || String(m.id) !== String(user.id))
                  .map((m: any) => (
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
            {assignRosterMembers.length === 0 && !(isManager && user?.id) && (
              <p className="text-sm text-muted-foreground text-center py-4">No team members available</p>
            )}
          </div>
          {assignSelectedReps.size > 0 && (
            <p className="text-xs text-muted-foreground">{assignSelectedReps.size} rep{assignSelectedReps.size > 1 ? 's' : ''} selected</p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setAssignOpen(false); setAssignLeadId(null); setAssignSelectedReps(new Set()); }} disabled={assignSaving}>Cancel</Button>
            <Button onClick={handleMultiAssign} disabled={assignSelectedReps.size === 0 || assignSaving || (!assignLeadId && selectedIds.size === 0)} className="gap-1.5">
              {assignSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {assignSaving
                ? 'Saving...'
                : assignLeadId
                  ? `Assign to ${assignSelectedReps.size} Rep${assignSelectedReps.size !== 1 ? 's' : ''}`
                  : `Assign ${selectedIds.size} leads to ${assignSelectedReps.size} Rep${assignSelectedReps.size !== 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <DialogTitle>Import leads</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {isSuperAdmin ? (
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
            ) : importTargetOrgName ? (
              <p className="text-sm rounded-lg bg-muted/50 px-3 py-2">
                Importing into: <span className="font-medium">{importTargetOrgName}</span>
              </p>
            ) : null}
            <div className="rounded-lg border border-dashed px-3 py-3 space-y-2">
              <p className="text-sm font-medium">Need a template?</p>
              <p className="text-xs text-muted-foreground">
                Upload CSV, Excel XLSX, or legacy Excel XLS files. The first worksheet must contain a header row.
                Columns can use flexible names (Student Name, Company Name, Mobile, Email ID, …) — order and extra columns do not matter.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-9"
                  onClick={() => {
                    void downloadLeadImportTemplateExcel()
                      .then(() => {
                        toast({ title: 'Template downloaded', description: 'leads-import-template.xlsx' });
                      })
                      .catch(() => {
                        toast({ variant: 'destructive', title: 'Could not create Excel template' });
                      });
                  }}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download Excel template
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => {
                    downloadLeadImportTemplate();
                    toast({ title: 'Template downloaded', description: 'leads-import-template.csv' });
                  }}
                >
                  CSV template
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importBusy}>Cancel</Button>
            <Button
              disabled={importBusy || (isSuperAdmin ? !importOrgId : !importOrgId && !organization?.id)}
              className="gap-1.5"
              onClick={() => {
                const orgReady = isSuperAdmin ? !!importOrgId : !!(importOrgId || organization?.id);
                if (!orgReady) {
                  toast({ variant: 'destructive', title: isSuperAdmin ? 'Select an organization' : 'Organization not loaded — refresh and try again' });
                  return;
                }
                fileInputRef.current?.click();
              }}
            >
              {importBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {importBusy ? 'Importing…' : 'Choose CSV or Excel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exportCardsOpen} onOpenChange={setExportCardsOpen}>
        <DialogContent className="max-w-lg max-h-[min(90dvh,calc(100dvh-2rem))] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
            <DialogTitle>Export leads by card</DialogTitle>
          </DialogHeader>
          <p className="px-6 text-xs text-muted-foreground pb-2">
            Select the source/form cards to include. Only leads from checked cards are exported.
          </p>
          <div className="px-6 pb-2 flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => {
                if (exportCardKeys.size === sourceSummaries.length) {
                  setExportCardKeys(new Set());
                } else {
                  setExportCardKeys(new Set(sourceSummaries.map((s) => s.key)));
                }
              }}
            >
              {exportCardKeys.size === sourceSummaries.length && sourceSummaries.length > 0
                ? 'Deselect all'
                : 'Select all'}
            </button>
            <span className="text-xs text-muted-foreground">
              {exportCardKeys.size} of {sourceSummaries.length} selected
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2 space-y-1.5 max-h-[50vh]">
            {sourceSummaries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No cards available</p>
            ) : (
              sourceSummaries.map((summary) => (
                <label
                  key={summary.key}
                  className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5 cursor-pointer hover:bg-muted/40"
                >
                  <Checkbox
                    checked={exportCardKeys.has(summary.key)}
                    onCheckedChange={(v) => {
                      setExportCardKeys((prev) => {
                        const next = new Set(prev);
                        if (v === true) next.add(summary.key);
                        else next.delete(summary.key);
                        return next;
                      });
                    }}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="text-sm font-medium block truncate">{summary.label}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {summary.total} lead{summary.total === 1 ? '' : 's'}
                      {summary.unassigned > 0 ? ` · ${summary.unassigned} unassigned` : ''}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
          <DialogFooter className="px-6 py-4 border-t shrink-0 gap-2">
            <Button type="button" variant="outline" onClick={() => setExportCardsOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="gap-1.5"
              disabled={exportCardKeys.size === 0}
              onClick={handleExportSelectedCards}
            >
              <Download className="h-4 w-4" />
              Export selected
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
      assigned_to: '',
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
          <Label>Assign to Team Member (L1)</Label>
            <Select
              value={form.assigned_to || 'unassigned'}
              onValueChange={v => setForm({ ...form, assigned_to: v === 'unassigned' ? '' : v })}
            >
            <SelectTrigger><SelectValue placeholder="Unassigned (assign later)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {showAssignToSelf && currentUserId ? (
                  <SelectItem value={currentUserId}>Assigned to self</SelectItem>
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
