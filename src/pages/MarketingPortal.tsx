import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { searchAccessibleLeads } from '@/lib/searchAccessibleLeads';
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
  CheckCircle2, XCircle, Clock, Edit, Search, BarChart3, Users, CalendarClock, Paperclip, X
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import { useSearchParams } from 'react-router-dom';
import { normalizeAppRole } from '@/lib/roleUtils';
import {
  CampaignRecipientPicker,
  formatManualEmailLine,
  mergeCampaignEmailRecipients,
  parseManualEmailEntries,
  type CampaignPickPerson,
} from '@/components/marketing/CampaignRecipientPicker';
import { FormLeadsCampaignTab } from '@/components/marketing/FormLeadsCampaignTab';
import EmailAnalytics from '@/pages/EmailAnalytics';
import { campaignCanRetry, campaignDisplaySummary, emailSendOutcome } from '@/lib/emailSendStatus';
import { useCampaignFormLeads } from '@/lib/campaignFormLeads';
import {
  autofillPlaceholderValues,
  extractAnglePlaceholders,
  isNamePlaceholderKey,
  placeholderValuesComplete,
  syncNamePlaceholderValues,
} from '@/lib/emailDraftPlaceholders';

/** Same HTML the mailbox sends. Full documents keep their <style> and tables; plain text is escaped. */
function emailPreviewSrcDoc(body: unknown): string {
  const raw = String(body ?? '').trim();
  if (!raw) {
    return '<!DOCTYPE html><html><body><p style="margin:0;color:#999;font-family:system-ui,sans-serif">No content yet</p></body></html>';
  }
  if (/<!doctype\s+html|<html[\s>]/i.test(raw)) return raw;
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0">${raw}</body></html>`;
  }
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
  return `<!DOCTYPE html><html><body style="margin:0;padding:16px;font-family:system-ui,sans-serif;color:#0f172a">${escaped}</body></html>`;
}

export default function MarketingPortal() {
  const { user } = useAuth();
  const mineOnly = normalizeAppRole(user?.role) === 'marketing';
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const marketingTabs = ['form_leads', 'drafts', 'campaigns', 'history', 'analytics'] as const;
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get('tab') || '';
    return marketingTabs.includes(t as (typeof marketingTabs)[number]) ? t : 'form_leads';
  });
  const [loading, setLoading] = useState(true);
  const [campaignLeads, setCampaignLeads] = useState<any[]>([]);
  const [marketingMembers, setMarketingMembers] = useState<any[]>([]);
  const {
    campaignForms,
    campaignFormsLoading,
    selectedFormId,
    setSelectedFormId,
    formLeadRows,
    formLeadsLoading,
    formLeadDestination,
    formPeopleEmail: formPeople,
    extraFormPeople,
  } = useCampaignFormLeads();

  // Drafts
  const [drafts, setDrafts] = useState<any[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [editingDraft, setEditingDraft] = useState<any>(null);
  const [draftName, setDraftName] = useState('');
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftPdfFile, setDraftPdfFile] = useState<File | null>(null);
  const [draftPdfName, setDraftPdfName] = useState('');
  const [draftPdfRemove, setDraftPdfRemove] = useState(false);
  const draftPdfInputRef = useRef<HTMLInputElement | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Campaigns & sends
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [sends, setSends] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [campaignLog, setCampaignLog] = useState<any | null>(null);
  const [campaignLogRows, setCampaignLogRows] = useState<any[]>([]);
  const [campaignLogLoading, setCampaignLogLoading] = useState(false);
  const [retryingCampaignId, setRetryingCampaignId] = useState('');

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
    for (const p of [...extraFormPeople, ...formPeople, ...leads, ...members]) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    return out;
  }, [campaignLeads, marketingMembers, formPeople, extraFormPeople]);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) setLoading(true);
    try {
      const [draftsRes, campaignsRes, membersRes] = await Promise.all([
        api.marketing.emailDrafts(mineOnly ? { mine: true } : undefined),
        api.marketing.emailCampaigns(mineOnly ? { mine: true } : undefined),
        api.marketing.members().catch(() => ({ data: [] })),
      ]);
      const draftsData = phpList(draftsRes);
      const campaignsData = phpList(campaignsRes);
      setDrafts(draftsData);
      setCampaigns(campaignsData);
      setMarketingMembers(phpList(membersRes));
      if (!silent) setCampaignLeads([]);
      if (campaignsData.length > 0) {
        const sendsRes = await api.marketing.emailSends(campaignsData.map((c: any) => c.id));
        setSends(phpList(sendsRes));
      } else {
        setSends([]);
      }
    } catch (err: any) {
      if (!silent) toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Draft CRUD
  const resetDraftPdf = () => {
    setDraftPdfFile(null);
    setDraftPdfName('');
    setDraftPdfRemove(false);
    if (draftPdfInputRef.current) draftPdfInputRef.current.value = '';
  };

  const chooseDraftPdf = (file: File | null) => {
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      toast({ variant: 'destructive', title: 'Attachment must be a PDF' });
      if (draftPdfInputRef.current) draftPdfInputRef.current.value = '';
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast({ variant: 'destructive', title: 'PDF must be 50 MB or smaller' });
      if (draftPdfInputRef.current) draftPdfInputRef.current.value = '';
      return;
    }
    setDraftPdfFile(file);
    setDraftPdfName(file.name);
    setDraftPdfRemove(false);
  };

  const saveDraft = async () => {
    if (!draftName.trim()) { toast({ variant: 'destructive', title: 'Draft name is required' }); return; }
    if (!draftSubject.trim()) { toast({ variant: 'destructive', title: 'Subject is required' }); return; }
    setSavingDraft(true);
    const hadSavedPdf = Boolean(editingDraft?.attachment_name);
    try {
      let id = editingDraft?.id ? String(editingDraft.id) : '';
      if (id) {
        await api.marketing.updateEmailDraft(id, { name: draftName, subject: draftSubject, html_body: draftBody });
      } else {
        const created = await api.marketing.createEmailDraft({ name: draftName, subject: draftSubject, html_body: draftBody });
        id = String(created?.id || '');
        if (!id) throw new Error('Draft was saved without an id');
        setEditingDraft({ id, name: draftName, subject: draftSubject, html_body: draftBody, attachment_name: '' });
      }
      if (draftPdfFile) {
        const uploaded = await api.marketing.uploadEmailDraftAttachment(id, draftPdfFile);
        setEditingDraft((prev: any) => prev ? { ...prev, attachment_name: uploaded?.attachment_name || draftPdfFile.name } : prev);
      } else if (draftPdfRemove && hadSavedPdf) {
        await api.marketing.deleteEmailDraftAttachment(id);
      }
      toast({ title: editingDraft ? 'Draft updated' : 'Draft saved' });
      setShowEditor(false);
      setEditingDraft(null);
      setDraftName('');
      setDraftSubject('');
      setDraftBody('');
      resetDraftPdf();
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
    resetDraftPdf();
    if (draft) {
      setEditingDraft(draft);
      setDraftName(draft.name || '');
      setDraftSubject(draft.subject);
      setDraftBody(draft.html_body || '');
      setDraftPdfName(String(draft.attachment_name || ''));
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

  useEffect(() => {
    const t = searchParams.get('tab') || '';
    const next = marketingTabs.includes(t as (typeof marketingTabs)[number]) ? t : 'form_leads';
    if (next !== activeTab) setActiveTab(next);
  }, [searchParams]);

  const changeTab = (value: string) => {
    setActiveTab(value);
    const next = new URLSearchParams(searchParams);
    if (value === 'form_leads') next.delete('tab');
    else next.set('tab', value);
    setSearchParams(next, { replace: true });
  };

  // Bulk send
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const found = parseManualEmailEntries(text);
      if (found.length === 0) {
        toast({ variant: 'destructive', title: 'No emails found in file' });
        return;
      }
      setBulkEmails((prev) => {
        const byEmail = new Map(parseManualEmailEntries(prev).map((e) => [e.email.toLowerCase(), e]));
        for (const row of found) {
          const key = row.email.toLowerCase();
          const existing = byEmail.get(key);
          if (!existing) byEmail.set(key, row);
          else if (row.name && !existing.name) existing.name = row.name;
        }
        return Array.from(byEmail.values()).map(formatManualEmailLine).join('\n');
      });
      toast({ title: `Found ${found.length} email${found.length === 1 ? '' : 's'} from file` });
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
    const rowsReady = fillRows.map((r) => ({
      ...r,
      values: syncNamePlaceholderValues(r.name, keys, r.values),
    }));
    const incomplete = rowsReady.find((r) => !placeholderValuesComplete(keys, r.values));
    if (incomplete) {
      const missing = keys.filter((k) => String(incomplete.values[k] ?? '').trim() === '');
      toast({
        variant: 'destructive',
        title: 'Fill all placeholders',
        description: missing.some((k) => isNamePlaceholderKey(k))
          ? `Enter a name for ${incomplete.email} (used for <<name>>).`
          : `Complete <<${missing[0] || 'fields'}>> for ${incomplete.email} before sending.`,
      });
      return;
    }

    setSending(true);
    try {
      const res = await api.marketing.dispatchEmailCampaign({
        draft_id: selectedDraftId,
        smtp_account_id: smtpAccountId,
        scheduled_at: campaignSchedule || null,
        recipients: rowsReady.map((r) => ({
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
        description: [failed ? `${failed} failed` : '', pending ? `${pending} queued` : ''].filter(Boolean).join(' · ') || 'Delivered via your organization mailbox.',
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
  const extraPlaceholderKeys = useMemo(
    () => placeholderKeys.filter((k) => !isNamePlaceholderKey(k)),
    [placeholderKeys],
  );
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

  const openSendFromFormLeads = () => {
    if (!selectedFormId) {
      toast({ variant: 'destructive', title: 'Select a form first' });
      return;
    }
    const ticked = selectedRecipientIds.filter((id) => formPeople.some((p) => p.id === id));
    if (ticked.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Tick form leads to send',
        description: 'Only ticked leads with an email are sent the draft.',
      });
      return;
    }
    setShowBulkSend(true);
  };

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
        const auto = autofillPlaceholderValues(
          { ...(person || {}), name: d.name || person?.name || existing?.name || '', email: d.email },
          placeholderKeys,
        );
        const values: Record<string, string> = {};
        for (const k of placeholderKeys) {
          const prevVal = existing?.values?.[k];
          values[k] = prevVal != null && String(prevVal).trim() !== '' ? String(prevVal) : (auto[k] || '');
        }
        const name = String(existing?.name || d.name || person?.name || values.name || '').trim();
        return {
          key: existing?.key ?? d.email.toLowerCase(),
          email: d.email,
          name,
          values: syncNamePlaceholderValues(name, placeholderKeys, values),
          scheduledAt: existing?.scheduledAt ?? '',
        };
      });
    });
  }, [showBulkSend, selectedRecipientIds, bulkEmails, recipientPeople, placeholderKeys]);

  const onLeadSearch = useCallback((q: string) => {
    if (leadSearchTimer.current) window.clearTimeout(leadSearchTimer.current);
    const query = q.trim();
    if (query.length < 1) return;
    leadSearchTimer.current = window.setTimeout(() => {
      void searchAccessibleLeads(query)
        .then(({ leads }) => {
          if (!leads.length) return;
          setCampaignLeads((prev) => {
            const byId = new Map(prev.map((l) => [String(l.id), l]));
            for (const row of leads) {
              if (row.id) byId.set(row.id, row);
            }
            return Array.from(byId.values());
          });
        })
        .catch(() => undefined);
    }, 300);
  }, []);

  const sendsByCampaign = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const row of sends) {
      const id = String(row.campaign_id || '');
      if (!id) continue;
      const list = map.get(id);
      if (list) list.push(row);
      else map.set(id, [row]);
    }
    return map;
  }, [sends]);

  const anyCampaignSending = useMemo(
    () => campaigns.some((c) => campaignDisplaySummary(sendsByCampaign.get(String(c.id)) || [], c.status).status === 'sending'),
    [campaigns, sendsByCampaign],
  );
  const fetchAllRef = useRef(fetchAll);
  fetchAllRef.current = fetchAll;
  useEffect(() => {
    if (!anyCampaignSending) return;
    const timer = window.setInterval(() => {
      void fetchAllRef.current({ silent: true });
    }, 15000);
    return () => window.clearInterval(timer);
  }, [anyCampaignSending]);

  const retryCampaign = async (campaign: { id?: string }) => {
    const id = String(campaign.id || '');
    if (!id || retryingCampaignId) return;
    setRetryingCampaignId(id);
    try {
      const res = await api.marketing.retryEmailCampaign(id);
      const queued = Number(res?.queued ?? 0);
      if (queued <= 0) {
        throw new Error(res?.error || res?.message || 'No failed emails to retry');
      }
      toast({
        title: res?.message || `Sending ${queued}. You can leave this page; they go out about every 3 seconds.`,
      });
      await fetchAll({ silent: true });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Retry failed', description: err.message });
    } finally {
      setRetryingCampaignId('');
    }
  };

  // Stats follow the email log: a row counts as sent only when it has a send time.
  const sendTotals = useMemo(() => {
    let sent = 0;
    let failed = 0;
    let pending = 0;
    for (const row of sends) {
      const tone = emailSendOutcome(row).tone;
      if (tone === 'sent') sent += 1;
      else if (tone === 'pending') pending += 1;
      else failed += 1;
    }
    return { sent, failed, pending };
  }, [sends]);
  const totalSent = sendTotals.sent;
  const totalFailed = sendTotals.failed;
  const totalPending = sendTotals.pending;

  const campaignLogRequest = useRef(0);
  const openCampaignLog = (campaign: any) => {
    const request = campaignLogRequest.current + 1;
    campaignLogRequest.current = request;
    const cached = sendsByCampaign.get(String(campaign.id)) || [];
    setCampaignLog(campaign);
    setCampaignLogRows(cached);
    setCampaignLogLoading(true);
    void api.marketing.emailSends([String(campaign.id)])
      .then((res) => {
        if (campaignLogRequest.current !== request) return;
        setCampaignLogRows(phpList(res));
      })
      .catch(() => {
        if (campaignLogRequest.current !== request) return;
        setCampaignLogRows(cached);
      })
      .finally(() => {
        if (campaignLogRequest.current !== request) return;
        setCampaignLogLoading(false);
      });
  };

  const filteredSends = sends.filter(s => {
    const outcome = emailSendOutcome(s);
    if (statusFilter === 'sent' && outcome.tone !== 'sent') return false;
    if (statusFilter === 'failed' && outcome.tone !== 'failed') return false;
    if (statusFilter === 'pending' && outcome.tone !== 'pending') return false;
    if (searchQuery && !s.recipient_email?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  if (loading && activeTab !== 'analytics') return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

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
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openEditor()}>
            <Plus className="h-3.5 w-3.5" />New Draft
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setShowBulkSend(true)}>
            <Send className="h-3.5 w-3.5" />Send Campaign
          </Button>
        </div>
      </div>

      {activeTab !== 'analytics' ? (
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
            <p className="text-lg md:text-xl font-bold text-blue-600">{formLeadRows.length}</p>
          </CardContent>
        </Card>
      </div>
      ) : null}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={changeTab}>
        <TabsList className="w-full md:w-auto">
          <TabsTrigger value="form_leads" className="text-xs gap-1"><Users className="h-3 w-3" />Form Leads</TabsTrigger>
          <TabsTrigger value="drafts" className="text-xs gap-1"><FileText className="h-3 w-3" />Drafts</TabsTrigger>
          <TabsTrigger value="campaigns" className="text-xs gap-1"><Send className="h-3 w-3" />Campaigns</TabsTrigger>
          <TabsTrigger value="history" className="text-xs gap-1"><Mail className="h-3 w-3" />Email History</TabsTrigger>
          <TabsTrigger value="analytics" className="text-xs gap-1"><BarChart3 className="h-3 w-3" />Analytics</TabsTrigger>
        </TabsList>

        {/* Form Leads */}
        <TabsContent value="form_leads">
          <FormLeadsCampaignTab
            forms={campaignForms}
            formsLoading={campaignFormsLoading}
            selectedFormId={selectedFormId}
            onSelectedFormIdChange={(id) => {
              setSelectedFormId(id);
              setSelectedRecipientIds([]);
            }}
            leads={formLeadRows}
            leadsLoading={formLeadsLoading}
            destination={formLeadDestination}
            selectedIds={selectedRecipientIds}
            onSelectedIdsChange={setSelectedRecipientIds}
            contactKind="email"
            onSendSelected={openSendFromFormLeads}
          />
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
                      {d.attachment_name ? ` · PDF: ${d.attachment_name}` : ''}
                      {d.created_by_name ? ` · ${d.created_by_name}` : ''}
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
                    ) : campaigns.map(c => {
                      const summary = campaignDisplaySummary(sendsByCampaign.get(String(c.id)) || [], c.status);
                      const recipients = summary.total > 0 ? summary.total : Number(c.recipient_count || 0);
                      return (
                      <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openCampaignLog(c)}>
                        <TableCell className="text-sm font-medium max-w-[200px] truncate">{c.subject}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{format(new Date(c.created_at), 'dd MMM HH:mm')}</TableCell>
                        <TableCell className="text-center text-sm">{recipients}</TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">{summary.sent}</Badge></TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">{summary.failed}</Badge></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={
                              summary.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                              summary.status === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
                              summary.status === 'sending' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                              'bg-amber-50 text-amber-700 border-amber-200'
                            }>{summary.label}</Badge>
                            {campaignCanRetry(summary) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                disabled={retryingCampaignId === String(c.id)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void retryCampaign(c);
                                }}
                              >
                                {retryingCampaignId === String(c.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Retry'}
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                      );
                    })}
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
                    <SelectItem value="pending">Scheduled</SelectItem>
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
                    ) : filteredSends.map(s => {
                      const outcome = emailSendOutcome(s);
                      return (
                      <TableRow key={s.id}>
                        <TableCell className="text-sm">{s.recipient_email}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            outcome.tone === 'sent' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            outcome.tone === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
                            'bg-amber-50 text-amber-700 border-amber-200'
                          }>{outcome.label}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.scheduled_at ? format(new Date(s.scheduled_at), 'dd MMM HH:mm') : '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{outcome.tone === 'sent' && s.sent_at ? format(new Date(s.sent_at), 'dd MMM HH:mm') : '—'}</TableCell>
                        <TableCell className="text-xs text-red-600 max-w-[360px] whitespace-normal">{outcome.reason || '—'}</TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics">
          <EmailAnalytics embedded />
        </TabsContent>
      </Tabs>

      <Dialog open={!!campaignLog} onOpenChange={(open) => { if (!open) setCampaignLog(null); }}>
        <DialogContent className="max-w-4xl max-h-[min(90dvh,100%)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{campaignLog?.subject || 'Campaign emails'}</DialogTitle>
          </DialogHeader>
          {campaignLogLoading ? <p className="text-xs text-muted-foreground">Loading email log…</p> : null}
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
                {campaignLogRows.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No emails for this campaign</TableCell></TableRow>
                ) : campaignLogRows.map((s) => {
                  const outcome = emailSendOutcome(s);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="text-sm">{s.recipient_email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={
                          outcome.tone === 'sent' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          outcome.tone === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
                          'bg-amber-50 text-amber-700 border-amber-200'
                        }>{outcome.label}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.scheduled_at ? format(new Date(s.scheduled_at), 'dd MMM HH:mm') : '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{outcome.tone === 'sent' && s.sent_at ? format(new Date(s.sent_at), 'dd MMM HH:mm') : '—'}</TableCell>
                      <TableCell className="text-xs text-red-600 max-w-[360px] whitespace-normal">{outcome.reason || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Draft Editor Dialog */}
      <Dialog open={showEditor} onOpenChange={(open) => { setShowEditor(open); if (!open) { setEditingDraft(null); setDraftName(''); setDraftSubject(''); setDraftBody(''); resetDraftPdf(); } }}>
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
              <div className="flex items-center gap-2 min-w-0 md:mr-1">
                <input
                  ref={draftPdfInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    chooseDraftPdf(e.target.files?.[0] ?? null);
                    e.target.value = '';
                  }}
                />
                <Button type="button" variant="outline" className="gap-1.5" onClick={() => draftPdfInputRef.current?.click()}>
                  <Paperclip className="h-4 w-4" />Attachment
                </Button>
                {draftPdfName ? (
                  <>
                    <span className="text-xs text-muted-foreground truncate max-w-[180px]" title={draftPdfName}>{draftPdfName}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => {
                        setDraftPdfFile(null);
                        setDraftPdfName('');
                        setDraftPdfRemove(true);
                        if (draftPdfInputRef.current) draftPdfInputRef.current.value = '';
                      }}
                      aria-label="Remove attachment"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : null}
              </div>
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
        <DialogContent className="max-w-4xl w-[min(56rem,calc(100%-1.5rem))] max-h-[92vh] overflow-hidden flex flex-col">
          <DialogHeader><DialogTitle>Email Preview</DialogTitle></DialogHeader>
          <div className="border rounded-lg overflow-hidden flex flex-col min-h-0">
            <div className="bg-muted/50 px-4 py-2.5 border-b shrink-0">
              <p className="text-xs text-muted-foreground">Subject:</p>
              <p className="text-sm font-semibold">{draftSubject || '(No subject)'}</p>
            </div>
            <iframe
              title="Email body preview"
              sandbox=""
              srcDoc={emailPreviewSrcDoc(draftBody)}
              className="w-full h-[min(72vh,760px)] bg-white border-0"
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Send Dialog */}
      <Dialog open={showBulkSend} onOpenChange={(open) => {
        setShowBulkSend(open);
        if (!open) {
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
              forms={campaignForms}
              formsLoading={campaignFormsLoading}
              selectedFormId={selectedFormId}
              onSelectedFormIdChange={setSelectedFormId}
              formPeople={formPeople}
              formPeopleLoading={formLeadsLoading}
            />
            {fillRows.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">
                  Type a name for pasted emails. CRM leads fill it automatically. This value is used for {'<<name>>'}.
                </p>
                <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs sticky left-0 bg-background min-w-[200px]">Recipient</TableHead>
                      {extraPlaceholderKeys.map((k) => (
                        <TableHead key={k} className="text-xs font-mono min-w-[140px]">{`<<${k}>>`}</TableHead>
                      ))}
                      <TableHead className="text-xs min-w-[190px]">Schedule</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fillRows.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="text-xs sticky left-0 bg-background space-y-1">
                          <Input
                            className={`h-8 text-xs${placeholderKeys.some(isNamePlaceholderKey) && !String(row.name).trim() ? ' border-amber-400' : ''}`}
                            placeholder="Recipient name"
                            value={row.name}
                            onChange={(e) => {
                              const name = e.target.value;
                              setFillRows((prev) => prev.map((r) => (
                                r.key === row.key
                                  ? { ...r, name, values: syncNamePlaceholderValues(name, placeholderKeys, r.values) }
                                  : r
                              )));
                            }}
                          />
                          <div className="text-muted-foreground truncate max-w-[220px] px-0.5">{row.email}</div>
                        </TableCell>
                        {extraPlaceholderKeys.map((k) => (
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
