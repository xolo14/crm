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
import { resumePublicHref } from '@/lib/resumeHref';
import { FormSubmissionDetails } from '@/components/leads/FormSubmissionDetails';
import { LeadContactBlock } from '@/components/leads/LeadContactBlock';

const MARKETING_RESUME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

const LEAD_STATUSES = ['new', 'contacted', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'] as const;

const formatLeadStatus = (s?: string | null) => {
  if (!s) return '';
  if (s === 'enrolled' || s === 'converted') return 'Enroll';
  return s.replace(/_/g, ' ');
};

const statusBadgeKey = (s?: string | null) => (s === 'converted' ? 'enrolled' : s || '');

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

const SOURCE_LABELS: Record<string, string> = {
  google_ads: 'Google Ads', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube',
  website: 'Website', google_forms: 'Google Forms', whatsapp: 'WhatsApp', referral: 'Referral',
  walkin: 'Walk-in', college_seminar: 'College Seminar', other: 'Other',
};

const SALES_MEMBER_ROLES = new Set(['sales_representative']);
const isAssignableRole = (role?: string | null) => {
  const normalized = String(role || '').trim().toLowerCase();
  return SALES_MEMBER_ROLES.has(normalized) || normalized.startsWith('marketing');
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
  if (normalized.startsWith('marketing')) return 'Marketing';
  if (normalized === 'sales_representative') return 'Sales Representative';
  if (normalized === 'manager') return 'Manager';
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
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [enrollLead, setEnrollLead] = useState<any | null>(null);

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
  const hasExport = perms.canExport(role);
  const rl = String(role || '').trim().toLowerCase();
  const formLeadsAssignmentRoster =
    isManager || rl.startsWith('marketing') || rl === 'hr';

  useEffect(() => {
    fetchData();
    if (formLeadsAssignmentRoster) fetchTeam();
  }, [role, user?.id, profile?.referral_code]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [leadsData, profilesData] = await Promise.all([api.leads.list(), api.profiles.list()]);
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
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchTeam = async () => {
    try {
      const [teamRes, marketingRes] = await Promise.allSettled([
        api.team.list(),
        api.marketing.members(),
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

  const canEditLead = (lead: any) => hasEditAll || lead.assigned_to === user?.id;
  const canDeleteLead = () => hasDelete;

  const getAssignedName = (id: string) => {
    const member = teamMembers.find(m => m.id === id);
    if (member) return member.full_name;
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
  const groupedTeamMembers = useMemo(() => {
    const groups: Record<string, any[]> = {};
    teamMembers.forEach((member) => {
      const label = getRoleCategoryLabel(member.role);
      if (!groups[label]) groups[label] = [];
      groups[label].push(member);
    });
    return groups;
  }, [teamMembers]);

  // Reset page on filter change
  useEffect(() => { setCurrentPage(1); }, [search, statusFilter, sourceFilter, employeeFilter]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedLeads = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  // KPIs
  const totalLeads = leads.length;
  const filteredTotal = filtered.length;
  const newLeads = filtered.filter(l => l.status === 'new').length;
  const inPipeline = filtered.filter(l => ['interested', 'demo_scheduled', 'demo_attended'].includes(l.status)).length;
  const enrollLeads = filtered.filter(l => l.status === 'enrolled' || l.status === 'converted').length;
  const lostLeads = filtered.filter(l => l.status === 'lost').length;
  const unassignedCount = filtered.filter(l => !l.assigned_to).length;
  const totalUnassignedCount = leads.filter(l => !l.assigned_to).length;
  const convRate = filteredTotal > 0 ? Math.round((enrollLeads / filteredTotal) * 100) : 0;


  const updateStatus = async (id: string, status: string) => {
    try {
      await api.leads.update(id, { status });
      setLeads(prev => prev.map(l => l.id === id ? { ...l, status } : l));
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

  const handleAssign = async (repId: string) => {
    if (!assignLeadId) return;
    try {
      await api.leads.update(assignLeadId, { assigned_to: repId });
      const repName = getAssignedName(repId) || teamMembers.find(m => m.id === repId)?.full_name || 'Rep';
      const lead = leads.find(l => l.id === assignLeadId);
      setLeads(prev => prev.map(l => l.id === assignLeadId ? { ...l, assigned_to: repId } : l));
      toast({ title: `Lead assigned to ${repName}` });
      await sendNotificationWithEmail({
        userId: repId, title: 'New Lead Assigned',
        message: `Lead "${lead?.name || 'Unknown'}" has been assigned to you.`,
        type: 'lead_assigned', link: '/leads',
        leadName: lead?.name || 'Unknown', assignedByName: profile?.full_name || 'Manager',
      });
      setAssignOpen(false); setAssignLeadId(null);
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
  };

  const handleBulkAssign = async (repId: string) => {
    const names: string[] = [];
    for (const id of selectedIds) {
      try { await api.leads.update(id, { assigned_to: repId }); const l = leads.find(x => x.id === id); if (l) names.push(l.name); } catch {}
    }
    fetchData();
    const repName = getAssignedName(repId) || teamMembers.find(m => m.id === repId)?.full_name || 'Rep';
    toast({ title: `${selectedIds.size} leads assigned to ${repName}` });
    await sendNotificationWithEmail({
      userId: repId, title: `${selectedIds.size} Leads Assigned`,
      message: `You have been assigned ${selectedIds.size} new leads: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '...' : ''}.`,
      type: 'lead_assigned', link: '/leads',
      leadName: names.slice(0, 3).join(', '), assignedByName: profile?.full_name || 'Manager',
    });
    setSelectedIds(new Set());
  };

  const handleAutoAllocate = async (leadId: string) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead?.referred_by) return;
    const repId = codeToUserId[lead.referred_by];
    if (!repId) { toast({ variant: 'destructive', title: 'Collector not found' }); return; }
    setAssignLeadId(leadId);
    await handleAssignDirect(leadId, repId);
  };

  const handleAssignDirect = async (leadId: string, repId: string) => {
    try {
      await api.leads.update(leadId, { assigned_to: repId });
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
    for (const lead of unassigned) {
      try { await api.leads.update(lead.id, { assigned_to: codeToUserId[lead.referred_by] }); count++; } catch {}
    }
    fetchData();
    toast({ title: `${count} leads auto-allocated to their collectors` });
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
      fetchData();
      toast({ title: `${totalAssigned} leads distributed across ${repIds.length} reps` });
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

  const handleExport = () => {
    const headers = ['S.No', 'Name', 'Email', 'Phone', 'College', 'Source', 'Status', 'Collected By', 'Assigned To', 'Created'];
    const rows = filtered.map((l, i) => [i + 1, l.name, l.email, l.phone, l.college, l.source, l.status, codeToName[l.referred_by] || l.referred_by, getAssignedName(l.assigned_to), l.created_at]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v || ''}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `form-leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Form leads exported successfully' });
  };

  const openDetail = (lead: any) => { setDetailLead(lead); setDetailOpen(true); };

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
        referred_by: refCode, status: 'new' as const,
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

  return (
    <div>
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
          {hasExport && (
            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={handleExport}>
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
          <Card key={c.label} className="border-border/50 shadow-none hover:shadow-md transition-shadow cursor-pointer" onClick={() => {
            if (c.label === 'New') setStatusFilter('new');
            else if (c.label === 'Enroll') setStatusFilter('enrolled');
            else if (c.label === 'Lost') setStatusFilter('lost');
            else setStatusFilter('all');
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
              {Object.entries(SOURCE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Active Filters */}
      {(statusFilter !== 'all' || sourceFilter !== 'all' || search) && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs text-muted-foreground">Filters:</span>
          {statusFilter !== 'all' && <Badge variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => setStatusFilter('all')}>Status: {formatLeadStatus(statusFilter)} <XCircle className="h-3 w-3" /></Badge>}
          {sourceFilter !== 'all' && <Badge variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => setSourceFilter('all')}>Source: {SOURCE_LABELS[sourceFilter]} <XCircle className="h-3 w-3" /></Badge>}
          {search && <Badge variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => setSearch('')}>Search: "{search}" <XCircle className="h-3 w-3" /></Badge>}
          <button onClick={() => { setStatusFilter('all'); setSourceFilter('all'); setSearch(''); }} className="text-xs text-primary hover:underline">Clear all</button>
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
          {hasBulkDelete && <Button size="sm" variant="destructive" className="h-7 gap-1" onClick={handleBulkDelete}><Trash2 className="h-3 w-3" />Delete</Button>}
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
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <Card className="border-border/50 shadow-none"><CardContent className="py-12 text-center"><FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" /><p className="text-sm text-muted-foreground">No form leads found</p><p className="text-xs text-muted-foreground mt-1">Try adjusting your filters</p></CardContent></Card>
          ) : paginatedLeads.map((lead, i) => (
            <Card key={lead.id} className="border-border/50 shadow-none hover:shadow-sm transition-shadow cursor-pointer" onClick={() => openDetail(lead)}>
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground font-mono">#{i + 1}</span>
                      <p className="font-medium text-sm truncate">{lead.name}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{lead.college || lead.company || '—'}</p>
                    <div className="mt-1.5">
                      <LeadContactBlock email={lead.email} phone={lead.phone} notes={lead.notes} variant="table" />
                    </div>
                    <p className="text-[10px] text-emerald-600 font-medium mt-1">Collected: {codeToName[lead.referred_by] || lead.referred_by}</p>
                    {lead.assigned_to ? (
                      <p className="text-[10px] text-primary font-medium">Assigned: {getAssignedName(lead.assigned_to)}</p>
                    ) : (
                      <p className="text-[10px] text-amber-600 font-medium">⚠ Unassigned</p>
                    )}
                    {lead.resume_path ? (
                      <a href={resumePublicHref(lead.resume_path)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-teal-600 font-medium mt-1" onClick={(e) => e.stopPropagation()}>
                        <FileText className="h-3 w-3" /> Resume
                      </a>
                    ) : (
                      <span className="text-[10px] text-muted-foreground mt-1 block">Resume —</span>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {canEditLead(lead) ? (
                      <Select
                        value={lead.status === 'converted' ? 'enrolled' : lead.status}
                        onValueChange={(v: string) => {
                          if (v) onLeadStatusSelect(lead, v);
                        }}
                      >
                        <SelectTrigger className="h-6 w-auto border-0 p-0" onClick={(e) => e.stopPropagation()}>
                          <Badge variant="outline" className={`${statusColors[statusBadgeKey(lead.status)]} capitalize text-[10px]`}>{formatLeadStatus(lead.status)}</Badge>
                        </SelectTrigger>
                        <SelectContent>
                          {LEAD_STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{formatLeadStatus(s)}</SelectItem>)}
                          {lead.status === 'considering' && <SelectItem value="considering" className="capitalize">Considering</SelectItem>}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline" className={`${statusColors[statusBadgeKey(lead.status)]} capitalize text-[10px]`}>{formatLeadStatus(lead.status)}</Badge>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openDetail(lead); }}><Eye className="h-4 w-4 mr-2" /> View Details</DropdownMenuItem>
                        {isManager && teamMembers.length > 0 && (
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setAssignLeadId(lead.id); setAssignOpen(true); }}><UserPlus className="h-4 w-4 mr-2" /> Assign</DropdownMenuItem>
                        )}
                        {isManager && lead.referred_by && codeToUserId[lead.referred_by] && (
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleAutoAllocate(lead.id); }} className="text-emerald-600"><UserPlus className="h-4 w-4 mr-2" /> Auto: {codeToName[lead.referred_by]}</DropdownMenuItem>
                        )}
                        {canDeleteLead() && <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); handleDelete(lead.id); }}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem></>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="secondary" className="text-[10px] capitalize">{SOURCE_LABELS[lead.source] || lead.source?.replace(/_/g, ' ')}</Badge>
                  <span className="text-[10px] text-muted-foreground">{new Date(lead.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </Card>
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
                <TableHead>Collected By</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Resume</TableHead>
                {isManager && <TableHead>Assigned To</TableHead>}
                <TableHead>Created</TableHead>
                {isManager && <TableHead className="w-24">Action</TableHead>}
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={isManager ? 12 : 10} className="text-center py-12">
                  <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No form leads found</p>
                  <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters</p>
                </TableCell></TableRow>
              ) : paginatedLeads.map((lead: any, index: number) => (
                <TableRow key={lead.id} className={`cursor-pointer transition-colors ${selectedIds.has(lead.id) ? 'bg-primary/5' : 'hover:bg-muted/50'}`} onClick={() => openDetail(lead)}>
                  {hasBulkDelete && <TableCell onClick={(e) => e.stopPropagation()}><Checkbox checked={selectedIds.has(lead.id)} onCheckedChange={() => toggleSelect(lead.id)} /></TableCell>}
                  <TableCell className="text-muted-foreground text-xs font-mono">{(currentPage - 1) * pageSize + index + 1}</TableCell>
                  <TableCell>
                    <div><p className="font-medium text-sm">{lead.name}</p><p className="text-xs text-muted-foreground">{lead.college || lead.company || ''}</p></div>
                  </TableCell>
                  <TableCell>
                    <LeadContactBlock email={lead.email} phone={lead.phone} notes={lead.notes} variant="table" />
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium text-emerald-600">{codeToName[lead.referred_by] || lead.referred_by}</span>
                  </TableCell>
                  <TableCell><Badge variant="secondary" className="text-xs capitalize">{SOURCE_LABELS[lead.source] || lead.source?.replace(/_/g, ' ')}</Badge></TableCell>
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
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {lead.resume_path ? (
                      <Button variant="ghost" size="sm" className="gap-1 h-7 text-xs text-teal-600 px-2" asChild>
                        <a href={resumePublicHref(lead.resume_path)} target="_blank" rel="noopener noreferrer">
                          <FileText className="h-3 w-3.5" /> View
                        </a>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {isManager && (
                    <TableCell>
                      {lead.assigned_to ? (
                        <span className="text-sm font-medium">{getAssignedName(lead.assigned_to)}</span>
                      ) : (
                        <span className="text-xs text-amber-600 font-medium">Unassigned</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-sm text-muted-foreground">{new Date(lead.created_at).toLocaleDateString()}</TableCell>
                  {isManager && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-1 h-7 text-xs">
                            <UserPlus className="h-3 w-3" />
                            {lead.assigned_to ? 'Reassign' : 'Assign'}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {lead.referred_by && codeToUserId[lead.referred_by] && (
                            <DropdownMenuItem onClick={() => handleAutoAllocate(lead.id)} className="text-emerald-600 font-medium">
                              ↺ Auto: {codeToName[lead.referred_by]}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {Object.entries(groupedTeamMembers).map(([group, members], idx) => (
                            <div key={group}>
                              {idx > 0 && <DropdownMenuSeparator />}
                              <DropdownMenuLabel>{group}</DropdownMenuLabel>
                              {members.map((m: any) => (
                                <DropdownMenuItem key={m.id} onClick={() => handleAssignDirect(lead.id, m.id)}>
                                  {m.full_name}
                                </DropdownMenuItem>
                              ))}
                            </div>
                          ))}
                          {teamMembers.length === 0 && <DropdownMenuItem disabled>No reps available</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openDetail(lead)}><Eye className="h-4 w-4 mr-2" /> View Details</DropdownMenuItem>
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

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {detailLead && (
            <>
              <SheetHeader className="pb-4 border-b border-border">
                <SheetTitle className="text-lg">{detailLead.name}</SheetTitle>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge variant="outline" className={`${statusColors[detailLead.status]} capitalize text-xs`}>{formatLeadStatus(detailLead.status)}</Badge>
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
                          <Button variant="link" className="h-auto p-0 text-teal-600 text-sm" asChild>
                            <a href={resumePublicHref(detailLead.resume_path)} target="_blank" rel="noopener noreferrer">
                              View file
                            </a>
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
                      <div><p className="text-xs text-muted-foreground">Assigned To</p><p className="text-sm font-medium">{getAssignedName(detailLead.assigned_to) || 'Unassigned'}</p></div>
                      {isManager && teamMembers.length > 0 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-1 h-7 text-xs"><UserPlus className="h-3 w-3" />{detailLead.assigned_to ? 'Reassign' : 'Assign'}</Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {detailLead.referred_by && codeToUserId[detailLead.referred_by] && (
                              <DropdownMenuItem onClick={() => { handleAutoAllocate(detailLead.id); setDetailLead({ ...detailLead, assigned_to: codeToUserId[detailLead.referred_by] }); }} className="text-emerald-600 font-medium">
                                ↺ Auto: {codeToName[detailLead.referred_by]}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            {teamMembers.map(m => (
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

      {/* Assign Lead Dialog */}
      <Dialog open={assignOpen} onOpenChange={(open) => { setAssignOpen(open); if (!open) setAssignLeadId(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm">
          <DialogHeader><DialogTitle>Assign Lead to Team Member</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            {assignLeadId && leads.find(l => l.id === assignLeadId)?.referred_by && codeToUserId[leads.find(l => l.id === assignLeadId)?.referred_by] && (
              <Button variant="outline" className="w-full justify-start gap-2 text-emerald-600 border-emerald-200" onClick={() => handleAutoAllocate(assignLeadId)}>
                <UserPlus className="h-4 w-4" /> ↺ Auto: {codeToName[leads.find(l => l.id === assignLeadId)?.referred_by || '']}
              </Button>
            )}
            {Object.entries(groupedTeamMembers).map(([group, members]) => (
              <div key={group} className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">{group}</p>
                {members.map((m: any) => (
                  <Button key={m.id} variant="outline" className="w-full justify-start gap-2" onClick={() => handleAssign(m.id)}>
                    <UserPlus className="h-4 w-4" /> {m.full_name}
                  </Button>
                ))}
              </div>
            ))}
          </div>
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
    </div>
  );
}
