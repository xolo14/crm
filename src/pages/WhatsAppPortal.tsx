import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { phpList } from '@/lib/phpList';
import { communicationsApi } from '@/services/communications';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  MessageSquare, Send, Plus, Eye, Loader2, FileText, Trash2,
  CheckCircle2, XCircle, Clock, Edit, Search, BarChart3, Users, Phone
} from 'lucide-react';
import { format } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CampaignRecipientPicker,
  mergeCampaignPhoneRecipients,
  type CampaignPickPerson,
} from '@/components/marketing/CampaignRecipientPicker';
import { WhatsAppCampaignSetupPanel } from '@/components/marketing/WhatsAppCampaignSetupPanel';
import { normalizeAppRole } from '@/lib/roleUtils';
import { fillTemplatePreview, templateVarCount } from '@/components/WhatsApp/waUtils';

export default function WhatsAppPortal() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState('form_leads');
  const [loading, setLoading] = useState(true);
  const [referralCode, setReferralCode] = useState('');
  const [formLeads, setFormLeads] = useState<any[]>([]);
  const [marketingMembers, setMarketingMembers] = useState<any[]>([]);
  const [metaTemplates, setMetaTemplates] = useState<any[]>([]);
  const [pendingTemplates, setPendingTemplates] = useState(0);
  const [waConnected, setWaConnected] = useState(false);
  const [waBusinessPhone, setWaBusinessPhone] = useState<string | null>(null);
  const [waConnectionStatus, setWaConnectionStatus] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [syncingTemplates, setSyncingTemplates] = useState(false);

  const [drafts, setDrafts] = useState<any[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [editingDraft, setEditingDraft] = useState<any>(null);
  const [draftName, setDraftName] = useState('');
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [sends, setSends] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [showBulkSend, setShowBulkSend] = useState(false);
  const [bulkPhones, setBulkPhones] = useState('');
  const [waSource, setWaSource] = useState<'communications' | 'marketing'>('communications');
  const [selectedDraftId, setSelectedDraftId] = useState('');
  const [templateVars, setTemplateVars] = useState<string[]>([]);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const role = normalizeAppRole(user?.role);
  const canManageCredentials = ['super_admin', 'admin', 'org', 'manager'].includes(role);

  const recipientPeople = useMemo<CampaignPickPerson[]>(() => {
    const leads: CampaignPickPerson[] = formLeads
      .filter((l) => String(l.phone || '').replace(/\D+/g, '').length >= 10)
      .map((l) => ({
        id: `lead:${l.id}`,
        name: String(l.name || l.full_name || 'Lead'),
        email: String(l.email || '').trim() || undefined,
        phone: String(l.phone || '').trim(),
        group: 'leads' as const,
      }));
    const members: CampaignPickPerson[] = marketingMembers
      .filter((m) => String(m.phone || '').replace(/\D+/g, '').length >= 10)
      .map((m) => ({
        id: `member:${m.id}`,
        name: String(m.name || 'Member'),
        email: String(m.email || '').trim() || undefined,
        phone: String(m.phone || '').trim(),
        group: 'members' as const,
      }));
    return [...leads, ...members];
  }, [formLeads, marketingMembers]);

  const recipientCount = mergeCampaignPhoneRecipients(recipientPeople, selectedRecipientIds, bulkPhones).length;

  const selectedMetaTemplate = useMemo(
    () => metaTemplates.find((t: any) => t.id === selectedDraftId) || null,
    [metaTemplates, selectedDraftId],
  );
  const selectedVarCount = waSource === 'communications' ? templateVarCount(selectedMetaTemplate) : 0;
  const templatePreview = useMemo(() => {
    if (!selectedMetaTemplate) return '';
    return fillTemplatePreview(String(selectedMetaTemplate.body || ''), templateVars);
  }, [selectedMetaTemplate, templateVars]);

  useEffect(() => {
    if (waSource !== 'communications' || !selectedMetaTemplate) {
      setTemplateVars([]);
      return;
    }
    const n = templateVarCount(selectedMetaTemplate);
    setTemplateVars((prev) => Array.from({ length: n }, (_, i) => prev[i] ?? ''));
  }, [waSource, selectedDraftId, selectedMetaTemplate]);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [draftsRes, campaignsRes, membersRes, templatesRes, hubRes, allTplRes] = await Promise.all([
        api.marketing.whatsappDrafts({ mine: true }),
        api.marketing.whatsappCampaigns({ mine: true }),
        api.marketing.members().catch(() => ({ data: [] })),
        communicationsApi.templates({ status: 'approved' }).catch(() => ({ data: [] })),
        communicationsApi.hubSummary().catch(() => null),
        communicationsApi.templates().catch(() => ({ data: [] })),
      ]);
      const draftsData = phpList(draftsRes);
      const campaignsData = phpList(campaignsRes);
      setDrafts(draftsData);
      setCampaigns(campaignsData);
      setMarketingMembers(phpList(membersRes));
      const approved = Array.isArray(templatesRes?.data) ? templatesRes.data : phpList(templatesRes);
      setMetaTemplates(approved);
      const allTpl = Array.isArray(allTplRes?.data) ? allTplRes.data : phpList(allTplRes);
      setPendingTemplates(allTpl.filter((t: any) => String(t.status || '') !== 'approved').length);

      const orgWa = hubRes?.org_whatsapp;
      const connected = Boolean(orgWa && (Number(orgWa.is_active) === 1 || orgWa.is_active === true));
      setWaConnected(connected);
      setWaBusinessPhone(orgWa?.business_phone ? String(orgWa.business_phone) : null);
      setWaConnectionStatus(orgWa?.connection_status ? String(orgWa.connection_status) : connected ? 'connected' : 'not_connected');

      const code = user?.referral_code || (user?.id ? 'SP-' + user.id.substring(0, 8).toUpperCase() : '');
      setReferralCode(code);
      try {
        const leadsRes = code
          ? await api.leads.list({ referred_by: code })
          : await api.leads.list();
        setFormLeads(phpList(leadsRes));
      } catch {
        setFormLeads([]);
      }
      if (campaignsData.length > 0) {
        const sendsRes = await api.marketing.whatsappSends(campaignsData.map((c: any) => c.id));
        setSends(phpList(sendsRes));
      } else {
        setSends([]);
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    try {
      const res = await communicationsApi.testWhatsappConnection();
      toast({
        title: 'WhatsApp connected',
        description: res?.data?.display_phone_number
          ? `Number: ${res.data.display_phone_number}`
          : res?.message || 'Connection OK',
      });
      await fetchAll();
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Connection failed',
        description: err.message || 'Open WhatsApp Setup and save Meta credentials first.',
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSyncTemplates = async () => {
    setSyncingTemplates(true);
    try {
      const res = await communicationsApi.syncMetaTemplates();
      toast({
        title: 'Templates synced',
        description: `${res?.imported ?? 0} new, ${res?.updated ?? 0} updated (${res?.total ?? 0} from Meta)`,
      });
      await fetchAll();
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Sync failed',
        description: err.message || 'Connect WhatsApp first, then sync again.',
      });
    } finally {
      setSyncingTemplates(false);
    }
  };

  const saveDraft = async () => {
    if (!draftName.trim()) { toast({ variant: 'destructive', title: 'Draft name is required' }); return; }
    if (!draftSubject.trim()) { toast({ variant: 'destructive', title: 'Message title is required' }); return; }
    setSavingDraft(true);
    try {
      if (editingDraft) {
        await api.marketing.updateWhatsappDraft(editingDraft.id, { name: draftName, subject: draftSubject, body: draftBody });
      } else {
        await api.marketing.createWhatsappDraft({ name: draftName, subject: draftSubject, body: draftBody });
      }
      toast({ title: editingDraft ? 'Draft updated' : 'Draft saved' });
      setShowEditor(false); setEditingDraft(null); setDraftName(''); setDraftSubject(''); setDraftBody('');
      fetchAll();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally { setSavingDraft(false); }
  };

  const deleteDraft = async (id: string) => {
    try {
      await api.marketing.deleteWhatsappDraft(id);
      toast({ title: 'Draft deleted' }); fetchAll();
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
  };

  const openEditor = (draft?: any) => {
    if (draft) { setEditingDraft(draft); setDraftName(draft.name || ''); setDraftSubject(draft.subject); setDraftBody(draft.body || ''); }
    else { setEditingDraft(null); setDraftName(''); setDraftSubject(''); setDraftBody(''); }
    setShowEditor(true);
  };

  useEffect(() => {
    if (loading || searchParams.get('create') !== '1') return;
    openEditor();
    const next = new URLSearchParams(searchParams);
    next.delete('create');
    setSearchParams(next, { replace: true });
  }, [loading, searchParams, setSearchParams]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const phoneRegex = /[\+]?[0-9]{10,15}/g;
      const found = text.match(phoneRegex) || [];
      const unique = [...new Set(found)];
      setBulkPhones(prev => {
        const existing = prev.split('\n').map(e => e.trim()).filter(Boolean);
        return [...new Set([...existing, ...unique])].join('\n');
      });
      toast({ title: `Found ${unique.length} phone numbers from file` });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleBulkSend = async () => {
    if (!waConnected) {
      toast({
        variant: 'destructive',
        title: 'WhatsApp not connected',
        description: 'Complete Setup step 1 first (Connect WhatsApp).',
      });
      return;
    }
    const recipients = mergeCampaignPhoneRecipients(recipientPeople, selectedRecipientIds, bulkPhones);
    if (recipients.length === 0) { toast({ variant: 'destructive', title: 'No valid phone numbers provided' }); return; }
    if (!selectedDraftId) {
      toast({
        variant: 'destructive',
        title: waSource === 'communications' ? 'Please select a Meta template' : 'Please select a draft',
      });
      return;
    }
    if (waSource === 'communications' && metaTemplates.length === 0) {
      toast({
        variant: 'destructive',
        title: 'No approved templates',
        description: 'Complete Setup step 2: Sync templates from Meta.',
      });
      return;
    }
    if (waSource === 'communications' && selectedVarCount > 0) {
      const missing: number[] = [];
      for (let i = 0; i < selectedVarCount; i++) {
        if ((templateVars[i] ?? '').trim()) continue;
        // {{1}} may be filled per recipient from lead/member name
        if (i === 0 && selectedRecipientIds.length > 0) continue;
        missing.push(i + 1);
      }
      if (missing.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Fill template parameters',
          description: `This template needs {{${missing.join('}}, {{')}}}. Enter values below the template picker.`,
        });
        return;
      }
    }
    setSending(true);
    try {
      const res = await api.marketing.dispatchWhatsappCampaign({
        source: waSource,
        template_id: selectedDraftId,
        draft_id: selectedDraftId,
        variables: waSource === 'communications'
          ? Array.from({ length: selectedVarCount }, (_, i) => (templateVars[i] ?? '').trim())
          : undefined,
        recipients,
      });
      const sent = Number(res?.sent ?? 0);
      const failed = Number(res?.failed ?? 0);
      if (sent <= 0) {
        throw new Error(res?.error || res?.message || 'WhatsApp send failed');
      }
      toast({
        title: `Sent ${sent} message(s)`,
        description: failed
          ? `${failed} failed. ${String(res?.message || '')}`
          : waSource === 'communications'
            ? 'Delivered via Meta approved template.'
            : 'Delivered as session text (24h window).',
      });
      setShowBulkSend(false);
      setBulkPhones('');
      setSelectedDraftId('');
      setTemplateVars([]);
      setSelectedRecipientIds([]);
      fetchAll();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Send failed', description: err.message });
    } finally {
      setSending(false);
    }
  };

  const openSendCampaign = () => {
    if (!waConnected) {
      toast({
        variant: 'destructive',
        title: 'Connect WhatsApp first',
        description: 'Use Setup step 1 above, then try Send Campaign again.',
      });
      return;
    }
    setShowBulkSend(true);
  };

  const totalSent = campaigns.reduce((s: number, c: any) => s + (c.sent_count || 0), 0);
  const totalFailed = campaigns.reduce((s: number, c: any) => s + (c.failed_count || 0), 0);
  const totalPending = campaigns.reduce((s: number, c: any) => s + (c.pending_count || 0), 0);

  const filteredSends = sends.filter((s: any) => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (searchQuery && !s.recipient_phone?.includes(searchQuery)) return false;
    return true;
  });

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
            <MessageSquare className="h-5 w-5 md:h-6 md:w-6 text-emerald-500" />
            WhatsApp Marketing
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground">Compose, preview & send WhatsApp campaigns</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => navigate('/marketing/whatsapp-analytics')}>
            <BarChart3 className="h-3.5 w-3.5" />Analytics
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openEditor()}>
            <Plus className="h-3.5 w-3.5" />New Draft
          </Button>
          <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={openSendCampaign}>
            <Send className="h-3.5 w-3.5" />Send Campaign
          </Button>
        </div>
      </div>

      <WhatsAppCampaignSetupPanel
        status={{
          connected: waConnected,
          businessPhone: waBusinessPhone,
          connectionStatus: waConnectionStatus,
          approvedTemplates: metaTemplates.length,
          pendingTemplates,
        }}
        testing={testingConnection}
        syncing={syncingTemplates}
        canManageCredentials={canManageCredentials}
        onTestConnection={() => void handleTestConnection()}
        onSyncTemplates={() => void handleSyncTemplates()}
        onOpenCredentialsSetup={() => navigate('/communications/whatsapp-setup')}
        onSendCampaign={openSendCampaign}
        onCreateDraft={() => openEditor()}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Sent</span></div>
            <p className="text-lg md:text-xl font-bold text-emerald-600">{totalSent}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1"><XCircle className="h-3.5 w-3.5 text-red-500" /><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Failed</span></div>
            <p className="text-lg md:text-xl font-bold text-red-600">{totalFailed}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1"><Clock className="h-3.5 w-3.5 text-amber-500" /><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Pending</span></div>
            <p className="text-lg md:text-xl font-bold text-amber-600">{totalPending}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1"><Users className="h-3.5 w-3.5 text-blue-500" /><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Form Leads</span></div>
            <p className="text-lg md:text-xl font-bold text-blue-600">{formLeads.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full md:w-auto">
          <TabsTrigger value="form_leads" className="text-xs gap-1"><Users className="h-3 w-3" />Form Leads</TabsTrigger>
          <TabsTrigger value="drafts" className="text-xs gap-1"><FileText className="h-3 w-3" />Drafts</TabsTrigger>
          <TabsTrigger value="campaigns" className="text-xs gap-1"><Send className="h-3 w-3" />Campaigns</TabsTrigger>
          <TabsTrigger value="history" className="text-xs gap-1"><MessageSquare className="h-3 w-3" />Message History</TabsTrigger>
        </TabsList>

        {/* Form Leads */}
        <TabsContent value="form_leads">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">#</TableHead>
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="text-xs">Email</TableHead>
                      <TableHead className="text-xs">Phone</TableHead>
                      <TableHead className="text-xs">Source</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {formLeads.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                        <Users className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />No form leads yet.
                      </TableCell></TableRow>
                    ) : formLeads.map((lead: any, i: number) => (
                      <TableRow key={lead.id}>
                        <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="text-sm font-medium">{lead.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{lead.email || '—'}</TableCell>
                        <TableCell className="text-xs">{lead.phone || '—'}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{lead.source || 'website'}</Badge></TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            lead.status === 'converted' || lead.status === 'enrolled' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            lead.status === 'interested' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            lead.status === 'lost' ? 'bg-red-50 text-red-700 border-red-200' :
                            'bg-gray-50 text-gray-700 border-gray-200'
                          }>{lead.status === 'enrolled' ? 'Enroll' : (lead.status || 'new').replace(/_/g, ' ')}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{format(new Date(lead.created_at), 'dd MMM yyyy')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Drafts */}
        <TabsContent value="drafts">
          <div className="grid gap-3">
            {drafts.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">
                <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />No drafts yet. Click "New Draft" to start composing.
              </CardContent></Card>
            ) : drafts.map((d: any) => (
              <Card key={d.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{d.name || d.subject || '(No name)'}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Title: {d.subject || '(No title)'} · Updated {format(new Date(d.updated_at), 'dd MMM yyyy HH:mm')}
                      <Badge variant="outline" className="ml-2 text-[10px]">{d.status}</Badge>
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setDraftSubject(d.subject); setDraftBody(d.body); setShowPreview(true); }}>
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEditor(d)}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:text-red-600" onClick={() => deleteDraft(d.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Campaigns */}
        <TabsContent value="campaigns">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Title</TableHead>
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs text-center">Recipients</TableHead>
                      <TableHead className="text-xs text-center">Sent</TableHead>
                      <TableHead className="text-xs text-center">Failed</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No campaigns yet</TableCell></TableRow>
                    ) : campaigns.map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm font-medium max-w-[200px] truncate">{c.subject}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{format(new Date(c.created_at), 'dd MMM HH:mm')}</TableCell>
                        <TableCell className="text-center text-sm">{c.recipient_count}</TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">{c.sent_count}</Badge></TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">{c.failed_count}</Badge></TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            c.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            c.status === 'sending' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            c.status === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
                            'bg-amber-50 text-amber-700 border-amber-200'
                          }>{c.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Message History */}
        <TabsContent value="history">
          <Card>
            <CardContent className="py-3 px-4">
              <div className="flex flex-col sm:flex-row gap-2 mb-3">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Search phone numbers..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-8 h-8 text-xs" />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Phone Number</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Sent At</TableHead>
                      <TableHead className="text-xs">Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSends.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">No messages found</TableCell></TableRow>
                    ) : filteredSends.slice(0, 100).map((s: any) => (
                      <TableRow key={s.id}>
                        <TableCell className="text-sm font-mono">{s.recipient_phone}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            s.status === 'sent' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            s.status === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
                            'bg-amber-50 text-amber-700 border-amber-200'
                          }>{s.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.sent_at ? format(new Date(s.sent_at), 'dd MMM HH:mm') : '—'}</TableCell>
                        <TableCell className="text-xs text-red-500 max-w-[200px] truncate">{s.error_message || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Draft Editor */}
      <Dialog open={showEditor} onOpenChange={(open) => { setShowEditor(open); if (!open) { setEditingDraft(null); setDraftName(''); setDraftSubject(''); setDraftBody(''); } }}>
        <DialogContent className="max-w-3xl max-h-[min(90dvh,100%)] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingDraft ? 'Edit Draft' : 'New WhatsApp Draft'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-xs font-medium">Draft Name *</Label><Input value={draftName} onChange={e => setDraftName(e.target.value)} placeholder="e.g. Welcome Message, Promo..." className="mt-1" /></div>
            <div><Label className="text-xs font-medium">Message Title *</Label><Input value={draftSubject} onChange={e => setDraftSubject(e.target.value)} placeholder="Enter message title..." className="mt-1" /></div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs font-medium">Message Body</Label>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setShowPreview(true)}><Eye className="h-3 w-3" />Preview</Button>
              </div>
              <Textarea value={draftBody} onChange={e => setDraftBody(e.target.value)} placeholder={"Hi {{name}}, thanks for reaching out..."} className="min-h-[200px] text-sm" />
              <p className="text-[10px] text-muted-foreground">
                Session drafts send as free text via Meta (24h window only). Use {'{{name}}'} to personalize. For cold outreach use Meta templates in Send Campaign.
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowEditor(false)}>Cancel</Button>
              <Button onClick={saveDraft} disabled={savingDraft} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                {savingDraft && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingDraft ? 'Update Draft' : 'Save Draft'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>WhatsApp Preview</DialogTitle></DialogHeader>
          <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-xl p-4">
            <div className="bg-white dark:bg-card rounded-lg p-3 shadow-sm max-w-[280px]">
              <p className="text-xs font-semibold text-emerald-700 mb-1">{draftSubject || '(No title)'}</p>
              <p className="text-sm whitespace-pre-wrap">{draftBody || 'No content yet'}</p>
              <p className="text-[10px] text-muted-foreground mt-2 text-right">Now</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Send */}
      <Dialog open={showBulkSend} onOpenChange={(open) => {
        setShowBulkSend(open);
        if (!open) {
          setSelectedRecipientIds([]);
          setTemplateVars([]);
        }
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-emerald-500" />Send WhatsApp Campaign</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                className={`rounded-xl border p-3 text-left transition ${waSource === 'communications' ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-400' : 'hover:bg-muted/40'}`}
                onClick={() => { setWaSource('communications'); setSelectedDraftId(''); setTemplateVars([]); }}
              >
                <p className="text-sm font-semibold">1. Meta template</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Cold outreach to any lead (recommended)</p>
              </button>
              <button
                type="button"
                className={`rounded-xl border p-3 text-left transition ${waSource === 'marketing' ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-400' : 'hover:bg-muted/40'}`}
                onClick={() => { setWaSource('marketing'); setSelectedDraftId(''); setTemplateVars([]); }}
              >
                <p className="text-sm font-semibold">2. Session draft</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Free text — only within 24h chat window</p>
              </button>
            </div>

            {waSource === 'communications' ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs font-medium">Approved Meta template *</Label>
                  <Select value={selectedDraftId} onValueChange={setSelectedDraftId}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Choose approved template" /></SelectTrigger>
                    <SelectContent>
                      {metaTemplates.map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>{t.name || t.provider_template_id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {metaTemplates.length === 0 ? (
                    <p className="text-[10px] text-amber-600 mt-1">
                      No approved templates. Use Setup step 2 → Sync from Meta.
                    </p>
                  ) : null}
                </div>
                {selectedMetaTemplate && selectedVarCount > 0 ? (
                  <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs font-semibold">Template parameters ({selectedVarCount})</p>
                    <p className="text-[10px] text-muted-foreground">
                      Meta requires every {'{{n}}'} value. Leave {'{{1}}'} blank to use each selected lead/member name.
                    </p>
                    {Array.from({ length: selectedVarCount }, (_, i) => (
                      <div key={i} className="space-y-1">
                        <Label htmlFor={`wa-campaign-var-${i}`} className="text-xs">{`{{${i + 1}}}`}</Label>
                        <Input
                          id={`wa-campaign-var-${i}`}
                          value={templateVars[i] ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setTemplateVars((prev) => {
                              const next = Array.from({ length: selectedVarCount }, (_, j) => prev[j] ?? '');
                              next[i] = value;
                              return next;
                            });
                          }}
                          placeholder={
                            i === 0
                              ? 'Name (or blank = each recipient name)'
                              : i === 1
                                ? 'Course / topic / company'
                                : `Value for {{${i + 1}}}`
                          }
                          className={!(templateVars[i] ?? '').trim() && i > 0 ? 'border-amber-400' : undefined}
                        />
                      </div>
                    ))}
                    {selectedMetaTemplate.body ? (
                      <div className="rounded-md border bg-background p-2 text-xs whitespace-pre-wrap text-muted-foreground">
                        {templatePreview}
                      </div>
                    ) : null}
                  </div>
                ) : selectedMetaTemplate ? (
                  <p className="text-[10px] text-muted-foreground">
                    This template has no {'{{n}}'} placeholders in its body.
                  </p>
                ) : null}
              </div>
            ) : (
              <div>
                <Label className="text-xs font-medium">Marketing draft *</Label>
                <Select value={selectedDraftId} onValueChange={setSelectedDraftId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Choose a message draft" /></SelectTrigger>
                  <SelectContent>
                    {drafts.filter((d: any) => d.subject).map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>{d.name || d.subject}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Use {'{{name}}'} in the draft body to personalize. Outside the 24h window Meta will reject free text.
                </p>
              </div>
            )}

            <CampaignRecipientPicker
              mode="phone"
              people={recipientPeople}
              selectedIds={selectedRecipientIds}
              onSelectedIdsChange={setSelectedRecipientIds}
              manualText={bulkPhones}
              onManualTextChange={setBulkPhones}
              onUploadFile={handleFileUpload}
              fileInputRef={fileInputRef}
            />
            <DialogFooter>
              <Button onClick={handleBulkSend} disabled={sending || !waConnected} className="w-full gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send to {recipientCount} Recipients
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
