import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { phpList } from '@/lib/phpList';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  Mail, Send, Plus, Eye, Loader2, FileText, Trash2,
  CheckCircle2, XCircle, Clock, Edit, Search, BarChart3, Users, CalendarClock
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CampaignRecipientPicker,
  mergeCampaignEmailRecipients,
  type CampaignPickPerson,
} from '@/components/marketing/CampaignRecipientPicker';
import { sanitizeFormDescriptionHtml } from '@/components/forms/formDescriptionHtml';
import {
  autofillPlaceholderValues,
  extractAnglePlaceholders,
  placeholderValuesComplete,
} from '@/lib/emailDraftPlaceholders';

export default function MarketingPortal() {
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
  const [campaignLeads, setCampaignLeads] = useState<any[]>([]);
  const [marketingMembers, setMarketingMembers] = useState<any[]>([]);

  // Drafts
  const [drafts, setDrafts] = useState<any[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [editingDraft, setEditingDraft] = useState<any>(null);
  const [draftName, setDraftName] = useState('');
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Campaigns & sends
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [sends, setSends] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Bulk send dialog
  const [showBulkSend, setShowBulkSend] = useState(false);
  const [bulkEmails, setBulkEmails] = useState('');
  const [selectedDraftId, setSelectedDraftId] = useState('');
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [mailboxes, setMailboxes] = useState<Array<{ id: string; email: string; label?: string; from_name?: string }>>([]);
  const [smtpAccountId, setSmtpAccountId] = useState('');
  const [campaignSchedule, setCampaignSchedule] = useState('');
  const [fillRows, setFillRows] = useState<Array<{
    key: string;
    email: string;
    name: string;
    values: Record<string, string>;
    scheduledAt: string;
  }>>([]);
  const leadSearchTimer = useRef<number | null>(null);

  const recipientPeople = useMemo<CampaignPickPerson[]>(() => {
    const leads: CampaignPickPerson[] = campaignLeads
      .filter((l) => String(l.email || '').includes('@'))
      .map((l) => ({
        id: `lead:${l.id}`,
        name: String(l.name || l.full_name || 'Lead'),
        email: String(l.email || '').trim(),
        phone: String(l.phone || '').trim() || undefined,
        college: String(l.college || '').trim() || undefined,
        course: String(l.course_interest || l.course || '').trim() || undefined,
        company: String(l.company || '').trim() || undefined,
        source: String(l.source || '').trim() || undefined,
        group: 'leads' as const,
      }));
    const members: CampaignPickPerson[] = marketingMembers
      .filter((m) => String(m.email || '').includes('@'))
      .map((m) => ({
        id: `member:${m.id}`,
        name: String(m.name || 'Member'),
        email: String(m.email || '').trim(),
        phone: String(m.phone || '').trim() || undefined,
        group: 'members' as const,
      }));
    const seen = new Set<string>();
    const out: CampaignPickPerson[] = [];
    for (const p of [...leads, ...members]) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    return out;
  }, [campaignLeads, marketingMembers]);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [draftsRes, campaignsRes, membersRes] = await Promise.all([
        api.marketing.emailDrafts({ mine: true }),
        api.marketing.emailCampaigns({ mine: true }),
        api.marketing.members().catch(() => ({ data: [] })),
      ]);
      const draftsData = phpList(draftsRes);
      const campaignsData = phpList(campaignsRes);
      setDrafts(draftsData);
      setCampaigns(campaignsData);
      setMarketingMembers(phpList(membersRes));

      const code = String(user?.referral_code || "").trim();
      setReferralCode(code);

      try {
        const leadsRes = code
          ? await api.leads.list({ referred_by: code, all: false, limit: 5000 })
          : await api.leads.list({ all: false, limit: 5000 });
        setFormLeads(phpList(leadsRes));
      } catch {
        if (code) {
          const leadsRes = await api.leads.list({ referred_by: code, all: false, limit: 5000 }).catch(() => ({ data: [] }));
          setFormLeads(phpList(leadsRes));
        } else {
          setFormLeads([]);
        }
      }

      setCampaignLeads([]);

      if (campaignsData.length > 0) {
        const sendsRes = await api.marketing.emailSends(campaignsData.map((c: any) => c.id));
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

  // Draft CRUD
  const saveDraft = async () => {
    if (!draftName.trim()) { toast({ variant: 'destructive', title: 'Draft name is required' }); return; }
    if (!draftSubject.trim()) { toast({ variant: 'destructive', title: 'Subject is required' }); return; }
    setSavingDraft(true);
    try {
      if (editingDraft) {
        await api.marketing.updateEmailDraft(editingDraft.id, { name: draftName, subject: draftSubject, html_body: draftBody });
      } else {
        await api.marketing.createEmailDraft({ name: draftName, subject: draftSubject, html_body: draftBody });
      }
      toast({ title: editingDraft ? 'Draft updated' : 'Draft saved' });
      setShowEditor(false);
      setEditingDraft(null);
      setDraftName('');
      setDraftSubject('');
      setDraftBody('');
      fetchAll();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setSavingDraft(false);
    }
  };

  const deleteDraft = async (id: string) => {
    try {
      await api.marketing.deleteEmailDraft(id);
      toast({ title: 'Draft deleted' });
      fetchAll();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    }
  };

  const openEditor = (draft?: any) => {
    if (draft) {
      setEditingDraft(draft);
      setDraftName(draft.name || '');
      setDraftSubject(draft.subject);
      setDraftBody(draft.html_body || '');
    } else {
      setEditingDraft(null);
      setDraftName('');
      setDraftSubject('');
      setDraftBody('');
    }
    setShowEditor(true);
  };

  useEffect(() => {
    if (loading || searchParams.get('create') !== '1') return;
    openEditor();
    const next = new URLSearchParams(searchParams);
    next.delete('create');
    setSearchParams(next, { replace: true });
  }, [loading, searchParams, setSearchParams]);

  // Bulk send
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      // Extract emails from CSV (first column or any email pattern)
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const found = text.match(emailRegex) || [];
      const unique = [...new Set(found)];
      setBulkEmails(prev => {
        const existing = prev.split('\n').map(e => e.trim()).filter(Boolean);
        return [...new Set([...existing, ...unique])].join('\n');
      });
      toast({ title: `Found ${unique.length} emails from file` });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleBulkSend = async () => {
    if (!selectedDraftId) { toast({ variant: 'destructive', title: 'Please select a draft' }); return; }
    if (!smtpAccountId) { toast({ variant: 'destructive', title: 'Choose which mailbox to send from' }); return; }
    if (fillRows.length === 0) { toast({ variant: 'destructive', title: 'No valid emails provided' }); return; }
    const selectedDraft = drafts.find((d) => d.id === selectedDraftId);
    const keys = extractAnglePlaceholders(String(selectedDraft?.subject || ''), String(selectedDraft?.html_body || ''));
    const incomplete = fillRows.find((r) => !placeholderValuesComplete(keys, r.values));
    if (incomplete) {
      toast({ variant: 'destructive', title: 'Fill all placeholders', description: `Complete <<fields>> for ${incomplete.email} before sending.` });
      return;
    }

    setSending(true);
    try {
      const res = await api.marketing.dispatchEmailCampaign({
        draft_id: selectedDraftId,
        smtp_account_id: smtpAccountId,
        scheduled_at: campaignSchedule || null,
        recipients: fillRows.map((r) => ({
          email: r.email,
          values: r.values,
          scheduled_at: r.scheduledAt || null,
        })),
      });
      const sent = Number(res?.sent ?? 0);
      const failed = Number(res?.failed ?? 0);
      const pending = Number(res?.pending ?? 0);
      if (sent <= 0 && pending <= 0) {
        throw new Error(res?.error || res?.message || 'Send failed. Check Settings → Email Setup for your organization SMTP.');
      }
      toast({
        title: res?.message || `Sent ${sent} email(s)`,
        description: [failed ? `${failed} failed` : '', pending ? `${pending} scheduled` : ''].filter(Boolean).join(' · ') || 'Delivered via your organization mailbox.',
      });
      setShowBulkSend(false);
      setBulkEmails('');
      setSelectedDraftId('');
      setSelectedRecipientIds([]);
      setFillRows([]);
      setCampaignSchedule('');
      fetchAll();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Send failed', description: err.message });
    } finally {
      setSending(false);
    }
  };

  const placeholderKeys = useMemo(() => {
    const d = drafts.find((x) => x.id === selectedDraftId);
    return extractAnglePlaceholders(String(d?.subject || ''), String(d?.html_body || ''));
  }, [drafts, selectedDraftId]);
  const editorTokens = useMemo(
    () => extractAnglePlaceholders(draftSubject, draftBody),
    [draftSubject, draftBody],
  );

  useEffect(() => {
    if (!showBulkSend) return;
    void api.marketing.orgMailboxes()
      .then((res) => {
        const list = phpList(res) as Array<{ id: string; email: string; label?: string; from_name?: string }>;
        setMailboxes(list);
        setSmtpAccountId((prev) => prev || (list[0]?.id ?? ''));
      })
      .catch(() => setMailboxes([]));
  }, [showBulkSend]);

  useEffect(() => {
    if (!showBulkSend) return;
    const details = mergeCampaignEmailRecipients(recipientPeople, selectedRecipientIds, bulkEmails);
    setFillRows((prev) => {
      const byEmail = new Map(prev.map((r) => [r.email.toLowerCase(), r]));
      return details.map((d) => {
        const existing = byEmail.get(d.email.toLowerCase());
        const person =
          recipientPeople.find((p) => p.id === d.personId) ||
          recipientPeople.find((p) => String(p.email || '').toLowerCase() === d.email.toLowerCase());
        const auto = autofillPlaceholderValues(person, placeholderKeys);
        const values: Record<string, string> = {};
        for (const k of placeholderKeys) {
          const prevVal = existing?.values?.[k];
          values[k] = prevVal != null && String(prevVal).trim() !== '' ? String(prevVal) : (auto[k] || '');
        }
        return {
          key: existing?.key ?? d.email.toLowerCase(),
          email: d.email,
          name: d.name || existing?.name || person?.name || '',
          values,
          scheduledAt: existing?.scheduledAt ?? '',
        };
      });
    });
  }, [showBulkSend, selectedRecipientIds, bulkEmails, recipientPeople, placeholderKeys]);

  const onLeadSearch = useCallback((q: string) => {
    if (leadSearchTimer.current) window.clearTimeout(leadSearchTimer.current);
    const query = q.trim();
    if (query.length < 2) return;
    leadSearchTimer.current = window.setTimeout(() => {
      void api.leads.list({ search: query, all: false, limit: 300 })
        .then((res) => {
          const extra = phpList(res);
          if (!extra.length) return;
          setCampaignLeads((prev) => {
            const byId = new Map(prev.map((l) => [String(l.id), l]));
            for (const row of extra) {
              const id = String(row?.id || '');
              if (id) byId.set(id, row);
            }
            return Array.from(byId.values());
          });
        })
        .catch(() => undefined);
    }, 300);
  }, []);

  // Stats
  const totalSent = campaigns.reduce((s, c) => s + (c.sent_count || 0), 0);
  const totalFailed = campaigns.reduce((s, c) => s + (c.failed_count || 0), 0);
  const totalPending = campaigns.reduce((s, c) => s + (c.pending_count || 0), 0);

  const filteredSends = sends.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (searchQuery && !s.recipient_email?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
            <Mail className="h-5 w-5 md:h-6 md:w-6 text-primary" />
            Email Marketing
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground">Compose, preview & send email campaigns</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => navigate('/marketing/analytics')}>
            <BarChart3 className="h-3.5 w-3.5" />Analytics
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openEditor()}>
            <Plus className="h-3.5 w-3.5" />New Draft
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setShowBulkSend(true)}>
            <Send className="h-3.5 w-3.5" />Send Campaign
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
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
          <TabsTrigger value="history" className="text-xs gap-1"><Mail className="h-3 w-3" />Email History</TabsTrigger>
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
                        <Users className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                        No form leads yet. Share your form link to collect leads.
                      </TableCell></TableRow>
                    ) : formLeads.map((lead, i) => (
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
                <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                No drafts yet. Click "New Draft" to start composing.
              </CardContent></Card>
            ) : drafts.map(d => (
              <Card key={d.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{d.name || d.subject || '(No name)'}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Subject: {d.subject || '(No subject)'} · Updated {format(new Date(d.updated_at), 'dd MMM yyyy HH:mm')}
                      <Badge variant="outline" className="ml-2 text-[10px]">{d.status}</Badge>
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setDraftSubject(d.subject); setDraftBody(d.html_body); setShowPreview(true); }}>
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
                      <TableHead className="text-xs">Subject</TableHead>
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
                    ) : campaigns.map(c => (
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

        {/* Email History */}
        <TabsContent value="history">
          <Card>
            <CardHeader className="py-3 px-4">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Search emails..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-8 h-8 text-xs" />
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
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Recipient</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Scheduled</TableHead>
                      <TableHead className="text-xs">Sent At</TableHead>
                      <TableHead className="text-xs">Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSends.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No emails found</TableCell></TableRow>
                    ) : filteredSends.slice(0, 100).map(s => (
                      <TableRow key={s.id}>
                        <TableCell className="text-sm">{s.recipient_email}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            s.status === 'sent' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            s.status === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
                            'bg-amber-50 text-amber-700 border-amber-200'
                          }>{s.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.scheduled_at ? format(new Date(s.scheduled_at), 'dd MMM HH:mm') : '—'}</TableCell>
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

      {/* Draft Editor Dialog */}
      <Dialog open={showEditor} onOpenChange={(open) => { setShowEditor(open); if (!open) { setEditingDraft(null); setDraftName(''); setDraftSubject(''); setDraftBody(''); } }}>
        <DialogContent className="max-w-3xl max-h-[min(90dvh,100%)] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingDraft ? 'Edit Draft' : 'New Email Draft'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-medium">Draft Name *</Label>
              <Input value={draftName} onChange={e => setDraftName(e.target.value)} placeholder="e.g. Welcome Email, Promo Offer..." className="mt-1" />
            </div>
            <div>
              <Label className="text-xs font-medium">Subject *</Label>
              <Input value={draftSubject} onChange={e => setDraftSubject(e.target.value)} placeholder="Enter email subject..." className="mt-1" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs font-medium">Email Body (HTML supported)</Label>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setShowPreview(true)}>
                  <Eye className="h-3 w-3" />Preview
                </Button>
              </div>
              <Textarea
                value={draftBody}
                onChange={e => setDraftBody(e.target.value)}
                placeholder={"Write your email here. Use <<name>> <<course>> as placeholders — they are filled per recipient when you send."}
                className="min-h-[300px] font-mono text-sm"
              />
              {editorTokens.length > 0 ? (
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Placeholders filled at send:{' '}
                  {editorTokens.map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px] font-mono mr-1">{`<<${t}>>`}</Badge>
                  ))}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Wrap merge fields in {'<< >>'} (example {'<<name>>'}). Send Campaign will ask for those values per recipient.
                </p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowEditor(false)}>Cancel</Button>
              <Button onClick={saveDraft} disabled={savingDraft} className="gap-1.5">
                {savingDraft && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingDraft ? 'Update Draft' : 'Save Draft'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Email Preview</DialogTitle></DialogHeader>
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/50 px-4 py-2.5 border-b">
              <p className="text-xs text-muted-foreground">Subject:</p>
              <p className="text-sm font-semibold">{draftSubject || '(No subject)'}</p>
            </div>
            <div className="p-4 bg-white min-h-[200px]">
              <div dangerouslySetInnerHTML={{ __html: sanitizeFormDescriptionHtml(draftBody || '<p style="color: #999;">No content yet</p>') }} />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Send Dialog */}
      <Dialog open={showBulkSend} onOpenChange={(open) => {
        setShowBulkSend(open);
        if (!open) {
          setSelectedRecipientIds([]);
          setFillRows([]);
          setCampaignSchedule('');
          setCampaignLeads([]);
        }
      }}>
        <DialogContent className="max-w-5xl w-[min(96rem,calc(100%-1rem))] max-h-[min(94dvh,calc(100dvh-1rem))] overflow-hidden flex flex-col gap-3 p-4 sm:p-6">
          <DialogHeader className="shrink-0 space-y-0">
            <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
              <div>
                <DialogTitle className="flex items-center gap-2"><Send className="h-4 w-4" />Send Campaign</DialogTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Select a draft, fill {'<<placeholders>>'} per recipient, then choose when and which mailbox to send from.
                </p>
              </div>
              <div className="space-y-1 min-w-[220px]">
                <Label className="text-[11px] flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" />Schedule
                </Label>
                <Input
                  type="datetime-local"
                  className="h-8 text-xs"
                  value={campaignSchedule}
                  onChange={(e) => setCampaignSchedule(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground">Empty = send now. Row schedule overrides this.</p>
              </div>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto space-y-4 pr-1">
            <div>
              <Label className="text-xs font-medium">Select Draft *</Label>
              <Select value={selectedDraftId} onValueChange={setSelectedDraftId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Choose an email draft" /></SelectTrigger>
                <SelectContent>
                  {drafts.filter(d => d.subject).map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.name || d.subject}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedDraftId && placeholderKeys.length > 0 ? (
                <p className="text-[11px] text-muted-foreground mt-1">
                  This draft needs:{' '}
                  {placeholderKeys.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px] font-mono mr-1">{`<<${t}>>`}</Badge>
                  ))}
                </p>
              ) : null}
            </div>
            <CampaignRecipientPicker
              key={showBulkSend ? "send-open" : "send-closed"}
              mode="email"
              people={recipientPeople}
              selectedIds={selectedRecipientIds}
              onSelectedIdsChange={setSelectedRecipientIds}
              manualText={bulkEmails}
              onManualTextChange={setBulkEmails}
              onUploadFile={handleFileUpload}
              fileInputRef={fileInputRef}
              onSearchChange={onLeadSearch}
              hideListUntilSearch
            />
            {fillRows.length > 0 ? (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs sticky left-0 bg-background min-w-[160px]">Recipient</TableHead>
                      {placeholderKeys.map((k) => (
                        <TableHead key={k} className="text-xs font-mono min-w-[140px]">{`<<${k}>>`}</TableHead>
                      ))}
                      <TableHead className="text-xs min-w-[190px]">Schedule</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fillRows.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="text-xs sticky left-0 bg-background">
                          <div className="font-medium truncate max-w-[180px]">{row.name || '—'}</div>
                          <div className="text-muted-foreground truncate max-w-[180px]">{row.email}</div>
                        </TableCell>
                        {placeholderKeys.map((k) => (
                          <TableCell key={k}>
                            <Input
                              className="h-8 text-xs"
                              value={row.values[k] ?? ''}
                              onChange={(e) => {
                                const v = e.target.value;
                                setFillRows((prev) => prev.map((r) => (
                                  r.key === row.key ? { ...r, values: { ...r.values, [k]: v } } : r
                                )));
                              }}
                            />
                          </TableCell>
                        ))}
                        <TableCell>
                          <Input
                            type="datetime-local"
                            className="h-8 text-xs"
                            value={row.scheduledAt}
                            onChange={(e) => {
                              const v = e.target.value;
                              setFillRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, scheduledAt: v } : r)));
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : selectedDraftId ? (
              <p className="text-xs text-muted-foreground">Search and select leads, or enter emails manually, to build the send list.</p>
            ) : null}
          </div>
          <DialogFooter className="shrink-0 flex-col sm:flex-col gap-2 items-stretch">
            <div>
              <Label className="text-xs font-medium">Which mail to send from *</Label>
              <Select value={smtpAccountId} onValueChange={setSmtpAccountId}>
                <SelectTrigger className="mt-1 h-9 text-xs">
                  <SelectValue placeholder={mailboxes.length ? 'Choose organization mailbox' : 'No org emails yet — add them in Email Setup'} />
                </SelectTrigger>
                <SelectContent>
                  {mailboxes.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {(m.label || m.from_name || 'Mailbox') + ' — ' + m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleBulkSend} disabled={sending || fillRows.length === 0} className="w-full gap-1.5">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send to {fillRows.length} Recipient{fillRows.length === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
