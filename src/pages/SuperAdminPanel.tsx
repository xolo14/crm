import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Building2, Users, TrendingUp, IndianRupee, Plus, Settings, Eye, Loader2, BarChart3, Shield, Globe, GraduationCap, Monitor, KeyRound } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';

// Industry-specific feature sections
const INDUSTRY_PRESETS: Record<string, {
  label: string;
  icon: typeof Globe;
  color: string;
  bg: string;
  description: string;
  sections: { title: string; features: { key: string; label: string; description: string }[] }[];
}> = {
  abroad_consultant: {
    label: 'Abroad Consultant',
    icon: Globe,
    color: 'text-blue-600',
    bg: 'bg-blue-500/10 border-blue-200',
    description: 'Study abroad, visa consulting, immigration services',
    sections: [
      {
        title: 'Core CRM',
        features: [
          { key: 'leads', label: 'Leads Management', description: 'Track & manage student inquiries' },
          { key: 'contacts', label: 'Contacts', description: 'Manage student & parent contacts' },
          { key: 'tasks', label: 'Tasks', description: 'Follow-up tasks & reminders' },
          { key: 'notifications', label: 'Notifications', description: 'Real-time alerts & updates' },
        ],
      },
      {
        title: 'Student Management',
        features: [
          { key: 'students', label: 'Student Profiles', description: 'Manage enrolled students' },
          { key: 'courses', label: 'Courses / Programs', description: 'University programs & courses' },
          { key: 'batches', label: 'Batches / Intakes', description: 'Intake seasons & batches' },
        ],
      },
      {
        title: 'Visa & Applications',
        features: [
          { key: 'deals', label: 'Application Pipeline', description: 'Track visa & admission stages' },
          { key: 'visa_tracking', label: 'Visa Tracking', description: 'Track visa application status' },
          { key: 'document_checklist', label: 'Document Checklist', description: 'Required documents tracker' },
        ],
      },
      {
        title: 'Finance & Reports',
        features: [
          { key: 'payments', label: 'Payments', description: 'Service fees & installments' },
          { key: 'daily_reports', label: 'Daily Reports', description: 'Team daily activity reports' },
        ],
      },
      {
        title: 'Portals & Access',
        features: [
          { key: 'marketing_access', label: 'Marketing Portal', description: 'Enable marketing portal for this org. Admin can create marketing accounts.' },
          { key: 'certificates', label: 'Certificates', description: 'Enable certificates module for this organization.' },
          { key: 'offer_letters', label: 'Offer Letters', description: 'Offer letter templates and sending. Off by default; enable per organization.' },
          { key: 'fresher_salary', label: 'Fresher Salary Tracker', description: 'Sales fresher salary evaluation. Off by default; enable per organization.' },
        ],
      },
    ],
  },
  edutech: {
    label: 'EdTech',
    icon: GraduationCap,
    color: 'text-emerald-600',
    bg: 'bg-emerald-500/10 border-emerald-200',
    description: 'Online courses, training institutes, coaching centers',
    sections: [
      {
        title: 'Core CRM',
        features: [
          { key: 'leads', label: 'Leads Management', description: 'Capture & nurture student leads' },
          { key: 'contacts', label: 'Contacts', description: 'Student & parent directory' },
          { key: 'tasks', label: 'Tasks', description: 'Team task management' },
          { key: 'notifications', label: 'Notifications', description: 'Push notifications & alerts' },
        ],
      },
      {
        title: 'Learning Management',
        features: [
          { key: 'students', label: 'Student Profiles', description: 'Track enrolled learners' },
          { key: 'courses', label: 'Course Catalog', description: 'Manage courses & curriculum' },
          { key: 'batches', label: 'Batch Management', description: 'Cohorts, schedules & trainers' },
          { key: 'lms_integration', label: 'LMS Integration', description: 'Learning platform connection' },
        ],
      },
      {
        title: 'Sales Pipeline',
        features: [
          { key: 'deals', label: 'Deals Pipeline', description: 'Track enrollment conversions' },
          { key: 'referral_system', label: 'Referral System', description: 'Student referral tracking' },
          { key: 'demo_scheduling', label: 'Demo Scheduling', description: 'Schedule free demo classes' },
        ],
      },
      {
        title: 'Finance & Reports',
        features: [
          { key: 'payments', label: 'Payments & EMI', description: 'Fee collection & installments' },
          { key: 'daily_reports', label: 'Daily Reports', description: 'Team performance tracking' },
        ],
      },
      {
        title: 'Portals & Access',
        features: [
          { key: 'marketing_access', label: 'Marketing Portal', description: 'Enable marketing portal for this org. Admin can create marketing accounts.' },
          { key: 'certificates', label: 'Certificates', description: 'Enable certificates module for this organization.' },
          { key: 'offer_letters', label: 'Offer Letters', description: 'Offer letter templates and sending. Off by default; enable per organization.' },
          { key: 'fresher_salary', label: 'Fresher Salary Tracker', description: 'Sales fresher salary evaluation. Off by default; enable per organization.' },
        ],
      },
    ],
  },
  it_services: {
    label: 'IT Services',
    icon: Monitor,
    color: 'text-purple-600',
    bg: 'bg-purple-500/10 border-purple-200',
    description: 'Software companies, IT staffing, tech consulting',
    sections: [
      {
        title: 'Core CRM',
        features: [
          { key: 'leads', label: 'Leads Management', description: 'Track client inquiries' },
          { key: 'contacts', label: 'Contacts', description: 'Client & vendor directory' },
          { key: 'tasks', label: 'Tasks', description: 'Project tasks & follow-ups' },
          { key: 'notifications', label: 'Notifications', description: 'Alerts & reminders' },
        ],
      },
      {
        title: 'Project & Deals',
        features: [
          { key: 'deals', label: 'Deals Pipeline', description: 'Track project proposals & deals' },
          { key: 'project_tracking', label: 'Project Tracking', description: 'Active project management' },
          { key: 'client_portal', label: 'Client Portal', description: 'Client self-service access' },
        ],
      },
      {
        title: 'Talent & Training',
        features: [
          { key: 'students', label: 'Candidates / Trainees', description: 'Manage IT trainees' },
          { key: 'courses', label: 'Training Programs', description: 'Tech courses & certifications' },
          { key: 'batches', label: 'Training Batches', description: 'Cohort-based training' },
        ],
      },
      {
        title: 'Finance & Reports',
        features: [
          { key: 'payments', label: 'Invoicing & Payments', description: 'Client billing & payments' },
          { key: 'daily_reports', label: 'Daily Reports', description: 'Developer activity logs' },
        ],
      },
      {
        title: 'Portals & Access',
        features: [
          { key: 'marketing_access', label: 'Marketing Portal', description: 'Enable marketing portal for this org. Admin can create marketing accounts.' },
          { key: 'certificates', label: 'Certificates', description: 'Enable certificates module for this organization.' },
          { key: 'offer_letters', label: 'Offer Letters', description: 'Offer letter templates and sending. Off by default; enable per organization.' },
          { key: 'fresher_salary', label: 'Fresher Salary Tracker', description: 'Sales fresher salary evaluation. Off by default; enable per organization.' },
        ],
      },
    ],
  },
};

// Flatten all unique feature keys across all presets
const ALL_FEATURE_KEYS = Array.from(
  new Set(
    Object.values(INDUSTRY_PRESETS).flatMap(p =>
      p.sections.flatMap(s => s.features.map(f => f.key))
    )
  )
);

export default function SuperAdminPanel() {
  const { role, switchOrg } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showFeatures, setShowFeatures] = useState<string | null>(null);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [statusUpdatingOrgId, setStatusUpdatingOrgId] = useState<string | null>(null);
  const [deletingOrgId, setDeletingOrgId] = useState<string | null>(null);
  const [deleteConfirmOrg, setDeleteConfirmOrg] = useState<any | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [viewOrg, setViewOrg] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const [selectedIndustry, setSelectedIndustry] = useState<string>('');
  const [createFeatures, setCreateFeatures] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({
    name: '', slug: '', plan: 'starter', max_users: '10',
    admin_name: '', admin_email: '', admin_password: 'Welcome@123',
  });
  const [createAdminAccount, setCreateAdminAccount] = useState(true);
  const [provisionOrg, setProvisionOrg] = useState<any | null>(null);
  const [provisionForm, setProvisionForm] = useState({ admin_name: '', admin_email: '', admin_password: 'Welcome@123' });
  const [provisioning, setProvisioning] = useState(false);
  const [syncPlatformSalesLoading, setSyncPlatformSalesLoading] = useState(false);

  useEffect(() => {
    if (role !== 'super_admin') { navigate('/'); return; }
    fetchOrgs();
  }, [role]);

  useEffect(() => {
    if (searchParams.get('create') === '1') {
      setShowCreate(true);
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const fetchOrgs = async () => {
    setLoading(true);
    try {
      const data = await api.organizations.stats();
      const rows = data.data || [];
      setOrgs(
        rows.map((o: any) => ({
          ...o,
          is_active: o?.is_active === true || o?.is_active === 1 || o?.is_active === '1',
        }))
      );
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
    finally { setLoading(false); }
  };

  const selectIndustry = (key: string) => {
    setSelectedIndustry(key);
    const preset = INDUSTRY_PRESETS[key];
    if (!preset) return;
    const feats: Record<string, boolean> = {};
    // Enable all features from this preset by default
    preset.sections.forEach(s => s.features.forEach(f => { feats[f.key] = f.key === 'certificates' ? false : true; }));
    setCreateFeatures(feats);
  };

  const handleCreate = async () => {
    if (!form.name || !form.slug) { toast({ variant: 'destructive', title: 'Name and slug required' }); return; }
    if (!selectedIndustry) { toast({ variant: 'destructive', title: 'Please select an industry type' }); return; }
    if (createAdminAccount && (!form.admin_name.trim() || !form.admin_email.trim())) {
      toast({ variant: 'destructive', title: 'Admin name and email required', description: 'Turn off “Create org admin login” if you want to add credentials later from the org row.' });
      return;
    }
    setCreating(true);
    try {
      const data = await api.organizations.create({
        ...form,
        create_admin: createAdminAccount,
        max_users: parseInt(form.max_users) || 10,
        industry: selectedIndustry,
        features: createFeatures,
      }) as { email_sent?: boolean; email_error?: string };
      if (data?.email_sent) {
        toast({ title: 'Organization created!', description: 'Admin welcome email sent with login credentials.' });
      } else if (data?.email_error) {
        toast({
          variant: 'destructive',
          title: 'Organization created',
          description: `Admin welcome email failed: ${data.email_error}`,
        });
      } else {
        toast({ title: 'Organization created!' });
      }
      setShowCreate(false);
      setForm({ name: '', slug: '', plan: 'starter', max_users: '10', admin_name: '', admin_email: '', admin_password: 'Welcome@123' });
      setCreateAdminAccount(true);
      setSelectedIndustry('');
      setCreateFeatures({});
      fetchOrgs();
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
    finally { setCreating(false); }
  };

  const handleSwitchToOrg = async (orgId: string) => {
    try {
      await switchOrg(orgId);
      toast({ title: 'Switched to organization view' });
      navigate('/org-crm');
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
  };

  const openOrgView = (org: any) => {
    setViewOrg(org);
  };

  const openProvisionAdmin = (org: any) => {
    setProvisionOrg(org);
    setProvisionForm({ admin_name: '', admin_email: '', admin_password: 'Welcome@123' });
  };

  const handleSyncPlatformSales = async () => {
    setSyncPlatformSalesLoading(true);
    try {
      const res = await api.organizations.syncPlatformSales();
      toast({
        title: 'Org IDs synced',
        description: `Set Syncpedia org on ${res.users_updated ?? 0} accounts that had no org; ${res.lead_form_assignment_operations ?? 0} lead-form assignment writes for sales roles.`,
      });
      fetchOrgs();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Sync failed', description: err.message });
    } finally {
      setSyncPlatformSalesLoading(false);
    }
  };

  const handleProvisionAdmin = async () => {
    if (!provisionOrg) return;
    if (!provisionForm.admin_name.trim() || !provisionForm.admin_email.trim()) {
      toast({ variant: 'destructive', title: 'Name and email required' });
      return;
    }
    if (provisionForm.admin_password.length < 6) {
      toast({ variant: 'destructive', title: 'Password too short', description: 'Use at least 6 characters.' });
      return;
    }
    setProvisioning(true);
    try {
      await api.organizations.provisionAdmin({
        org_id: provisionOrg.id,
        admin_name: provisionForm.admin_name.trim(),
        admin_email: provisionForm.admin_email.trim(),
        admin_password: provisionForm.admin_password,
      });
      toast({ title: 'Admin credentials saved', description: `${provisionForm.admin_email} can sign in at Admin Portal (/admin).` });
      setProvisionOrg(null);
      fetchOrgs();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setProvisioning(false);
    }
  };

  const handleBackToMaster = async () => {
    try {
      await switchOrg(null as any);
      toast({ title: 'Back to master view' });
      fetchOrgs();
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
  };

  const openFeatures = async (orgId: string) => {
    try {
      const data = await api.organizations.features(orgId);
      const map: Record<string, boolean> = {};
      ALL_FEATURE_KEYS.forEach(k => { map[k] = false; });
      (data.data || []).forEach((f: any) => { map[f.feature] = !!f.enabled; });
      setFeatures(map);
      setShowFeatures(orgId);
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
  };

  const saveFeatures = async () => {
    if (!showFeatures) return;
    try {
      await api.organizations.updateFeatures(showFeatures, features);
      toast({ title: 'Features updated' });
      setShowFeatures(null);
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
  };

  const toggleOrgStatus = async (org: any) => {
    const currentlyActive = org?.is_active === true || org?.is_active === 1 || org?.is_active === '1';
    const nextActive = currentlyActive ? 0 : 1;
    setStatusUpdatingOrgId(org.id);
    try {
      await api.organizations.update(org.id, { is_active: nextActive });
      // Optimistic UI update for immediate feedback.
      setOrgs((prev) =>
        prev.map((o) =>
          o.id === org.id
            ? { ...o, is_active: nextActive === 1 }
            : o
        )
      );
      toast({ title: currentlyActive ? 'Organization deactivated' : 'Organization activated' });
      // Re-sync from server after a short delay.
      setTimeout(() => { fetchOrgs(); }, 700);
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
    finally { setStatusUpdatingOrgId(null); }
  };

  const fmt = (v: number) => v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(1)}K` : `₹${v}`;

  const totals = orgs.reduce((acc, o) => ({
    users: acc.users + (parseInt(o.user_count) || 0),
    leads: acc.leads + (parseInt(o.leads_count) || 0),
    students: acc.students + (parseInt(o.students_count) || 0),
    revenue: acc.revenue + (parseFloat(o.revenue) || 0),
  }), { users: 0, leads: 0, students: 0, revenue: 0 });
  const activeCount = orgs.filter((o) => !!o.is_active).length;
  const disabledCount = orgs.filter((o) => !o.is_active).length;
  const filteredOrgs = orgs.filter((o) => {
    if (statusFilter === 'active') return !!o.is_active;
    if (statusFilter === 'disabled') return !o.is_active;
    return true;
  });

  const requestDeleteOrg = (org: any) => {
    setDeleteConfirmOrg(org);
    setDeleteConfirmText('');
  };

  const handleDeleteOrg = async () => {
    if (!deleteConfirmOrg) return;
    setDeletingOrgId(deleteConfirmOrg.id);
    try {
      await api.organizations.delete(deleteConfirmOrg.id);
      toast({ title: 'Organization deleted' });
      setDeleteConfirmOrg(null);
      setDeleteConfirmText('');
      fetchOrgs();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setDeletingOrgId(null);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  const currentPreset = selectedIndustry ? INDUSTRY_PRESETS[selectedIndustry] : null;

  // Get the industry preset for a given org (for features dialog)
  const getOrgIndustryPreset = () => {
    // We show all features grouped by all industries in the edit dialog
    return Object.values(INDUSTRY_PRESETS);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-200 text-xs"><Shield className="h-3 w-3 mr-1" />Super Admin</Badge>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight mt-1">Control Panel</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {orgs.length} organizations · {activeCount} active · {disabledCount} disabled
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleBackToMaster} className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" />All Organizations</Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={syncPlatformSalesLoading}
            onClick={handleSyncPlatformSales}
            title="Sets every user with NULL org_id to the Syncpedia organization."
          >
            {syncPlatformSalesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
            Sync platform sales
          </Button>
          <Dialog open={showCreate} onOpenChange={(open) => { setShowCreate(open); if (!open) { setSelectedIndustry(''); setCreateFeatures({}); } }}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" />Add Organization</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Create New Organization</DialogTitle></DialogHeader>
              <div className="space-y-5">
                {/* Step 1: Industry Type Selection */}
                <div>
                  <Label className="text-sm font-semibold mb-3 block">Select Industry Type *</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {Object.entries(INDUSTRY_PRESETS).map(([key, preset]) => {
                      const Icon = preset.icon;
                      const isSelected = selectedIndustry === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => selectIndustry(key)}
                          className={`relative p-4 rounded-xl border-2 text-left transition-all hover:shadow-md ${
                            isSelected
                              ? `${preset.bg} border-current shadow-md ring-2 ring-offset-2 ring-current`
                              : 'border-border/50 hover:border-border'
                          }`}
                        >
                          <div className={`h-10 w-10 rounded-lg ${preset.bg.split(' ')[0]} flex items-center justify-center mb-2.5`}>
                            <Icon className={`h-5 w-5 ${preset.color}`} />
                          </div>
                          <p className={`text-sm font-bold ${isSelected ? preset.color : 'text-foreground'}`}>{preset.label}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{preset.description}</p>
                          {isSelected && (
                            <div className={`absolute top-2 right-2 h-5 w-5 rounded-full ${preset.bg.split(' ')[0]} flex items-center justify-center`}>
                              <svg className={`h-3 w-3 ${preset.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Step 2: Org Details */}
                <div className="border-t pt-4">
                  <Label className="text-sm font-semibold mb-3 block">Organization Details</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-') }))} placeholder="Acme Consulting" className="h-10" /></div>
                    <div><Label className="text-xs">Slug *</Label><Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="acme-consulting" className="h-10 font-mono text-xs" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <Label className="text-xs">Plan</Label>
                      <Select value={form.plan} onValueChange={v => setForm(f => ({ ...f, plan: v }))}>
                        <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="free">Free</SelectItem>
                          <SelectItem value="starter">Starter</SelectItem>
                          <SelectItem value="pro">Pro</SelectItem>
                          <SelectItem value="enterprise">Enterprise</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label className="text-xs">Max Users</Label><Input type="number" value={form.max_users} onChange={e => setForm(f => ({ ...f, max_users: e.target.value }))} className="h-10" /></div>
                  </div>
                </div>

                {/* Step 3: Feature Checkboxes (visible after industry selected) */}
                {currentPreset && (
                  <div className="border-t pt-4">
                    <div className="flex items-center gap-2 mb-4">
                      <currentPreset.icon className={`h-4 w-4 ${currentPreset.color}`} />
                      <Label className="text-sm font-semibold">{currentPreset.label} Features</Label>
                      <Badge variant="outline" className="text-[10px] ml-auto">
                        {Object.values(createFeatures).filter(Boolean).length} selected
                      </Badge>
                    </div>
                    <div className="space-y-5">
                      {currentPreset.sections.map(section => (
                        <div key={section.title} className="space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{section.title}</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {section.features.map(feat => (
                              <label
                                key={feat.key}
                                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all hover:bg-accent/50 ${
                                  createFeatures[feat.key] ? 'border-primary/30 bg-primary/5' : 'border-border/50'
                                }`}
                              >
                                <Checkbox
                                  checked={createFeatures[feat.key] ?? false}
                                  onCheckedChange={(checked) =>
                                    setCreateFeatures(prev => ({ ...prev, [feat.key]: !!checked }))
                                  }
                                  className="mt-0.5"
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium leading-none">{feat.label}</p>
                                  <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{feat.description}</p>
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step 4: Admin Account */}
                <div className="border-t pt-4">
                  <div className="flex items-start gap-3 mb-3">
                    <Checkbox id="create-org-admin" checked={createAdminAccount} onCheckedChange={v => setCreateAdminAccount(!!v)} className="mt-1" />
                    <div>
                      <Label htmlFor="create-org-admin" className="text-sm font-semibold cursor-pointer">Create org admin login</Label>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-snug">Each organization has exactly one admin account. They sign in at the Admin Portal (<span className="font-mono text-[10px]">/admin</span>) and can add managers, sales reps, and marketing users when those features are enabled.</p>
                    </div>
                  </div>
                  {createAdminAccount && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div><Label className="text-xs">Admin Name *</Label><Input value={form.admin_name} onChange={e => setForm(f => ({ ...f, admin_name: e.target.value }))} placeholder="John Doe" className="h-10" /></div>
                        <div><Label className="text-xs">Admin Email *</Label><Input type="email" value={form.admin_email} onChange={e => setForm(f => ({ ...f, admin_email: e.target.value }))} placeholder="admin@acme.com" className="h-10" /></div>
                      </div>
                      <div className="mt-3"><Label className="text-xs">Initial Password</Label><Input value={form.admin_password} onChange={e => setForm(f => ({ ...f, admin_password: e.target.value }))} className="h-10" /></div>
                    </>
                  )}
                </div>
              </div>
              <DialogFooter className="mt-4">
                <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                <Button onClick={handleCreate} disabled={creating}>{creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create Organization</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5">
        {[
          { label: 'Organizations', value: orgs.length, icon: Building2, ic: 'text-blue-600', bg: 'bg-blue-500/10' },
          { label: 'Total Users', value: totals.users, icon: Users, ic: 'text-emerald-600', bg: 'bg-emerald-500/10' },
          { label: 'Total Leads', value: totals.leads, icon: TrendingUp, ic: 'text-amber-600', bg: 'bg-amber-500/10' },
          { label: 'Total Revenue', value: fmt(totals.revenue), icon: IndianRupee, ic: 'text-green-600', bg: 'bg-green-500/10' },
        ].map(c => (
          <Card key={c.label} className="border-border/50 shadow-none hover:shadow-md transition-shadow">
            <CardContent className="pt-3 pb-2.5 px-3">
              <div className="flex items-center gap-2.5">
                <div className={`h-8 w-8 rounded-lg ${c.bg} flex items-center justify-center`}><c.icon className={`h-4 w-4 ${c.ic}`} /></div>
                <div><p className="text-lg font-bold leading-none">{c.value}</p><p className="text-[10px] text-muted-foreground mt-0.5">{c.label}</p></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Organizations List */}
      <Card className="border-border/50 shadow-none">
        <CardHeader className="px-3 sm:px-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Building2 className="h-4 w-4" />All Organizations</CardTitle></CardHeader>
        <CardContent className="px-0 sm:px-4">
          <div className="px-3 sm:px-0 pb-3 flex flex-wrap gap-2">
            <Button size="sm" variant={statusFilter === 'all' ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setStatusFilter('all')}>
              All ({orgs.length})
            </Button>
            <Button size="sm" variant={statusFilter === 'active' ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setStatusFilter('active')}>
              Active ({activeCount})
            </Button>
            <Button size="sm" variant={statusFilter === 'disabled' ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setStatusFilter('disabled')}>
              Disabled ({disabledCount})
            </Button>
          </div>
          {isMobile ? (
            <div className="space-y-2 px-3">
              {filteredOrgs.length === 0 ? <p className="text-center py-6 text-muted-foreground text-sm">No organizations for this filter</p> : filteredOrgs.map(o => {
                const industryPreset = o.industry ? INDUSTRY_PRESETS[o.industry] : null;
                return (
                  <div key={o.id} className="border border-border/50 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold">{o.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <p className="text-[10px] text-muted-foreground font-mono">{o.slug}</p>
                          {industryPreset && (
                            <Badge variant="outline" className={`text-[9px] ${industryPreset.bg}`}>
                              {industryPreset.label}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Badge variant={o.is_active ? 'default' : 'secondary'} className="text-[10px]">{o.is_active ? 'Active' : 'Inactive'}</Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div><p className="text-sm font-bold">{o.user_count}</p><p className="text-[9px] text-muted-foreground">Users</p></div>
                      <div><p className="text-sm font-bold">{o.leads_count}</p><p className="text-[9px] text-muted-foreground">Leads</p></div>
                      <div><p className="text-sm font-bold">{o.students_count}</p><p className="text-[9px] text-muted-foreground">Students</p></div>
                      <div><p className="text-sm font-bold">{fmt(parseFloat(o.revenue) || 0)}</p><p className="text-[9px] text-muted-foreground">Revenue</p></div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="flex-1 min-w-[4.5rem] h-8 text-xs gap-1" onClick={() => openOrgView(o)}><Eye className="h-3 w-3" />View</Button>
                      <Button size="sm" variant="outline" className="flex-1 min-w-[4.5rem] h-8 text-xs gap-1" onClick={() => openFeatures(o.id)}><Settings className="h-3 w-3" />Features</Button>
                      <Button size="sm" variant="outline" className="flex-1 min-w-[4.5rem] h-8 text-xs gap-1" title="Change organization admin sign-in (email, name, password)" onClick={() => openProvisionAdmin(o)}><KeyRound className="h-3 w-3" />Admin</Button>
                      <Button size="sm" variant={o.is_active ? 'destructive' : 'default'} className="h-8 text-xs" onClick={() => toggleOrgStatus(o)} disabled={statusUpdatingOrgId === o.id || deletingOrgId === o.id}>
                        {statusUpdatingOrgId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : (o.is_active ? 'Disable' : 'Enable')}
                      </Button>
                      <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={() => requestDeleteOrg(o)} disabled={statusUpdatingOrgId === o.id || deletingOrgId === o.id}>
                        {deletingOrgId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Delete'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-center">Users</TableHead>
                  <TableHead className="text-center">Leads</TableHead>
                  <TableHead className="text-center">Students</TableHead>
                  <TableHead className="text-center">Revenue</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrgs.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No organizations. Click "Add Organization" to get started.</TableCell></TableRow>
                ) : filteredOrgs.map(o => {
                  const industryPreset = o.industry ? INDUSTRY_PRESETS[o.industry] : null;
                  return (
                    <TableRow key={o.id}>
                      <TableCell>
                        <div><p className="font-medium">{o.name}</p><p className="text-xs text-muted-foreground font-mono">{o.slug}</p></div>
                      </TableCell>
                      <TableCell>
                        {industryPreset ? (
                          <Badge variant="outline" className={`text-xs ${industryPreset.bg}`}>
                            <industryPreset.icon className={`h-3 w-3 mr-1 ${industryPreset.color}`} />
                            {industryPreset.label}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell><Badge variant="outline" className="capitalize text-xs">{o.plan}</Badge></TableCell>
                      <TableCell className="text-center font-medium">{o.user_count}</TableCell>
                      <TableCell className="text-center">{o.leads_count} <span className="text-emerald-600 text-xs">({o.converted_count} conv.)</span></TableCell>
                      <TableCell className="text-center">{o.students_count}</TableCell>
                      <TableCell className="text-center font-semibold">{fmt(parseFloat(o.revenue) || 0)}</TableCell>
                      <TableCell><Badge variant={o.is_active ? 'default' : 'secondary'} className="text-xs">{o.is_active ? 'Active' : 'Disabled'}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap gap-1.5 justify-end">
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openOrgView(o)}><Eye className="h-3 w-3" />View</Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openFeatures(o.id)}><Settings className="h-3 w-3" />Features</Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" title="Change organization admin sign-in (email, name, password)" onClick={() => openProvisionAdmin(o)}><KeyRound className="h-3 w-3" />Admin</Button>
                          <Button size="sm" variant={o.is_active ? 'destructive' : 'default'} className="h-7 text-xs" onClick={() => toggleOrgStatus(o)} disabled={statusUpdatingOrgId === o.id || deletingOrgId === o.id}>
                            {statusUpdatingOrgId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : (o.is_active ? 'Disable' : 'Enable')}
                          </Button>
                          <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => requestDeleteOrg(o)} disabled={statusUpdatingOrgId === o.id || deletingOrgId === o.id}>
                            {deletingOrgId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Delete'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Features Dialog - Grouped by industry sections */}
      <Dialog open={!!showFeatures} onOpenChange={() => setShowFeatures(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Manage Features</DialogTitle></DialogHeader>
          <div className="space-y-5">
            {getOrgIndustryPreset().map(preset => (
              <div key={preset.label}>
                <div className="flex items-center gap-2 mb-3">
                  <preset.icon className={`h-4 w-4 ${preset.color}`} />
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{preset.label}</p>
                </div>
                {preset.sections.map(section => {
                  const sectionFeatureKeys = section.features.map(f => f.key);
                  const hasAnyUnique = sectionFeatureKeys.some(k => !Object.keys(features).length || features[k] !== undefined);
                  if (!hasAnyUnique && Object.keys(features).length > 0) return null;
                  return (
                    <div key={section.title} className="ml-2 mb-3">
                      <p className="text-[11px] font-semibold text-muted-foreground mb-2">{section.title}</p>
                      <div className="space-y-1.5">
                        {section.features.map(feat => (
                          <div key={feat.key} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-accent/50">
                            <div>
                              <Label className="text-sm cursor-pointer">{feat.label}</Label>
                              <p className="text-[10px] text-muted-foreground">{feat.description}</p>
                            </div>
                            <Switch
                              checked={features[feat.key] ?? false}
                              onCheckedChange={v => setFeatures(prev => ({ ...prev, [feat.key]: v }))}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={saveFeatures}>Save Features</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Organization Confirmation */}
      <AlertDialog open={!!deleteConfirmOrg} onOpenChange={(open) => { if (!open) { setDeleteConfirmOrg(null); setDeleteConfirmText(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Organization</AlertDialogTitle>
            <AlertDialogDescription>
              This action is permanent. To confirm deletion, type the organization name:
              <span className="font-semibold"> {deleteConfirmOrg?.name}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Type organization name</Label>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={deleteConfirmOrg?.name || 'Organization name'}
              disabled={!!deletingOrgId}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!deletingOrgId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteConfirmText.trim() !== String(deleteConfirmOrg?.name || '')) return;
                handleDeleteOrg();
              }}
              disabled={!!deletingOrgId || deleteConfirmText.trim() !== String(deleteConfirmOrg?.name || '')}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingOrgId ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete Organization'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Organization Details View */}
      <Dialog open={!!viewOrg} onOpenChange={(open) => { if (!open) setViewOrg(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Organization Details</DialogTitle></DialogHeader>
          {viewOrg && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">Name</p><p className="font-medium">{viewOrg.name}</p></div>
                <div><p className="text-xs text-muted-foreground">Slug</p><p className="font-medium font-mono">{viewOrg.slug}</p></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">Plan</p><p className="font-medium capitalize">{viewOrg.plan || 'starter'}</p></div>
                <div><p className="text-xs text-muted-foreground">Status</p><p className="font-medium">{viewOrg.is_active ? 'Active' : 'Disabled'}</p></div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center border rounded-lg p-3">
                <div><p className="text-lg font-bold">{viewOrg.user_count || 0}</p><p className="text-[10px] text-muted-foreground">Users</p></div>
                <div><p className="text-lg font-bold">{viewOrg.leads_count || 0}</p><p className="text-[10px] text-muted-foreground">Leads</p></div>
                <div><p className="text-lg font-bold">{viewOrg.students_count || 0}</p><p className="text-[10px] text-muted-foreground">Students</p></div>
                <div><p className="text-lg font-bold">{fmt(parseFloat(viewOrg.revenue) || 0)}</p><p className="text-[10px] text-muted-foreground">Revenue</p></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
            {viewOrg && <Button onClick={() => handleSwitchToOrg(viewOrg.id)} className="gap-1.5"><Eye className="h-4 w-4" />Open CRM</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!provisionOrg} onOpenChange={(open) => { if (!open) setProvisionOrg(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" />Organization admin credentials</DialogTitle>
          </DialogHeader>
          {provisionOrg && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground text-xs">Each organization has one admin. Use this to set or change their email, name, and password for <span className="font-medium text-foreground">{provisionOrg.name}</span>. They sign in at <span className="font-mono text-[10px]">/admin</span>.</p>
              <div className="space-y-2">
                <Label className="text-xs">Admin name *</Label>
                <Input value={provisionForm.admin_name} onChange={e => setProvisionForm(f => ({ ...f, admin_name: e.target.value }))} placeholder="Jane Admin" className="h-10" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Admin email *</Label>
                <Input type="email" value={provisionForm.admin_email} onChange={e => setProvisionForm(f => ({ ...f, admin_email: e.target.value }))} placeholder="admin@organization.com" className="h-10" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Password *</Label>
                <Input type="password" value={provisionForm.admin_password} onChange={e => setProvisionForm(f => ({ ...f, admin_password: e.target.value }))} className="h-10" />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleProvisionAdmin} disabled={provisioning}>
              {provisioning && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Update credentials
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
