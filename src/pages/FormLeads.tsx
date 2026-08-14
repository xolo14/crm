import { useState, useRef, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { sendNotificationWithEmail } from '@/lib/notifications';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { Search, Filter, Download, Loader2, Phone, Mail, UserPlus, Users, TrendingUp, Target, Clock, Eye, History, CalendarDays, Building2, GraduationCap, StickyNote, ArrowUpRight, XCircle, MoreHorizontal, Pencil, Trash2, FileText, Shuffle, ChevronLeft, ChevronRight, Upload, Plus } from 'lucide-react';
import { BulkAssignDialog } from '@/components/BulkAssignDialog';
import ResumeUploadBox from '@/components/hr/ResumeUploadBox';
import { LeadActivityTimeline } from '@/components/LeadActivityTimeline';
import { LeadEnrollDialog } from '@/components/leads/LeadEnrollDialog';
import * as perms from '@/lib/permissions';
import { openProtectedUpload } from '@/lib/resumeHref';
import { FormSubmissionDetails } from '@/components/leads/FormSubmissionDetails';
import { LeadContactBlock } from '@/components/leads/LeadContactBlock';
import { SourceLeadsDialog } from '@/components/leads/SourceLeadsDialog';
import {
  buildSourceSummaries,
  filterLeadsBySourceBucket,
  getFormSourceKey,
  getLeadSourceBucket,
  resolveFormAssigneesForSourceKey,
} from '@/lib/leadSources';
import { downloadLeadsDetailCsv } from '@/lib/leadsExportCsv';
import { filterAndSortAssignRoster } from '@/lib/assignRoster';

const MARKETING_RESUME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

const LEAD_STATUSES = ['new', 'contacted', 'not_answered', 'messaged', 'qualified', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'] as const;

const formatLeadStatus = (s?: string | null) => {
  if (!s) return 'New';
  if (s === 'enrolled' || s === 'converted') return 'Enroll';
  if (s === 'not_answered') return 'Not answered';
  if (s === 'messaged') return 'Messaged';
  return s.replace(/_/g, ' ');
};

const statusBadgeKey = (s?: string | null) => (s === 'converted' ? 'enrolled' : s || '');

const statusColors: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-700 border-blue-200',
  contacted: 'bg-amber-500/10 text-amber-700 border-amber-200',
  not_answered: 'bg-slate-500/10 text-slate-700 border-slate-200',
  messaged: 'bg-sky-500/10 text-sky-700 border-sky-200',
  interested: 'bg-emerald-500/10 text-emerald-700 border-emerald-200',
  demo_scheduled: 'bg-indigo-500/10 text-indigo-700 border-indigo-200',
  demo_attended: 'bg-violet-500/10 text-violet-700 border-violet-200',
  considering: 'bg-orange-500/10 text-orange-700 border-orange-200',
  enrolled: 'bg-teal-500/10 text-teal-800 border-teal-200',
  converted: 'bg-green-500/10 text-green-700 border-green-200',
  lost: 'bg-red-500/10 text-red-700 border-red-200',
};

const SOURCE_LABELS: Record<string, string> = {
  google_ads: 'Google Ads', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube',
  website: 'Website', google_forms: 'Google Forms', whatsapp: 'WhatsApp', referral: 'Referral',
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
  if (normalized.startsWith('marketing')) return 'Marketing';
  if (normalized === 'sales_representative') return 'Sales Representative';
  if (normalized === 'manager') return 'Manager';
  if (normalized === 'hr') return 'HR';
  if (normalized === 'trainer') return 'Trainer';
  if (normalized === 'finance') return 'Finance';
  return normalized ? normalized.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Other';
};

export default function FormLeads() {
  const { user, role, profile, organization } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [employeeFilter, setEmployeeFilter] = useState(searchParams.get('employee') || 'all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignLeadId, setAssignLeadId] = useState<string | null>(null);
  const [detailLead, setDetailLead] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [assignSelectedReps, setAssignSelectedReps] = useState<Set<string>>(new Set());
  const [assignSaving, setAssignSaving] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [enrollLead, setEnrollLead] = useState<any | null>(null);
  const [leadForms, setLeadForms] = useState<{ id: string; slug: string; name: string }[]>([]);
  const [formAssignmentsByFormId, setFormAssignmentsByFormId] = useState<
    Record<string, Array<{ member_id: string; full_name?: string | null }>>
  >({});
  const [sourceDialogKey, setSourceDialogKey] = useState<string | null>(null);
  const [sourceDialogLabel, setSourceDialogLabel] = useState('');
  const [sourceDialogStatus, setSourceDialogStatus] = useState('all');
  const [leadAssignments, setLeadAssignments] = useState<Record<string, string[]>>({});

  // Marketing add/import
  const isMarketing = role === 'marketing';
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [showAddLead, setShowAddLead] = useState(false);
  const [addingLead, setAddingLead] = useState(false);
  const [newLead, setNewLead] = useState({ name: '', email: '', phone: '', college: '', source: 'other' });
  const [manualLeadResume, setManualLeadResume] = useState<File | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importingLeads, setImportingLeads] = useState(false);

  const isManager =
    role === 'admin' || role === 'org' || role === 'super_admin' || role === 'manager';
  const hasEditAll = perms.canEditAll(role);
  const hasDelete = perms.canDelete(role);
  const hasBulkDelete = perms.canBulkDelete(role);
  const rl = String(role || '').trim().toLowerCase().replace(/^superadmin$/, 'super_admin');
  const canExportLeads = rl === 'super_admin' || rl === 'admin';
  const [exportCardsOpen, setExportCardsOpen] = useState(false);
  const [exportCardKeys, setExportCardKeys] = useState<Set<string>>(new Set());
  const formLeadsAssignmentRoster =
    isManager || rl.startsWith('marketing') || rl === 'hr';

  useEffect(() => {
    fetchData();
    if (formLeadsAssignmentRoster) fetchTeam();
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
        if (!formLeadsAssignmentRoster || forms.length === 0) {
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
  }, [role, user?.id, profile?.referral_code]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [leadsData, profilesData, assignRes] = await Promise.all([
        api.leads.list(),
        api.profiles.list(),
        api.leadAssignments.list().catch(() => ({ data: [] })),
      ]);
      const allLeads = Array.isArray(leadsData) ? leadsData : leadsData.data || leadsData.leads || [];
      const myRef = profile?.referral_code || user?.referral_code || '';
      setLeads(allLeads.filter((l: any) => {
        const src = String(l.source || '');
        const isFormLead =
          !!l.referred_by ||
          src.startsWith('form_') ||
          src === 'normal_form' ||
          src === 'google_forms';
        if (!isFormLead) return false;
        if (isManager) return true;
        if (l.assigned_to === user?.id || l.created_by === user?.id) return true;
        if (myRef && l.referred_by === myRef) return true;
        return false;
      }));
      setProfiles((Array.isArray(profilesData) ? profilesData : profilesData.profiles || profilesData.data || []).filter((p: any) => p.referral_code));
      const assignRows = Array.isArray(assignRes) ? assignRes : (assignRes as { data?: any[] })?.data || [];
      const map: Record<string, string[]> = {};
      for (const row of assignRows as Array<{ lead_id?: string; user_id?: string }>) {
        const lid = String(row.lead_id || '');
        const uid = String(row.user_id || '');
        if (!lid || !uid) continue;
        if (!map[lid]) map[lid] = [];
        if (!map[lid].includes(uid)) map[lid].push(uid);
      }
      setLeadAssignments(map);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchTeam = async () => {
    try {
      const [teamRes, marketingRes] = await Promise.allSettled([
        api.team.list(),
        role === 'manager' ? Promise.resolve({ data: [] }) : api.marketing.members(),
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

  const userIdToName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of profiles) { if (p.user_id) map[p.user_id] = p.full_name || 'Unknown'; }
    return map;
  }, [profiles]);

  const canEditLead = (lead: any) => {
    if (hasEditAll) return true;
    const uid = user?.id ? String(user.id) : '';
    if (!uid) return false;
    if (String(lead.assigned_to || '') === uid) return true;
    if (String(lead.created_by || '') === uid) return true;
    const ref = String(profile?.referral_code ?? '').trim();
    if (ref && String(lead.referred_by || '').trim() === ref) return true;
    return false;
  };
  const canDeleteLead = () => hasDelete;

  const getAssignedName = (id: string) => {
    if (user?.id && String(id) === String(user.id)) return 'Assigned to self';
    const member = teamMembers.find(m => m.id === id);
    if (member) return member.full_name;
    if (formAssigneeNameById[id]) return formAssigneeNameById[id];
    return userIdToName[id] || '';
  };

  const filtered = useMemo(() => {
    let result = leads;
    if (employeeFilter !== 'all') {
      const prof = profiles.find(p => p.user_id === employeeFilter);
      if (prof?.referral_code) result = result.filter(l => l.referred_by === prof.referral_code);
    }
    if (statusFilter !== 'all') {
      if (statusFilter === 'enrolled' || statusFilter === 'converted') {
        result = result.filter(l => l.status === 'enrolled' || l.status === 'converted');
      } else {
        result = result.filter(l => l.status === statusFilter);
      }
    }
    if (sourceFilter !== 'all') result = result.filter(l => l.source === sourceFilter);
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(l => l.name?.toLowerCase().includes(s) || l.email?.toLowerCase().includes(s) || l.phone?.includes(s) || l.college?.toLowerCase().includes(s));
    }
    return result;
  }, [leads, employeeFilter, statusFilter, sourceFilter, search, profiles]);

  const cardLeads = useMemo(() => {
    let result = leads;
    if (employeeFilter !== 'all') {
      const prof = profiles.find((p) => p.user_id === employeeFilter);
      if (prof?.referral_code) result = result.filter((l) => l.referred_by === prof.referral_code);
    }
    return result;
  }, [leads, employeeFilter, profiles]);

  const formLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    leadForms.forEach((f) => {
      labels[f.slug] = f.name;
      labels[`form_${f.slug}`] = f.name;
    });
    return labels;
  }, [leadForms]);

  const sourceSummaries = useMemo(
    () => buildSourceSummaries(cardLeads, { formLabels }),
    [cardLeads, formLabels],
  );

  const sourceDialogLeads = useMemo(() => {
    if (!sourceDialogKey) return [];
    return filterLeadsBySourceBucket(cardLeads, sourceDialogKey);
  }, [cardLeads, sourceDialogKey]);

  const SOURCE_STATUS_CHIP_ORDER = ['new', 'contacted', 'not_answered', 'messaged', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'];

  const openSourceDialog = (key: string, label: string, status: string = 'all') => {
    setSourceDialogKey(key);
    setSourceDialogLabel(label);
    setSourceDialogStatus(status);
  };

  const getLeadAssignedNames = (lead: any) => {
    const name = getAssignedName(lead?.assigned_to);
    return name ? [name] : [];
  };
  const formatAssignedLabel = (lead: any) => {
    const names = getLeadAssignedNames(lead);
    if (names.length > 0) return names.join(', ');
    if (lead?.assigned_to) return 'Assigned';
    return 'Unassigned';
  };
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

  // KPI helpers keep using cardLeads below

  // Reset page on filter change
  useEffect(() => { setCurrentPage(1); }, [search, statusFilter, sourceFilter, employeeFilter]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedLeads = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  // KPIs (respect employee filter via cardLeads)
  const totalLeads = leads.length;
  const filteredTotal = cardLeads.length;
  const newLeads = cardLeads.filter(l => l.status === 'new').length;
  const inPipeline = cardLeads.filter(l => ['interested', 'demo_scheduled', 'demo_attended'].includes(l.status)).length;
  const enrollLeads = cardLeads.filter(l => l.status === 'enrolled' || l.status === 'converted').length;
  const lostLeads = cardLeads.filter(l => l.status === 'lost').length;
  const unassignedCount = cardLeads.filter(l => !l.assigned_to).length;
  const totalUnassignedCount = leads.filter(l => !l.assigned_to).length;
  const convRate = filteredTotal > 0 ? Math.round((enrollLeads / filteredTotal) * 100) : 0;


  const updateStatus = async (id: string, status: string) => {
    try {
      await api.leads.update(id, { status });
      setLeads(prev => prev.map(l => l.id === id ? { ...l, status } : l));
      setDetailLead(prev => (prev?.id === id ? { ...prev, status } : prev));
      if (status === 'enrolled') {
        toast({ title: 'Enroll', description: 'Lead set to Enroll and a student record was created (if not already).' });
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

  const handleMultiAssign = async () => {
    if (!assignLeadId || assignSelectedReps.size === 0) return;
    const repIds = Array.from(assignSelectedReps);
    const primary = repIds[0];
    setAssignSaving(true);
    try {
      await api.leadAssignments.setAssignees(assignLeadId, repIds);
      setLeads(prev => prev.map(l => l.id === assignLeadId ? { ...l, assigned_to: primary } : l));
      if (detailLead?.id === assignLeadId) setDetailLead({ ...detailLead, assigned_to: primary });
      const lead = leads.find(l => l.id === assignLeadId);
      const repNames = repIds.map(id => getAssignedName(id) || teamMembers.find(m => m.id === id)?.full_name || '').filter(Boolean).join(', ');
      toast({ title: `Lead assigned to ${repNames}` });
      for (const repId of repIds) {
        await sendNotificationWithEmail({
          userId: repId, title: 'New Lead Assigned',
          message: `Lead "${lead?.name || 'Unknown'}" has been assigned to you.`,
          type: 'lead_assigned', link: '/leads',
          leadName: lead?.name || 'Unknown', assignedByName: profile?.full_name || 'Manager',
        });
      }
      setAssignOpen(false); setAssignLeadId(null); setAssignSelectedReps(new Set());
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setAssignSaving(false);
    }
  };

  const handleBulkAssign = async (repIds: string[]) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || repIds.length === 0) return;
    try {
      const res = await api.leadAssignments.bulkAssign(ids, repIds);
      const assigned = typeof res?.assigned === 'number' ? res.assigned : ids.length;
      const failed = typeof res?.failed === 'number' ? res.failed : 0;
      await fetchData();
      const repNames = repIds.map(id => getAssignedName(id) || teamMembers.find(m => m.id === id)?.full_name || '').filter(Boolean).join(', ');
      toast({
        title: `${assigned} leads assigned to ${repNames}`,
        description: failed > 0 ? `${failed} failed` : undefined,
        variant: failed > 0 && assigned === 0 ? 'destructive' : undefined,
      });
      if (assigned > 0) {
        for (const repId of repIds) {
          await sendNotificationWithEmail({
            userId: repId, title: `${assigned} Leads Assigned`,
            message: `You have been assigned ${assigned} lead(s).`,
            type: 'lead_assigned', link: '/leads',
            leadName: `${assigned} leads`, assignedByName: profile?.full_name || 'Manager',
          });
        }
      }
      setSelectedIds(new Set());
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Bulk assign failed', description: err?.message || 'Request failed' });
    }
  };

  const handleAutoAllocate = async (leadId: string) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead?.referred_by) return;
    const repId = codeToUserId[lead.referred_by];
    if (!repId) { toast({ variant: 'destructive', title: 'Collector not found' }); return; }
    await handleAssignDirect(leadId, repId);
  };

  const handleAssignDirect = async (leadId: string, repId: string) => {
    try {
      await api.leadAssignments.setAssignees(leadId, [repId]);
      const repName = getAssignedName(repId) || teamMembers.find(m => m.id === repId)?.full_name || 'Rep';
      const lead = leads.find(l => l.id === leadId);
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, assigned_to: repId } : l));
      toast({ title: `Lead assigned to ${repName}` });
      await sendNotificationWithEmail({
        userId: repId, title: 'New Lead Assigned',
        message: `Lead "${lead?.name || 'Unknown'}" has been assigned to you.`,
        type: 'lead_assigned', link: '/leads',
        leadName: lead?.name || 'Unknown', assignedByName: profile?.full_name || 'Manager',
      });
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
  };

  const handleBulkAutoAllocate = async () => {
    const unassigned = filtered.filter(l => !l.assigned_to && l.referred_by && codeToUserId[l.referred_by]);
    if (unassigned.length === 0) { toast({ title: 'No leads to auto-allocate' }); return; }
    let count = 0;
    let failed = 0;
    for (const lead of unassigned) {
      try {
        await api.leadAssignments.setAssignees(lead.id, [codeToUserId[lead.referred_by]]);
        count++;
      } catch {
        failed++;
      }
    }
    fetchData();
    toast({
      title: `${count} leads auto-allocated to their collectors`,
      description: failed > 0 ? `${failed} failed` : undefined,
    });
  };

  const handleBulkAutoAssign = async (count: number, repIds: string[], poolLeadIds?: string[]) => {
    setBulkAssigning(true);
    try {
      const pool = poolLeadIds?.length
        ? leads.filter((l) => poolLeadIds.includes(l.id))
        : leads.filter((l) => !l.assigned_to);
      const toAssign = pool.slice(0, count);
      if (toAssign.length === 0) {
        toast({
          variant: 'destructive',
          title: 'No leads to assign',
          description: 'Select leads in the source card, or open a source with leads available.',
        });
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
      for (const [repId, leadIds] of Object.entries(repAssignments)) {
        if (leadIds.length === 0) continue;
        try {
          const res = await api.leadAssignments.bulkAssign(leadIds, repId);
          const ok = typeof res?.assigned === 'number' ? res.assigned : leadIds.length;
          const fail = typeof res?.failed === 'number' ? res.failed : 0;
          totalAssigned += ok;
          failed += fail;
          if (ok > 0) {
            const names = leadIds.map((lid) => leads.find((x) => x.id === lid)?.name).filter(Boolean) as string[];
            await sendNotificationWithEmail({
              userId: repId, title: `${ok} Leads Assigned`,
              message: `You have been assigned ${ok} new leads: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '...' : ''}.`,
              type: 'lead_assigned', link: '/leads',
              leadName: names.slice(0, 3).join(', '), assignedByName: profile?.full_name || 'Manager',
            });
          }
        } catch {
          failed += leadIds.length;
        }
      }
      fetchData();
      toast({
        title: `${totalAssigned} leads distributed across ${repIds.length} reps`,
        description: failed > 0 ? `${failed} failed` : undefined,
        variant: failed > 0 && totalAssigned === 0 ? 'destructive' : undefined,
      });
    } finally { setBulkAssigning(false); }
  };

  const handleDelete = async (id: string) => {
    if (!canDeleteLead()) { toast({ variant: 'destructive', title: 'Permission denied' }); return; }
    if (confirm('Delete this lead permanently?')) {
      try { await api.leads.delete(id); setLeads(prev => prev.filter(l => l.id !== id)); toast({ title: 'Lead deleted' }); }
      catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selectedIds.size} leads permanently?`)) return;
    for (const id of selectedIds) { try { await api.leads.delete(id); } catch {} }
    fetchData();
    toast({ title: `${selectedIds.size} leads deleted` });
    setSelectedIds(new Set());
  };

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
      getCollectedBy: (lead) => codeToName[lead?.referred_by] || lead?.referred_by || '',
      getCreatedBy: (lead) => {
        const fromApi = String(lead?.created_by_name || '').trim();
        if (fromApi) return fromApi;
        const id = String(lead?.created_by || '').trim();
        if (!id) return '';
        return getAssignedName(id) || userIdToName[id] || '';
      },
    });
    if (result.ok) {
      toast({ title: 'Form leads exported', description: `${result.count} lead(s) with full details downloaded.` });
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
    const rows = cardLeads.filter((l) => exportCardKeys.has(getLeadSourceBucket(l)));
    downloadLeadsCsv(rows, `form-leads-${exportCardKeys.size}-cards`);
    setExportCardsOpen(false);
  };

  const openDetail = (lead: any) => { setDetailLead(lead); setDetailOpen(true); };
  // When viewing a source/form card full page, keep detail inline (no sheet).
  const openDetailFromCard = (lead: any) => {
    setDetailLead(lead);
    setDetailOpen(false);
  };
  const closeSourceCard = () => {
    setSourceDialogKey(null);
    setDetailLead(null);
    setDetailOpen(false);
  };
  const closeInlineDetail = () => {
    setDetailLead(null);
  };

  // Marketing: Add lead
  const handleAddLeadSubmit = async () => {
    if (!newLead.name.trim()) { toast({ variant: 'destructive', title: 'Name is required' }); return; }
    const refCode = profile?.referral_code;
    if (!refCode) { toast({ variant: 'destructive', title: 'Referral code not found' }); return; }
    if (manualLeadResume) {
      if (manualLeadResume.size > 5 * 1024 * 1024) {
        toast({ variant: 'destructive', title: 'Resume too large', description: 'Max 5MB' });
        return;
      }
      if (!MARKETING_RESUME_TYPES.includes(manualLeadResume.type as (typeof MARKETING_RESUME_TYPES)[number])) {
        toast({ variant: 'destructive', title: 'Invalid file', description: 'PDF or Word only' });
        return;
      }
    }
    setAddingLead(true);
    try {
      let resumePath: string | undefined;
      if (manualLeadResume) {
        resumePath = await api.marketing.uploadLeadResume(manualLeadResume);
      }
      await api.leads.create({
        name: newLead.name.trim(),
        email: newLead.email.trim() || undefined,
        phone: newLead.phone.trim() || undefined,
        college: newLead.college.trim() || undefined,
        source: (Object.keys(SOURCE_LABELS).includes(newLead.source) ? newLead.source : 'other') as any,
        referred_by: refCode,
        assigned_to: user?.id || undefined,
        status: 'new' as const,
        ...(resumePath ? { resume_path: resumePath } : {}),
      });
      toast({ title: 'Lead added!' });
      setShowAddLead(false);
      setNewLead({ name: '', email: '', phone: '', college: '', source: 'other' });
      setManualLeadResume(null);
      fetchData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally { setAddingLead(false); }
  };

  // Marketing: CSV import
  const handleCsvSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) { toast({ variant: 'destructive', title: 'CSV needs header + data rows' }); return; }
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
      const nameIdx = headers.findIndex(h => h.includes('name'));
      const emailIdx = headers.findIndex(h => h.includes('email'));
      const phoneIdx = headers.findIndex(h => h.includes('phone') || h.includes('mobile'));
      const collegeIdx = headers.findIndex(h => h.includes('college') || h.includes('institution'));
      const sourceIdx = headers.findIndex(h => h.includes('source'));
      const parsed = lines.slice(1).map(line => {
        const cols = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)?.map(c => c.replace(/^"|"$/g, '').trim()) || line.split(',').map(c => c.trim());
        return { name: cols[nameIdx] || cols[0] || '', email: emailIdx >= 0 ? cols[emailIdx] : '', phone: phoneIdx >= 0 ? cols[phoneIdx] : '', college: collegeIdx >= 0 ? cols[collegeIdx] : '', source: sourceIdx >= 0 ? cols[sourceIdx] : 'other' };
      }).filter(r => r.name);
      setImportPreview(parsed);
      setShowImportDialog(true);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImportLeads = async () => {
    const refCode = profile?.referral_code;
    if (!refCode || importPreview.length === 0) return;
    setImportingLeads(true);
    try {
      const records = importPreview.map(r => ({
        name: r.name, email: r.email || null, phone: r.phone || null, college: r.college || null,
        source: (Object.keys(SOURCE_LABELS).includes(r.source) ? r.source : 'other') as any,
        referred_by: refCode, assigned_to: user?.id || undefined, status: 'new' as const,
      }));
      await api.leads.bulkCreate(records);
      toast({ title: `${records.length} leads imported!` });
      setShowImportDialog(false);
      setImportPreview([]);
      fetchData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Import failed', description: err.message });
    } finally { setImportingLeads(false); }
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

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  const formCardDetailPanel =
    sourceDialogKey && detailLead ? (
      <div className="space-y-5">
        <div className="pb-4 border-b border-border">
          <h3 className="text-lg font-semibold leading-tight">{detailLead.name}</h3>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {canEditLead(detailLead) ? (
              <Select
                value={detailLead.status === 'converted' ? 'enrolled' : (detailLead.status || 'new')}
                onValueChange={(v: string) => {
                  if (!v) return;
                  onLeadStatusSelect(detailLead, v);
                }}
              >
                <SelectTrigger className="h-7 w-auto border-0 p-0">
                  <Badge variant="outline" className={`${statusColors[statusBadgeKey(detailLead.status)] || ''} capitalize text-xs`}>
                    {formatLeadStatus(detailLead.status)}
                  </Badge>
                </SelectTrigger>
                <SelectContent className="z-[210]">
                  {LEAD_STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{formatLeadStatus(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="outline" className={`${statusColors[detailLead.status] || ''} capitalize text-xs`}>
                {formatLeadStatus(detailLead.status)}
              </Badge>
            )}
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
          </div>
        </div>
        <div className="border-t border-border pt-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Assignment & Tracking</h4>
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 gap-2">
            <div>
              <p className="text-xs text-muted-foreground">Assigned To</p>
              <p className="text-sm font-medium">{formatAssignedLabel(detailLead)}</p>
            </div>
          </div>
        </div>
        <FormSubmissionDetails notes={detailLead.notes} resumePath={detailLead.resume_path} />
        <LeadActivityTimeline
          leadId={detailLead.id}
          getProfileName={(uid) => getAssignedName(uid) || userIdToName[uid] || 'Unknown'}
        />
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
          onOpenDetail={openDetailFromCard}
          onOpenAssign={(leadId) => {
            const lead = leads.find(l => l.id === leadId);
            setAssignLeadId(leadId);
            setAssignSelectedReps(
              new Set(
                leadAssignments[leadId] || (lead?.assigned_to ? [lead.assigned_to] : []),
              ),
            );
            setAssignOpen(true);
          }}
          onBulkAutoAssign={handleBulkAutoAssign}
          isAutoAssigning={bulkAssigning}
          onBulkUndoAssign={async (snapshots) => {
            let ok = 0;
            for (const snap of snapshots) {
              try {
                await api.leadAssignments.setAssignees(snap.leadId, snap.userIds);
                ok++;
              } catch { /* continue */ }
            }
            fetchData();
            toast({ title: ok > 0 ? `Undid assignment on ${ok} lead${ok === 1 ? '' : 's'}` : 'Undo failed' });
          }}
          getLeadAssignedIds={(lead) =>
            leadAssignments[lead.id] || (lead.assigned_to ? [lead.assigned_to] : [])
          }
          currentUserId={user?.id}
          onBulkDelete={hasBulkDelete ? async (ids) => {
            if (!confirm(`Delete ${ids.length} leads permanently?`)) return;
            let deleted = 0;
            for (const id of ids) {
              try {
                await api.leads.delete(id);
                deleted++;
              } catch { /* continue */ }
            }
            fetchData();
            toast({
              title: deleted > 0
                ? `${deleted} lead${deleted === 1 ? '' : 's'} deleted`
                : 'Delete failed',
              description: deleted < ids.length && deleted > 0
                ? `${ids.length - deleted} could not be deleted`
                : undefined,
            });
            setSelectedIds(new Set());
          } : undefined}
          canEditLead={canEditLead}
          onStatusChange={onLeadStatusSelect}
          selectedLeadId={detailLead?.id ?? null}
          detailPanel={formCardDetailPanel}
          onCloseDetail={closeInlineDetail}
          backLabel="Back to Form Leads"
          canExport={canExportLeads}
          onExport={(rows) => downloadLeadsCsv(rows, sourceDialogLabel || String(sourceDialogKey || 'form-leads'))}
        />
      )}
      {!sourceDialogKey && (
      <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Form Leads</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {totalLeads} leads collected by sales reps
            {totalUnassignedCount > 0 && <span className="text-amber-600 font-medium"> · {totalUnassignedCount} unassigned</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Marketing: Add & Import */}
          {isMarketing && (
            <>
              <input type="file" ref={csvInputRef} accept=".csv" className="hidden" onChange={handleCsvSelect} />
              <Button size="sm" variant="ghost" className="gap-1.5 h-8 text-muted-foreground" onClick={() => {
                const csv = 'name,email,phone,college,source\nJohn Doe,john@example.com,9876543210,ABC College,google_ads\n';
                const blob = new Blob([csv], { type: 'text/csv' });
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'leads_template.csv'; a.click();
              }}>
                <Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">Template</span>
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => csvInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /><span className="hidden sm:inline">Import CSV</span>
              </Button>
              <Button size="sm" className="gap-1.5 h-8" onClick={() => setShowAddLead(true)}>
                <Plus className="h-3.5 w-3.5" /><span className="hidden sm:inline">Add Lead</span>
              </Button>
            </>
          )}
          {isManager && unassignedCount > 0 && (
            <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={handleBulkAutoAllocate}>
              <UserPlus className="h-3.5 w-3.5" /><span className="hidden sm:inline">Auto-Allocate</span>
            </Button>
          )}
          {canExportLeads && (
            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={openExportCardsDialog}>
              <Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">Export</span>
            </Button>
          )}
          {isManager && (
            <Button size="sm" variant="default" className="gap-1.5 h-8" onClick={() => setBulkAssignOpen(true)}>
              <Shuffle className="h-3.5 w-3.5" /><span className="hidden sm:inline">Bulk Assign</span>
            </Button>
          )}
          {isManager && (
            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => navigate('/leads/form-leads/history')}>
              <History className="h-3.5 w-3.5" /><span className="hidden sm:inline">History</span>
            </Button>
          )}
        </div>
      </div>


      {/* Employee Filter Pills */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
        <button onClick={() => { setEmployeeFilter('all'); setSearchParams({}); }} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${employeeFilter === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'}`}>
          All ({leads.length})
        </button>
        {profiles.map(p => {
          const count = leads.filter(l => l.referred_by === p.referral_code).length;
          if (count === 0) return null;
          return (
            <button key={p.user_id} onClick={() => { setEmployeeFilter(p.user_id); setSearchParams({ employee: p.user_id }); }} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${employeeFilter === p.user_id ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'}`}>
              {p.full_name || 'Unknown'} ({count})
            </button>
          );
        })}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mb-5">
        {[
          { label: 'Total Leads', value: filteredTotal, icon: FileText, color: 'text-blue-600', bg: 'bg-blue-500/10', sub: 'Collected' },
          { label: 'New', value: newLeads, icon: Clock, color: 'text-sky-600', bg: 'bg-sky-500/10', sub: 'Untouched' },
          { label: 'In Pipeline', value: inPipeline, icon: Target, color: 'text-amber-600', bg: 'bg-amber-500/10', sub: 'Active' },
          { label: 'Enroll', value: enrollLeads, icon: GraduationCap, color: 'text-teal-700', bg: 'bg-teal-500/10', sub: `${convRate}% won` },
          { label: 'Lost', value: lostLeads, icon: XCircle, color: 'text-red-600', bg: 'bg-red-500/10', sub: 'Dropped' },
        ].map(c => (
          <Card key={c.label} className="border-border/50 shadow-none">
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

      <div className="mb-2">
        <h2 className="text-sm font-semibold tracking-tight">Leads by form</h2>
        <p className="text-xs text-muted-foreground">Each form has its own card. Open a card to view, filter, and assign leads.</p>
      </div>
      {sourceSummaries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 rounded-lg border border-dashed border-border/60">
          <FileText className="h-12 w-12 text-muted-foreground/20 mb-4" />
          <p className="text-sm font-medium text-muted-foreground">No form leads yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-6">
          {sourceSummaries.map((summary) => {
            const statusChips = SOURCE_STATUS_CHIP_ORDER.filter((st) => (summary.byStatus[st] || 0) > 0);
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
                      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <FileText className="h-4 w-4 text-primary" />
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
      )}

      <Sheet open={detailOpen && !sourceDialogKey} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {detailLead && (
            <>
              <SheetHeader className="pb-4 border-b border-border">
                <SheetTitle className="text-lg">{detailLead.name}</SheetTitle>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {canEditLead(detailLead) ? (
                    <Select
                      value={detailLead.status === 'converted' ? 'enrolled' : detailLead.status}
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
                      <SelectContent className="z-[210]">
                        {LEAD_STATUSES.map((s) => (
                          <SelectItem key={s} value={s} className="capitalize">{formatLeadStatus(s)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline" className={`${statusColors[detailLead.status]} capitalize text-xs`}>{formatLeadStatus(detailLead.status)}</Badge>
                  )}
                  <Badge variant="secondary" className="text-xs capitalize">{SOURCE_LABELS[detailLead.source] || detailLead.source?.replace(/_/g, ' ')}</Badge>
                  <Badge variant="secondary" className="text-xs">Form Lead</Badge>
                </div>
              </SheetHeader>

              <div className="mt-5 space-y-5">
                {/* Contact Info */}
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Contact Information</h4>
                  <LeadContactBlock
                    email={detailLead.email}
                    phone={detailLead.phone}
                    notes={detailLead.notes}
                    variant="detail"
                  />
                  <div className="space-y-2.5 mt-2.5">
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
                    {detailLead.resume_path && (
                      <div className="flex items-center gap-3 pt-1">
                        <div className="h-8 w-8 rounded-lg bg-teal-500/10 flex items-center justify-center"><FileText className="h-4 w-4 text-teal-600" /></div>
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Resume</p>
                          <Button
                            variant="link"
                            className="h-auto p-0 text-teal-600 text-sm"
                            type="button"
                            onClick={() => {
                              void openProtectedUpload(detailLead.resume_path).catch(() => {});
                            }}
                          >
                              View file
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Collection & Assignment */}
                <div className="border-t border-border pt-4">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Collection & Assignment</h4>
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/5 border border-emerald-200/50">
                      <div><p className="text-xs text-emerald-600">Collected By</p><p className="text-sm font-medium">{codeToName[detailLead.referred_by] || detailLead.referred_by}</p></div>
                      <Badge variant="secondary" className="text-[10px] font-mono">{detailLead.referred_by}</Badge>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div><p className="text-xs text-muted-foreground">Assigned To</p><p className="text-sm font-medium">{formatAssignedLabel(detailLead)}</p></div>
                      {isManager && (getAssignRosterForLead(detailLead).length > 0 || !!user?.id) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-1 h-7 text-xs"><UserPlus className="h-3 w-3" />{detailLead.assigned_to ? 'Reassign' : 'Assign'}</Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {user?.id && (
                              <DropdownMenuItem
                                onClick={() => {
                                  handleAssignDirect(detailLead.id, user.id);
                                  setDetailLead({ ...detailLead, assigned_to: user.id });
                                }}
                              >
                                Assign to self
                              </DropdownMenuItem>
                            )}
                            {detailLead.referred_by && codeToUserId[detailLead.referred_by] && (
                              <DropdownMenuItem onClick={() => { handleAutoAllocate(detailLead.id); setDetailLead({ ...detailLead, assigned_to: codeToUserId[detailLead.referred_by] }); }} className="text-emerald-600 font-medium">
                                ↺ Auto: {codeToName[detailLead.referred_by]}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            {getAssignRosterForLead(detailLead)
                              .filter((m: any) => !user?.id || String(m.id) !== String(user.id))
                              .map((m: any) => (
                              <DropdownMenuItem key={m.id} onClick={() => { handleAssignDirect(detailLead.id, m.id); setDetailLead({ ...detailLead, assigned_to: m.id }); }}>
                                {m.full_name}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div><p className="text-xs text-muted-foreground">Submitted On</p><p className="text-sm font-medium">{new Date(detailLead.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p></div>
                    </div>
                  </div>
                </div>

                <FormSubmissionDetails notes={detailLead.notes} resumePath={detailLead.resume_path} />

                {/* Activity History */}
                <LeadActivityTimeline
                  leadId={detailLead.id}
                  getProfileName={(uid) => getAssignedName(uid) || userIdToName[uid] || 'Unknown'}
                />

                {/* Actions */}
                <div className="border-t border-border pt-4 flex gap-2">
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

      {/* Assign Lead Dialog — multi-member */}
      <Dialog open={assignOpen} onOpenChange={(open) => {
        if (!assignSaving) {
          setAssignOpen(open);
          if (!open) { setAssignLeadId(null); setAssignSelectedReps(new Set()); }
        }
      }}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" /> Assign Lead to Team Members
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
            {assignLeadId && leads.find(l => l.id === assignLeadId)?.referred_by && codeToUserId[leads.find(l => l.id === assignLeadId)?.referred_by || ''] && (
              <Button
                variant="outline"
                className="w-full justify-start gap-2 text-emerald-600 border-emerald-200"
                disabled={assignSaving}
                onClick={() => {
                  const code = leads.find(l => l.id === assignLeadId)?.referred_by || '';
                  const uid = codeToUserId[code];
                  if (uid) setAssignSelectedReps(new Set([uid]));
                }}
              >
                <UserPlus className="h-4 w-4" /> Select collector: {codeToName[leads.find(l => l.id === assignLeadId)?.referred_by || ''] || ''}
              </Button>
            )}
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
              <p className="text-sm text-muted-foreground text-center py-4">No assignees for this form yet</p>
            )}
          </div>
          {assignSelectedReps.size > 0 && (
            <p className="text-xs text-muted-foreground">{assignSelectedReps.size} member{assignSelectedReps.size > 1 ? 's' : ''} selected</p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setAssignOpen(false); setAssignLeadId(null); setAssignSelectedReps(new Set()); }} disabled={assignSaving}>Cancel</Button>
            <Button onClick={handleMultiAssign} disabled={assignSelectedReps.size === 0 || assignSaving} className="gap-1.5">
              {assignSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {assignSaving ? 'Saving...' : `Assign to ${assignSelectedReps.size}`}
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

      {/* Marketing: Add Lead Dialog */}
      {isMarketing && (
        <Dialog open={showAddLead} onOpenChange={(o) => { setShowAddLead(o); if (!o) setManualLeadResume(null); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Lead Manually</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label className="text-xs">Name *</Label><Input value={newLead.name} onChange={e => setNewLead(p => ({ ...p, name: e.target.value }))} placeholder="Full name" /></div>
              <div><Label className="text-xs">Email</Label><Input type="email" value={newLead.email} onChange={e => setNewLead(p => ({ ...p, email: e.target.value }))} placeholder="email@example.com" /></div>
              <div><Label className="text-xs">Phone</Label><Input value={newLead.phone} onChange={e => setNewLead(p => ({ ...p, phone: e.target.value }))} placeholder="+91 9876543210" /></div>
              <div><Label className="text-xs">College</Label><Input value={newLead.college} onChange={e => setNewLead(p => ({ ...p, college: e.target.value }))} placeholder="College / Institution" /></div>
              <div>
                <Label className="text-xs">Source</Label>
                <Select value={newLead.source} onValueChange={v => setNewLead(p => ({ ...p, source: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SOURCE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <ResumeUploadBox
                label="Resume"
                value={manualLeadResume ?? undefined}
                onChange={(f) => setManualLeadResume(f ?? null)}
                className="mb-1"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddLead(false)}>Cancel</Button>
              <Button onClick={handleAddLeadSubmit} disabled={addingLead} className="gap-1.5">
                {addingLead && <Loader2 className="h-4 w-4 animate-spin" />}Add Lead
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Marketing: Import CSV Dialog */}
      {isMarketing && (
        <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Import Leads from CSV</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{importPreview.length} leads found. They'll be linked to your referral code.</p>
              <div className="max-h-60 overflow-y-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0"><tr><th className="p-2 text-left">#</th><th className="p-2 text-left">Name</th><th className="p-2 text-left">Email</th><th className="p-2 text-left">Phone</th></tr></thead>
                  <tbody>
                    {importPreview.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t border-border"><td className="p-2 text-muted-foreground">{i+1}</td><td className="p-2 font-medium">{r.name}</td><td className="p-2 text-muted-foreground">{r.email||'—'}</td><td className="p-2 text-muted-foreground">{r.phone||'—'}</td></tr>
                    ))}
                  </tbody>
                </table>
                {importPreview.length > 50 && <p className="text-xs text-center text-muted-foreground py-2">... and {importPreview.length - 50} more</p>}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowImportDialog(false); setImportPreview([]); }}>Cancel</Button>
              <Button onClick={handleImportLeads} disabled={importingLeads} className="gap-1.5">
                {importingLeads && <Loader2 className="h-4 w-4 animate-spin" />}Import {importPreview.length} Leads
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <LeadEnrollDialog
        open={!!enrollLead}
        onOpenChange={(open) => {
          if (!open) setEnrollLead(null);
        }}
        lead={enrollLead}
        orgId={(enrollLead?.org_id ?? enrollLead?.organization_id ?? organization?.id) as string | undefined}
        onEnrolled={() => {
          setEnrollLead(null);
          void fetchData();
        }}
      />

      <Dialog open={exportCardsOpen} onOpenChange={setExportCardsOpen}>
        <DialogContent className="max-w-lg max-h-[min(90dvh,calc(100dvh-2rem))] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
            <DialogTitle>Export form leads by card</DialogTitle>
          </DialogHeader>
          <p className="px-6 text-xs text-muted-foreground pb-2">
            Select the form cards to include. Only leads from checked cards are exported.
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
