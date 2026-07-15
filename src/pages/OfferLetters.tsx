import { useState, useEffect, useRef, useCallback, MouseEvent as ReactMouseEvent } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Plus, FileText, Send, Trash2, Edit, Eye, Upload, Download, Code, Type, Loader2, Mail, Copy, Image, GripVertical, Users, X, ChevronLeft, ChevronRight, Maximize2, Minimize2, FilePlus
} from 'lucide-react';
import { format } from 'date-fns';

interface OfferTemplate {
  id: string;
  template_name: string;
  role_title: string;
  html_content: string;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface SentLetter {
  id: string;
  template_id: string | null;
  recipient_name: string;
  recipient_email: string;
  role_title: string;
  html_content: string;
  pdf_url: string | null;
  status: string;
  sent_by: string;
  sent_at: string;
}

// Simple offer letter template that uses a letterhead background image
const DEFAULT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Georgia', 'Times New Roman', serif;
    width: 210mm;
    height: 297mm;
    margin: 0 auto;
    color: #1a1a2e;
    line-height: 1.7;
    font-size: 12pt;
    position: relative;
    overflow: hidden;
  }
  .letterhead-bg {
    position: absolute;
    top: 0; left: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    object-fit: contain;
    object-position: top center;
  }
  .content-area {
    position: relative;
    z-index: 1;
    padding: 55mm 28mm 25mm 28mm;
  }
  .subject-line {
    text-align: center;
    font-size: 14pt;
    font-weight: 700;
    color: #1e3a5f;
    text-transform: uppercase;
    letter-spacing: 2px;
    margin: 0 0 18pt 0;
    padding-bottom: 8pt;
    border-bottom: 2px solid #2563eb;
  }
  .date-line {
    text-align: right;
    font-size: 10pt;
    color: #64748b;
    margin-bottom: 14pt;
  }
  .salutation {
    font-size: 12pt;
    margin-bottom: 10pt;
  }
  .body-text {
    font-size: 11pt;
    text-align: justify;
    margin-bottom: 8pt;
    line-height: 1.65;
  }
  .details-table {
    width: 100%;
    border-collapse: collapse;
    margin: 14pt 0;
    font-family: 'Segoe UI', Arial, sans-serif;
  }
  .details-table td {
    padding: 6pt 10pt;
    font-size: 10pt;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: top;
  }
  .details-table td:first-child {
    width: 38%;
    font-weight: 600;
    color: #1e3a5f;
    background: rgba(248,250,252,0.8);
  }
  .details-table td:last-child {
    color: #334155;
  }
  .terms-section {
    margin: 14pt 0;
    padding: 10pt 14pt;
    background: rgba(248,250,252,0.85);
    border-left: 3px solid #2563eb;
    border-radius: 0 4px 4px 0;
  }
  .terms-section h3 {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 10pt;
    font-weight: 700;
    color: #1e3a5f;
    margin-bottom: 6pt;
    text-transform: uppercase;
  }
  .terms-section ul {
    padding-left: 16pt;
    font-size: 9.5pt;
    color: #475569;
    font-family: 'Segoe UI', Arial, sans-serif;
  }
  .terms-section li { margin-bottom: 3pt; line-height: 1.5; }
  .signature-area {
    margin-top: 24pt;
    display: flex;
    justify-content: space-between;
  }
  .sig-block { width: 44%; }
  .sig-block .line {
    border-top: 1px solid #334155;
    margin-top: 36pt;
    padding-top: 5pt;
  }
  .sig-block p {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 9pt;
    color: #64748b;
    margin-bottom: 2pt;
  }
  .sig-block .name {
    font-size: 10.5pt;
    font-weight: 700;
    color: #1a1a2e;
  }
</style>
</head>
<body>
  <img class="letterhead-bg" src="{{letterhead_url}}" alt="" />
  <div class="content-area">
    <p class="date-line">Ref: {{ref_number}} &nbsp;|&nbsp; {{date}}</p>
    <div class="subject-line">Offer of Employment</div>

    <p class="salutation">Dear <strong>{{candidate_name}}</strong>,</p>

    <p class="body-text">
      We are delighted to extend this offer of employment to you for the position of
      <strong>{{role_title}}</strong> at <strong>{{company_name}}</strong>. After a thorough
      evaluation of your qualifications, experience, and professional achievements, we are
      confident that you will make an exceptional contribution to our organization.
    </p>

    <p class="body-text">Please find below the details of your employment:</p>

    <table class="details-table">
      <tr><td>Position / Designation</td><td>{{role_title}}</td></tr>
      <tr><td>Department</td><td>{{department}}</td></tr>
      <tr><td>Date of Joining</td><td>{{start_date}}</td></tr>
      <tr><td>Compensation (CTC)</td><td>{{salary}}</td></tr>
      <tr><td>Reporting Manager</td><td>{{reporting_to}}</td></tr>
      <tr><td>Work Location</td><td>{{work_location}}</td></tr>
      <tr><td>Employment Type</td><td>{{employment_type}}</td></tr>
    </table>

    <div class="terms-section">
      <h3>Terms & Conditions</h3>
      <ul>
        <li>This offer is subject to successful completion of background verification.</li>
        <li>You will be on a probationary period of {{probation_period}} from date of joining.</li>
        <li>Your detailed compensation structure and policies will be shared upon joining.</li>
        <li>This offer letter is confidential and intended solely for the addressee.</li>
      </ul>
    </div>

    <p class="body-text">
      To accept this offer, please sign and return a copy by <strong style="color:#dc2626;">{{deadline}}</strong>.
    </p>

    <p class="body-text">We look forward to a mutually rewarding professional relationship.</p>

    <div class="signature-area">
      <div class="sig-block">
        <p style="font-weight:700; color:#1a1a2e; font-size:10.5pt;">Regards,</p>
        <div class="line">
          <p class="name">{{sender_name}}</p>
          <p>{{sender_title}}</p>
          <p>{{sender_email}}</p>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

// Professional email body HTML template
const generateEmailBody = (form: typeof INITIAL_SEND_FORM) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:30px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:35px 40px;text-align:center;">
      <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:1px;">${form.company_name || 'Company Name'}</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:13px;letter-spacing:0.5px;">Official Communication</p>
    </td>
  </tr>
  <!-- Body -->
  <tr>
    <td style="padding:40px;">
      <p style="font-size:16px;color:#1a1a2e;margin:0 0 20px;line-height:1.6;">
        Dear <strong>${form.recipient_name || 'Candidate'}</strong>,
      </p>
      <p style="font-size:14px;color:#475569;margin:0 0 18px;line-height:1.7;">
        We are pleased to inform you that after careful consideration of your application and
        interview process, the management team at <strong>${form.company_name || 'our organization'}</strong>
        has decided to offer you the position of <strong>${form.role_title || 'the designated role'}</strong>
        in our <strong>${form.department || 'team'}</strong>.
      </p>
      <p style="font-size:14px;color:#475569;margin:0 0 18px;line-height:1.7;">
        Your qualifications, skills, and professional demeanor demonstrated during the selection
        process have impressed us, and we believe you will be an invaluable asset to our growing team.
      </p>
      <!-- Highlight Box -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:25px 0;">
        <tr><td style="background:#f0f7ff;border-left:4px solid #2563eb;border-radius:0 8px 8px 0;padding:20px 24px;">
          <p style="margin:0 0 8px;font-size:13px;color:#1e3a5f;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Offer Summary</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:4px 0;font-size:13px;color:#64748b;width:45%;">Position:</td><td style="padding:4px 0;font-size:13px;color:#1a1a2e;font-weight:600;">${form.role_title || '—'}</td></tr>
            <tr><td style="padding:4px 0;font-size:13px;color:#64748b;">Department:</td><td style="padding:4px 0;font-size:13px;color:#1a1a2e;font-weight:600;">${form.department || '—'}</td></tr>
            <tr><td style="padding:4px 0;font-size:13px;color:#64748b;">Joining Date:</td><td style="padding:4px 0;font-size:13px;color:#1a1a2e;font-weight:600;">${form.start_date || '—'}</td></tr>
            <tr><td style="padding:4px 0;font-size:13px;color:#64748b;">Compensation:</td><td style="padding:4px 0;font-size:13px;color:#1a1a2e;font-weight:600;">${form.salary || '—'}</td></tr>
          </table>
        </td></tr>
      </table>
      <p style="font-size:14px;color:#475569;margin:0 0 18px;line-height:1.7;">
        Please find the <strong>official Offer Letter</strong> attached as a PDF document with this email.
        Kindly review the terms and conditions outlined in the letter carefully.
      </p>
      <p style="font-size:14px;color:#475569;margin:0 0 18px;line-height:1.7;">
        To formally accept this offer, please sign the attached offer letter and send a scanned copy
        to <strong>${form.sender_email || 'hr@syncpedia.in'}</strong> by
        <strong style="color:#dc2626;">${form.deadline || 'the specified deadline'}</strong>.
      </p>
      <!-- CTA Button -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:25px 0;">
        <tr><td align="center">
          <table cellpadding="0" cellspacing="0">
            <tr><td style="background:#1e3a5f;border-radius:8px;padding:14px 35px;">
              <span style="color:#ffffff;font-size:14px;font-weight:600;letter-spacing:0.5px;">📎 Offer Letter Attached (PDF)</span>
            </td></tr>
          </table>
        </td></tr>
      </table>
      <p style="font-size:14px;color:#475569;margin:0 0 18px;line-height:1.7;">
        Should you have any questions or require clarification regarding the offer, please do not
        hesitate to reach out to the undersigned.
      </p>
      <p style="font-size:14px;color:#475569;margin:0 0 5px;line-height:1.7;">
        We are excited about your potential contribution to ${form.company_name || 'our organization'}
        and look forward to welcoming you aboard.
      </p>
      <!-- Signature -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:30px;border-top:1px solid #e2e8f0;padding-top:20px;">
        <tr><td>
          <p style="margin:0 0 3px;font-size:13px;color:#64748b;">Warm regards,</p>
          <p style="margin:8px 0 2px;font-size:15px;color:#1a1a2e;font-weight:700;">${form.sender_name || 'HR Team'}</p>
          <p style="margin:0 0 2px;font-size:13px;color:#64748b;">${form.sender_title || 'Human Resources'}</p>
          <p style="margin:0 0 2px;font-size:13px;color:#64748b;">${form.company_name || ''}</p>
          <p style="margin:0;font-size:13px;color:#2563eb;">${form.sender_email || ''}</p>
        </td></tr>
      </table>
    </td>
  </tr>
  <!-- Footer -->
  <tr>
    <td style="background:#1e3a5f;padding:20px 40px;text-align:center;">
      <p style="margin:0 0 5px;color:rgba(255,255,255,0.9);font-size:12px;font-weight:600;">${form.company_name || 'Company'}</p>
      <p style="margin:0 0 5px;color:rgba(255,255,255,0.6);font-size:11px;">${form.company_address || ''}</p>
      <p style="margin:0;color:rgba(255,255,255,0.5);font-size:10px;">This email and any attachments are confidential and intended for the named recipient only.</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;

type OfferEmailDraft = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  attachmentName: string;
};

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildDefaultOfferEmailPlainText(form: typeof INITIAL_SEND_FORM): string {
  const senderEmail = form.sender_email?.trim() || 'hr@syncpedia.in';
  return `Dear ${form.recipient_name || 'Candidate'},

We are pleased to inform you that after careful consideration of your application and interview process, the management team at ${form.company_name || 'our organization'} has decided to offer you the position of ${form.role_title || 'the designated role'} in our ${form.department || 'team'}.

Your qualifications, skills, and professional demeanor demonstrated during the selection process have impressed us, and we believe you will be an invaluable asset to our growing team.

Offer summary:
• Position: ${form.role_title || '—'}
• Department: ${form.department || '—'}
• Joining date: ${form.start_date || '—'}
• Compensation: ${form.salary || '—'}

Please find the official Offer Letter attached as a PDF document with this email. Kindly review the terms and conditions outlined in the letter carefully.

To formally accept this offer, please sign the attached offer letter and send a scanned copy to ${senderEmail} by ${form.deadline || 'the specified deadline'}.

Should you have any questions or require clarification regarding the offer, please do not hesitate to reach out to the undersigned.

We are excited about your potential contribution to ${form.company_name || 'our organization'} and look forward to welcoming you aboard.

Warm regards,
${form.sender_name || 'HR Team'}
${form.sender_title || 'Human Resources'}
${form.company_name || ''}
${senderEmail}`;
}

function buildDefaultOfferEmailDraft(form: typeof INITIAL_SEND_FORM): OfferEmailDraft {
  const attachmentName = `Offer_Letter_${(form.recipient_name || 'Candidate').replace(/\s+/g, '_')}.pdf`;
  return {
    to: form.recipient_email?.trim() || '',
    cc: '',
    bcc: '',
    subject: `Offer Letter — ${form.role_title || 'Position'} — ${form.company_name || 'Syncpedia'}`,
    body: buildDefaultOfferEmailPlainText(form),
    attachmentName,
  };
}

/** Wrap edited plain-text body in the branded offer-letter email shell. */
function wrapOfferEmailPlainBody(plainBody: string, form: typeof INITIAL_SEND_FORM): string {
  const paragraphs = plainBody
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        `<p style="font-size:14px;color:#475569;margin:0 0 18px;line-height:1.7;white-space:pre-wrap;">${escapeHtmlText(block).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:30px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <tr>
    <td style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:35px 40px;text-align:center;">
      <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:1px;">${escapeHtmlText(form.company_name || 'Company Name')}</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:13px;letter-spacing:0.5px;">Official Communication</p>
    </td>
  </tr>
  <tr>
    <td style="padding:40px;">
      ${paragraphs}
    </td>
  </tr>
  <tr>
    <td style="background:#1e3a5f;padding:20px 40px;text-align:center;">
      <p style="margin:0 0 5px;color:rgba(255,255,255,0.9);font-size:12px;font-weight:600;">${escapeHtmlText(form.company_name || 'Company')}</p>
      <p style="margin:0 0 5px;color:rgba(255,255,255,0.6);font-size:11px;">${escapeHtmlText(form.company_address || '')}</p>
      <p style="margin:0;color:rgba(255,255,255,0.5);font-size:10px;">This email and any attachments are confidential and intended for the named recipient only.</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

const PLACEHOLDERS = [
  '{{candidate_name}}', '{{role_title}}', '{{company_name}}', '{{date}}',
  '{{department}}', '{{start_date}}', '{{salary}}', '{{reporting_to}}',
  '{{deadline}}', '{{sender_name}}', '{{sender_title}}', '{{sender_email}}',
  '{{company_address}}', '{{company_website}}', '{{company_phone}}',
  '{{ref_number}}', '{{work_location}}', '{{employment_type}}', '{{probation_period}}'
];

const INITIAL_SEND_FORM = {
  recipient_name: '', recipient_email: '', role_title: '', company_name: 'Syncpedia Technologies',
  department: '', start_date: '', salary: '', reporting_to: '',
  deadline: '', sender_name: '', sender_title: '', sender_email: 'hr@syncpedia.in',
  company_address: '', company_website: '', company_phone: '',
  ref_number: '', work_location: '', employment_type: 'Full-Time', probation_period: '6 months'
};

export default function OfferLetters() {
  const { user, role } = useAuth();
  const { toast } = useToast();
  // Template/sent delete is admin/org only (API requireRole); managers can create/send.
  const canDeleteTemplates = ["super_admin", "admin", "org"].includes(String(role || "").toLowerCase());
  const isMobile = useIsMobile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const letterheadInputRef = useRef<HTMLInputElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [resizeEdge, setResizeEdge] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const [templates, setTemplates] = useState<OfferTemplate[]>([]);
  const [sentLetters, setSentLetters] = useState<SentLetter[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('templates');

  const [showEditor, setShowEditor] = useState(false);
  const [editorMode, setEditorMode] = useState<'visual' | 'html'>('visual');
  const [editingTemplate, setEditingTemplate] = useState<OfferTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState({ template_name: '', role_title: '', html_content: DEFAULT_TEMPLATE });
  const [letterheadImage, setLetterheadImage] = useState<string>('');
  const [contentPadding, setContentPadding] = useState({ top: 55, right: 28, bottom: 25, left: 28 });
  const [saving, setSaving] = useState(false);

  // Multi-page support
  const [pages, setPages] = useState<string[]>([DEFAULT_TEMPLATE]);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageLetterheads, setPageLetterheads] = useState<string[]>(['']);
  const [pagePaddings, setPagePaddings] = useState<{ top: number; right: number; bottom: number; left: number }[]>([{ top: 55, right: 28, bottom: 25, left: 28 }]);

  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');

  const [showSend, setShowSend] = useState(false);
  const [sendTab, setSendTab] = useState<'details' | 'letter' | 'email'>('details');
  const [sendTemplate, setSendTemplate] = useState<OfferTemplate | null>(null);
  const [sendForm, setSendForm] = useState({ ...INITIAL_SEND_FORM });
  const [emailDraft, setEmailDraft] = useState<OfferEmailDraft>({
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    body: '',
    attachmentName: '',
  });
  const [sending, setSending] = useState(false);

  // Bulk generation state
  interface BulkCandidate {
    id: string;
    candidate_name: string;
    recipient_email: string;
    role_title: string;
    department: string;
    start_date: string;
    salary: string;
    reporting_to: string;
    work_location: string;
    employment_type: string;
    probation_period: string;
    deadline: string;
  }
  const EMPTY_CANDIDATE = (): BulkCandidate => ({
    id: crypto.randomUUID(),
    candidate_name: '', recipient_email: '', role_title: '', department: '',
    start_date: '', salary: '', reporting_to: '', work_location: '',
    employment_type: 'Full-Time', probation_period: '6 months', deadline: ''
  });
  const [showBulk, setShowBulk] = useState(false);
  const [bulkTemplate, setBulkTemplate] = useState<OfferTemplate | null>(null);
  const [bulkCandidates, setBulkCandidates] = useState<BulkCandidate[]>([EMPTY_CANDIDATE()]);
  const [bulkCompany, setBulkCompany] = useState({ company_name: 'Syncpedia Technologies', company_address: '', sender_name: '', sender_title: '', sender_email: '', company_website: '', company_phone: '' });
  const [bulkGenerating, setBulkGenerating] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, sRes] = await Promise.all([api.offerLetters.templates(), api.offerLetters.sent()]);
      setTemplates(((tRes as any).data || []) as OfferTemplate[]);
      setSentLetters(((sRes as any).data || []) as SentLetter[]);
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error loading data', description: err.message }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  /** Refresh sent letters when opening that tab so new sends appear without a full reload. */
  useEffect(() => {
    if (activeTab === 'sent') {
      void fetchData();
    }
  }, [activeTab, fetchData]);

  const PAGE_SEPARATOR = '<!-- PAGE_BREAK -->';

  const splitPages = (html: string): string[] => {
    const parts = html.split(PAGE_SEPARATOR);
    return parts.length > 0 ? parts : [html];
  };

  const joinPages = (pgs: string[]): string => pgs.join(PAGE_SEPARATOR);

  const openNewTemplate = () => {
    setEditingTemplate(null);
    setTemplateForm({ template_name: '', role_title: '', html_content: DEFAULT_TEMPLATE });
    setLetterheadImage('');
    setContentPadding({ top: 55, right: 28, bottom: 25, left: 28 });
    setPages([DEFAULT_TEMPLATE]);
    setCurrentPage(0);
    setPageLetterheads(['']);
    setPagePaddings([{ top: 55, right: 28, bottom: 25, left: 28 }]);
    setEditorMode('visual');
    setShowEditor(true);
  };

  const openEditTemplate = (t: OfferTemplate) => {
    setEditingTemplate(t);
    setTemplateForm({ template_name: t.template_name, role_title: t.role_title, html_content: t.html_content });
    const pgs = splitPages(t.html_content);
    setPages(pgs);
    setCurrentPage(0);
    const letterheads = pgs.map(p => {
      const match = p.match(/class="letterhead-bg"\s+src="([^"]+)"/);
      return match && match[1] !== '{{letterhead_url}}' ? match[1] : '';
    });
    setPageLetterheads(letterheads);
    const paddings = pgs.map(p => extractPadding(p));
    setPagePaddings(paddings);
    setLetterheadImage(letterheads[0] || '');
    setContentPadding(paddings[0]);
    setEditorMode('visual');
    setShowEditor(true);
  };

  const syncTemplatFromPages = (pgs: string[]) => {
    setTemplateForm(f => ({ ...f, html_content: joinPages(pgs) }));
  };

  const updateCurrentPage = (html: string) => {
    setPages(prev => {
      const next = [...prev];
      next[currentPage] = html;
      syncTemplatFromPages(next);
      return next;
    });
  };

  const addPage = () => {
    const newPage = DEFAULT_TEMPLATE;
    setPages(prev => {
      const next = [...prev, newPage];
      syncTemplatFromPages(next);
      return next;
    });
    setPageLetterheads(prev => [...prev, '']);
    setPagePaddings(prev => [...prev, { top: 55, right: 28, bottom: 25, left: 28 }]);
    setCurrentPage(pages.length);
    setLetterheadImage('');
    setContentPadding({ top: 55, right: 28, bottom: 25, left: 28 });
  };

  const removePage = (idx: number) => {
    if (pages.length <= 1) return;
    setPages(prev => {
      const next = prev.filter((_, i) => i !== idx);
      syncTemplatFromPages(next);
      return next;
    });
    setPageLetterheads(prev => prev.filter((_, i) => i !== idx));
    setPagePaddings(prev => prev.filter((_, i) => i !== idx));
    const newIdx = Math.min(currentPage, pages.length - 2);
    setCurrentPage(newIdx);
    setLetterheadImage(pageLetterheads[newIdx] || '');
    setContentPadding(pagePaddings[newIdx] || { top: 55, right: 28, bottom: 25, left: 28 });
  };

  const switchPage = (idx: number) => {
    setCurrentPage(idx);
    setLetterheadImage(pageLetterheads[idx] || '');
    setContentPadding(pagePaddings[idx] || { top: 55, right: 28, bottom: 25, left: 28 });
  };

  const handleLetterheadUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ variant: 'destructive', title: 'Please upload an image file (PNG, JPG, etc.)' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setLetterheadImage(dataUrl);
      setPageLetterheads(prev => { const n = [...prev]; n[currentPage] = dataUrl; return n; });
      setPages(prev => {
        const next = [...prev];
        next[currentPage] = next[currentPage].replace(
          /class="letterhead-bg"\s+src="[^"]*"/,
          `class="letterhead-bg" src="${dataUrl}"`
        );
        syncTemplatFromPages(next);
        return next;
      });
      toast({ title: 'Letterhead uploaded', description: file.name });
    };
    reader.readAsDataURL(file);
    if (letterheadInputRef.current) letterheadInputRef.current.value = '';
  };

  const removeLetterhead = () => {
    setLetterheadImage('');
    setPageLetterheads(prev => { const n = [...prev]; n[currentPage] = ''; return n; });
    setPages(prev => {
      const next = [...prev];
      next[currentPage] = next[currentPage].replace(
        /class="letterhead-bg"\s+src="[^"]*"/,
        'class="letterhead-bg" src="{{letterhead_url}}"'
      );
      syncTemplatFromPages(next);
      return next;
    });
    toast({ title: 'Letterhead removed' });
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      updateCurrentPage(content);
      toast({ title: 'Template imported to page ' + (currentPage + 1), description: file.name });
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleExportTemplate = () => {
    const blob = new Blob([templateForm.html_content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${templateForm.template_name || 'offer-letter'}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveTemplate = async () => {
    if (!templateForm.template_name || !templateForm.role_title) {
      toast({ variant: 'destructive', title: 'Name and role title are required' }); return;
    }
    setSaving(true);
    try {
      if (editingTemplate) {
        await api.offerLetters.updateTemplate(editingTemplate.id, {
          template_name: templateForm.template_name,
          role_title: templateForm.role_title,
          html_content: templateForm.html_content,
          status: 'active',
        });
        toast({ title: 'Template updated' });
      } else {
        await api.offerLetters.createTemplate({
          template_name: templateForm.template_name,
          role_title: templateForm.role_title,
          html_content: templateForm.html_content,
          status: 'active',
        });
        toast({ title: 'Template created' });
      }
      setShowEditor(false);
      fetchData();
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
    finally { setSaving(false); }
  };

  const deleteTemplate = async (id: string) => {
    if (!canDeleteTemplates) {
      toast({ variant: 'destructive', title: 'Permission denied', description: 'Only admins can delete offer letter templates.' });
      return;
    }
    try {
      await api.offerLetters.deleteTemplate(id);
      toast({ title: 'Template deleted' });
      fetchData();
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
  };

  const openPreview = (html: string) => {
    setPreviewHtml(html);
    setShowPreview(true);
  };

  /** Opens server-stored PDF (PHP + Dompdf) or falls back to browser print from HTML. */
  const openSentLetterPdf = async (s: SentLetter) => {
    if (s.pdf_url) {
      try {
        const blob = await api.offerLetters.fetchSentPdfBlob(s.id);
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 120_000);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Could not open PDF';
        toast({ variant: 'destructive', title: 'PDF', description: msg });
      }
      return;
    }
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(buildPrintableHtml(s.html_content));
      w.document.close();
      setTimeout(() => w.print(), 500);
    }
  };

  const buildPrintableHtml = (html: string): string => {
    const pgs = splitPages(html);
    if (pgs.length <= 1) return html;
    return pgs.map((p, i) => {
      if (i < pgs.length - 1) {
        return p.replace('</body>', '<div style="page-break-after:always"></div></body>');
      }
      return p;
    }).join('\n');
  };

  const openSendDialog = (t: OfferTemplate) => {
    setSendTemplate(t);
    setSendTab('details');
    const refNum = `OL-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    setSendForm({
      ...INITIAL_SEND_FORM,
      role_title: t.role_title,
      sender_name: user?.full_name || '',
      sender_email: 'hr@syncpedia.in',
      ref_number: refNum,
    });
    setShowSend(true);
  };

  const replacePlaceholders = (html: string) => {
    return html
      .replace(/\{\{candidate_name\}\}/g, sendForm.recipient_name || '{{candidate_name}}')
      .replace(/\{\{role_title\}\}/g, sendForm.role_title || '{{role_title}}')
      .replace(/\{\{company_name\}\}/g, sendForm.company_name || '{{company_name}}')
      .replace(/\{\{date\}\}/g, format(new Date(), 'MMMM dd, yyyy'))
      .replace(/\{\{department\}\}/g, sendForm.department || '{{department}}')
      .replace(/\{\{start_date\}\}/g, sendForm.start_date || '{{start_date}}')
      .replace(/\{\{salary\}\}/g, sendForm.salary || '{{salary}}')
      .replace(/\{\{reporting_to\}\}/g, sendForm.reporting_to || '{{reporting_to}}')
      .replace(/\{\{deadline\}\}/g, sendForm.deadline || '{{deadline}}')
      .replace(/\{\{sender_name\}\}/g, sendForm.sender_name || '{{sender_name}}')
      .replace(/\{\{sender_title\}\}/g, sendForm.sender_title || '{{sender_title}}')
      .replace(/\{\{sender_email\}\}/g, sendForm.sender_email || '{{sender_email}}')
      .replace(/\{\{company_address\}\}/g, sendForm.company_address || '{{company_address}}')
      .replace(/\{\{company_website\}\}/g, sendForm.company_website || '{{company_website}}')
      .replace(/\{\{company_phone\}\}/g, sendForm.company_phone || '{{company_phone}}')
      .replace(/\{\{ref_number\}\}/g, sendForm.ref_number || '{{ref_number}}')
      .replace(/\{\{work_location\}\}/g, sendForm.work_location || '{{work_location}}')
      .replace(/\{\{employment_type\}\}/g, sendForm.employment_type || '{{employment_type}}')
      .replace(/\{\{probation_period\}\}/g, sendForm.probation_period || '{{probation_period}}');
  };

  const goToEmailCompose = () => {
    if (!sendForm.recipient_email?.trim() || !sendForm.recipient_name?.trim()) {
      toast({ variant: 'destructive', title: 'Recipient name and email required' });
      return;
    }
    setEmailDraft(buildDefaultOfferEmailDraft(sendForm));
    setSendTab('email');
  };

  const generatePdfAndSend = async () => {
    if (!sendForm.recipient_name?.trim()) {
      toast({ variant: 'destructive', title: 'Recipient name required' });
      return;
    }
    if (!emailDraft.to.trim() || !emailDraft.subject.trim() || !emailDraft.body.trim()) {
      toast({ variant: 'destructive', title: 'Missing email fields', description: 'To, subject and body are required.' });
      return;
    }
    setSending(true);
    try {
      const finalHtml = replacePlaceholders(sendTemplate!.html_content);
      const formForEmail = {
        ...sendForm,
        recipient_email: emailDraft.to.trim(),
        sender_email: sendForm.sender_email?.trim() || 'hr@syncpedia.in',
      };
      const emailHtml = wrapOfferEmailPlainBody(emailDraft.body.trim(), formForEmail);

      await api.offerLetters.send({
        template_id: sendTemplate!.id,
        recipient_name: sendForm.recipient_name,
        recipient_email: emailDraft.to.trim(),
        role_title: sendForm.role_title,
        html_content: finalHtml,
        email_subject: emailDraft.subject.trim(),
        email_html: emailHtml,
        attachment_name: emailDraft.attachmentName || `Offer_Letter_${sendForm.recipient_name.replace(/\s+/g, '_')}.pdf`,
        cc: emailDraft.cc.trim() || undefined,
        bcc: emailDraft.bcc.trim() || undefined,
        status: 'sent',
      });

      toast({
        title: 'Offer letter sent',
        description: `PDF generated and emailed to ${emailDraft.to.trim()} from hr@syncpedia.in`,
      });
      setShowSend(false);
      fetchData();
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
    finally { setSending(false); }
  };

  const insertPlaceholder = (placeholder: string) => {
    const updated = pages[currentPage] + placeholder;
    updateCurrentPage(updated);
  };

  const extractPadding = (html: string) => {
    const match = html.match(/\.content-area\s*\{[^}]*padding:\s*([\d.]+)mm\s+([\d.]+)mm\s+([\d.]+)mm\s+([\d.]+)mm/);
    if (match) return { top: parseFloat(match[1]), right: parseFloat(match[2]), bottom: parseFloat(match[3]), left: parseFloat(match[4]) };
    return { top: 55, right: 28, bottom: 25, left: 28 };
  };

  const updateContentPadding = useCallback((newPadding: { top: number; right: number; bottom: number; left: number }) => {
    setContentPadding(newPadding);
    setPagePaddings(prev => { const n = [...prev]; n[currentPage] = newPadding; return n; });
    setPages(prev => {
      const next = [...prev];
      next[currentPage] = next[currentPage].replace(
        /\.content-area\s*\{([^}]*?)padding:\s*[\d.]+mm\s+[\d.]+mm\s+[\d.]+mm\s+[\d.]+mm/,
        `.content-area {$1padding: ${newPadding.top}mm ${newPadding.right}mm ${newPadding.bottom}mm ${newPadding.left}mm`
      );
      syncTemplatFromPages(next);
      return next;
    });
  }, [currentPage]);

  // Draggable text box handlers
  const handleDragStart = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    setResizeEdge(null);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleResizeStart = (edge: string) => (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setResizeEdge(edge);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (!isDragging && !resizeEdge) return;
    const container = previewContainerRef.current;
    if (!container) return;

    const a4WidthMm = 210;
    const a4HeightMm = 297;
    const iframe = container.querySelector('iframe');
    if (!iframe) return;
    const iframeRect = iframe.getBoundingClientRect();
    const pxPerMmX = iframeRect.width / a4WidthMm;
    const pxPerMmY = iframeRect.height / a4HeightMm;

    const handleMouseMove = (ev: globalThis.MouseEvent) => {
      const dx = ev.clientX - dragStart.x;
      const dy = ev.clientY - dragStart.y;
      setDragStart({ x: ev.clientX, y: ev.clientY });

      const dxMm = dx / pxPerMmX;
      const dyMm = dy / pxPerMmY;

      setContentPadding(prev => {
        let next = { ...prev };

        if (isDragging) {
          next.top = prev.top + dyMm;
          next.bottom = prev.bottom - dyMm;
          next.left = prev.left + dxMm;
          next.right = prev.right - dxMm;
        } else if (resizeEdge) {
          if (resizeEdge.includes('t')) next.top = prev.top + dyMm;
          if (resizeEdge.includes('b')) next.bottom = prev.bottom - dyMm;
          if (resizeEdge.includes('l')) next.left = prev.left + dxMm;
          if (resizeEdge.includes('r')) next.right = prev.right - dxMm;
        }

        const rounded = {
          top: Math.round(Math.max(0, Math.min(200, next.top)) * 10) / 10,
          right: Math.round(Math.max(0, Math.min(150, next.right)) * 10) / 10,
          bottom: Math.round(Math.max(0, Math.min(200, next.bottom)) * 10) / 10,
          left: Math.round(Math.max(0, Math.min(150, next.left)) * 10) / 10,
        };

        setPagePaddings(prev => { const n = [...prev]; n[currentPage] = rounded; return n; });
        setPages(prev => {
          const next = [...prev];
          next[currentPage] = next[currentPage].replace(
            /\.content-area\s*\{([^}]*?)padding:\s*[\d.]+mm\s+[\d.]+mm\s+[\d.]+mm\s+[\d.]+mm/,
            `.content-area {$1padding: ${rounded.top}mm ${rounded.right}mm ${rounded.bottom}mm ${rounded.left}mm`
          );
          syncTemplatFromPages(next);
          return next;
        });
        return rounded;
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setResizeEdge(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, resizeEdge, dragStart, currentPage]);

  const duplicateTemplate = (t: OfferTemplate) => {
    setEditingTemplate(null);
    const pgs = splitPages(t.html_content);
    setTemplateForm({ template_name: `${t.template_name} (Copy)`, role_title: t.role_title, html_content: t.html_content });
    setPages(pgs);
    setCurrentPage(0);
    const letterheads = pgs.map(p => {
      const match = p.match(/class="letterhead-bg"\s+src="([^"]+)"/);
      return match && match[1] !== '{{letterhead_url}}' ? match[1] : '';
    });
    setPageLetterheads(letterheads);
    setPagePaddings(pgs.map(p => extractPadding(p)));
    setLetterheadImage(letterheads[0] || '');
    setContentPadding(extractPadding(pgs[0]));
    setEditorMode('visual');
    setShowEditor(true);
  };

  const openBulkGenerate = (t: OfferTemplate) => {
    setBulkTemplate(t);
    setBulkCandidates([EMPTY_CANDIDATE()]);
    setBulkCompany({ company_name: 'Syncpedia Technologies', company_address: '', sender_name: user?.full_name || '', sender_title: '', sender_email: '', company_website: '', company_phone: '' });
    setShowBulk(true);
  };

  const addBulkCandidate = () => setBulkCandidates(prev => [...prev, EMPTY_CANDIDATE()]);
  const removeBulkCandidate = (id: string) => setBulkCandidates(prev => prev.filter(c => c.id !== id));
  const updateBulkCandidate = (id: string, field: string, value: string) => {
    setBulkCandidates(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const generateBulkLetters = async () => {
    if (!bulkTemplate) return;
    const valid = bulkCandidates.filter(c => c.candidate_name && c.recipient_email);
    if (valid.length === 0) {
      toast({ variant: 'destructive', title: 'Add at least one candidate with name and email' }); return;
    }
    setBulkGenerating(true);
    try {
      for (const candidate of valid) {
        const refNum = `OL-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
        const finalHtml = bulkTemplate.html_content
          .replace(/\{\{candidate_name\}\}/g, candidate.candidate_name)
          .replace(/\{\{role_title\}\}/g, candidate.role_title || bulkTemplate.role_title)
          .replace(/\{\{company_name\}\}/g, bulkCompany.company_name)
          .replace(/\{\{date\}\}/g, format(new Date(), 'MMMM dd, yyyy'))
          .replace(/\{\{department\}\}/g, candidate.department)
          .replace(/\{\{start_date\}\}/g, candidate.start_date)
          .replace(/\{\{salary\}\}/g, candidate.salary)
          .replace(/\{\{reporting_to\}\}/g, candidate.reporting_to)
          .replace(/\{\{deadline\}\}/g, candidate.deadline)
          .replace(/\{\{sender_name\}\}/g, bulkCompany.sender_name)
          .replace(/\{\{sender_title\}\}/g, bulkCompany.sender_title)
          .replace(/\{\{sender_email\}\}/g, bulkCompany.sender_email)
          .replace(/\{\{company_address\}\}/g, bulkCompany.company_address)
          .replace(/\{\{company_website\}\}/g, bulkCompany.company_website)
          .replace(/\{\{company_phone\}\}/g, bulkCompany.company_phone)
          .replace(/\{\{ref_number\}\}/g, refNum)
          .replace(/\{\{work_location\}\}/g, candidate.work_location)
          .replace(/\{\{employment_type\}\}/g, candidate.employment_type)
          .replace(/\{\{probation_period\}\}/g, candidate.probation_period);

        await api.offerLetters.send({
          template_id: bulkTemplate.id,
          recipient_name: candidate.candidate_name,
          recipient_email: candidate.recipient_email,
          role_title: candidate.role_title || bulkTemplate.role_title,
          html_content: finalHtml,
          status: 'sent',
        });
      }
      toast({ title: `${valid.length} offer letter(s) generated!`, description: 'Records saved. You can preview/print from Sent Letters tab.' });
      setShowBulk(false);
      fetchData();
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
    finally { setBulkGenerating(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  // Full-screen editor view
  if (showEditor) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-background shrink-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => setShowEditor(false)}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <div>
              <h1 className="text-sm font-bold">{editingTemplate ? 'Edit Template' : 'Create Template'}</h1>
              <p className="text-[10px] text-muted-foreground">{pages.length} page(s)</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input className="h-8 text-xs w-48" value={templateForm.template_name} onChange={e => setTemplateForm(f => ({ ...f, template_name: e.target.value }))} placeholder="Template Name *" />
            <Input className="h-8 text-xs w-40" value={templateForm.role_title} onChange={e => setTemplateForm(f => ({ ...f, role_title: e.target.value }))} placeholder="Role Title *" />
            <Button size="sm" onClick={saveTemplate} disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {editingTemplate ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-1.5 border-b bg-muted/30 shrink-0">
          <div className="flex gap-1">
            <Button variant={editorMode === 'visual' ? 'default' : 'outline'} size="sm" className="h-7 text-xs gap-1" onClick={() => setEditorMode('visual')}><Type className="h-3 w-3" />Visual</Button>
            <Button variant={editorMode === 'html' ? 'default' : 'outline'} size="sm" className="h-7 text-xs gap-1" onClick={() => setEditorMode('html')}><Code className="h-3 w-3" />HTML</Button>
          </div>
          <div className="h-5 w-px bg-border" />
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => letterheadInputRef.current?.click()}>
            <Image className="h-3 w-3" />{letterheadImage ? 'Change Letterhead' : 'Upload Letterhead'}
          </Button>
          {letterheadImage && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-destructive hover:text-destructive" onClick={removeLetterhead}>
              <Trash2 className="h-3 w-3" />Remove
            </Button>
          )}
          <input ref={letterheadInputRef} type="file" accept="image/*" onChange={handleLetterheadUpload} className="hidden" />
          <div className="h-5 w-px bg-border" />
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => fileInputRef.current?.click()}><Upload className="h-3 w-3" />Import</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleExportTemplate}><Download className="h-3 w-3" />Export</Button>
          <input ref={fileInputRef} type="file" accept=".html,.htm" onChange={handleImportFile} className="hidden" />
          <div className="h-5 w-px bg-border" />
          <Select onValueChange={(v) => insertPlaceholder(v)}>
            <SelectTrigger className="h-7 w-[160px] text-xs">
              <SelectValue placeholder="Insert placeholder..." />
            </SelectTrigger>
            <SelectContent>
              {PLACEHOLDERS.map(p => (
                <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="h-5 w-px bg-border" />
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addPage}>
            <FilePlus className="h-3 w-3" />Add Page
          </Button>
        </div>

        {/* Page tabs */}
        {pages.length > 1 && (
          <div className="flex items-center gap-1 px-4 py-1 border-b bg-muted/10 shrink-0 overflow-x-auto">
            {pages.map((_, idx) => (
              <div key={idx} className="flex items-center">
                <Button
                  variant={currentPage === idx ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-xs gap-1 rounded-r-none"
                  onClick={() => switchPage(idx)}
                >
                  Page {idx + 1}
                </Button>
                {pages.length > 1 && (
                  <Button
                    variant={currentPage === idx ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs px-1 rounded-l-none border-l-0 text-destructive hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); removePage(idx); }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Editor content - fills remaining space */}
        <div className="flex-1 overflow-hidden">
          {editorMode === 'html' ? (
            <Textarea
              value={pages[currentPage] || ''}
              onChange={e => updateCurrentPage(e.target.value)}
              className="font-mono text-xs h-full w-full rounded-none border-0 resize-none"
              placeholder="Paste your HTML template here..."
            />
          ) : (
            <div className="h-full flex flex-col">
              <div className="px-4 py-1.5 border-b bg-muted/30 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <GripVertical className="h-3.5 w-3.5" /> Drag to move · Edges to resize — Page {currentPage + 1} of {pages.length}
                  </div>
                  <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
                    <span>T:{contentPadding.top}mm</span>
                    <span>R:{contentPadding.right}mm</span>
                    <span>B:{contentPadding.bottom}mm</span>
                    <span>L:{contentPadding.left}mm</span>
                  </div>
                </div>
              </div>
              <div
                ref={previewContainerRef}
                className="flex-1 overflow-auto flex justify-center p-4 bg-muted/20 relative"
              >
                <div className="relative" style={{ width: '210mm', minHeight: '297mm' }}>
                  <iframe
                    srcDoc={pages[currentPage] || ''}
                    className="bg-white shadow-lg w-full h-full absolute inset-0"
                    style={{ width: '210mm', minHeight: '297mm', border: 'none', pointerEvents: 'none' }}
                    title="Template Preview"
                    sandbox="allow-same-origin"
                  />
                  {/* Draggable + Resizable text box overlay */}
                  <div
                    className={`absolute border-2 border-dashed rounded transition-colors ${isDragging ? 'border-primary bg-primary/5' : resizeEdge ? 'border-primary bg-primary/5' : 'border-blue-400/60 bg-blue-50/10 hover:border-primary hover:bg-primary/5'}`}
                    style={{
                      top: `${(contentPadding.top / 297) * 100}%`,
                      left: `${(contentPadding.left / 210) * 100}%`,
                      right: `${(contentPadding.right / 210) * 100}%`,
                      bottom: `${(contentPadding.bottom / 297) * 100}%`,
                    }}
                  >
                    <div className="absolute inset-3 cursor-move" onMouseDown={handleDragStart} />
                    <div className="absolute top-1 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-background/90 border rounded px-2 py-0.5 text-[10px] text-muted-foreground shadow-sm pointer-events-none select-none z-10">
                      <GripVertical className="h-3 w-3" /> Drag to move · Edges to resize
                    </div>
                    <div className="absolute top-0 left-3 right-3 h-1.5 cursor-n-resize hover:bg-primary/20" onMouseDown={handleResizeStart('t')} />
                    <div className="absolute bottom-0 left-3 right-3 h-1.5 cursor-s-resize hover:bg-primary/20" onMouseDown={handleResizeStart('b')} />
                    <div className="absolute left-0 top-3 bottom-3 w-1.5 cursor-w-resize hover:bg-primary/20" onMouseDown={handleResizeStart('l')} />
                    <div className="absolute right-0 top-3 bottom-3 w-1.5 cursor-e-resize hover:bg-primary/20" onMouseDown={handleResizeStart('r')} />
                    <div className="absolute -top-1 -left-1 w-3 h-3 bg-primary border border-primary-foreground rounded-sm cursor-nw-resize z-10" onMouseDown={handleResizeStart('tl')} />
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-primary border border-primary-foreground rounded-sm cursor-ne-resize z-10" onMouseDown={handleResizeStart('tr')} />
                    <div className="absolute -bottom-1 -left-1 w-3 h-3 bg-primary border border-primary-foreground rounded-sm cursor-sw-resize z-10" onMouseDown={handleResizeStart('bl')} />
                    <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-primary border border-primary-foreground rounded-sm cursor-se-resize z-10" onMouseDown={handleResizeStart('br')} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Full-page bulk generate view
  if (showBulk && bulkTemplate) {
    const BULK_FIELDS = [
      { key: 'candidate_name', label: 'Name *', placeholder: 'John Doe' },
      { key: 'recipient_email', label: 'Email *', placeholder: 'john@example.com' },
      { key: 'role_title', label: 'Role', placeholder: bulkTemplate.role_title },
      { key: 'department', label: 'Department', placeholder: 'Engineering' },
      { key: 'start_date', label: 'Joining Date', placeholder: 'Jan 15, 2026' },
      { key: 'salary', label: 'Salary/CTC', placeholder: '₹8,00,000 p.a.' },
      { key: 'reporting_to', label: 'Reporting To', placeholder: 'Manager' },
      { key: 'work_location', label: 'Location', placeholder: 'Hyderabad' },
      { key: 'employment_type', label: 'Emp. Type', placeholder: 'Full-Time' },
      { key: 'probation_period', label: 'Probation', placeholder: '6 months' },
      { key: 'deadline', label: 'Deadline', placeholder: 'Apr 20, 2026' },
    ];

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Bulk Generate Offer Letters</h1>
            <p className="text-xs text-muted-foreground">Template: <strong>{bulkTemplate.template_name}</strong> — Add multiple candidates below</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowBulk(false)}>Cancel</Button>
            <Button size="sm" onClick={generateBulkLetters} disabled={bulkGenerating} className="gap-1.5">
              {bulkGenerating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Generate {bulkCandidates.filter(c => c.candidate_name && c.recipient_email).length} Letter(s)
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Company & Sender (shared across all letters)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 pb-4">
            <div><Label className="text-[10px]">Company Name</Label><Input className="h-8 text-xs" value={bulkCompany.company_name} onChange={e => setBulkCompany(p => ({ ...p, company_name: e.target.value }))} /></div>
            <div><Label className="text-[10px]">Sender Name</Label><Input className="h-8 text-xs" value={bulkCompany.sender_name} onChange={e => setBulkCompany(p => ({ ...p, sender_name: e.target.value }))} /></div>
            <div><Label className="text-[10px]">Sender Title</Label><Input className="h-8 text-xs" value={bulkCompany.sender_title} onChange={e => setBulkCompany(p => ({ ...p, sender_title: e.target.value }))} placeholder="HR Manager" /></div>
            <div><Label className="text-[10px]">Sender Email</Label><Input className="h-8 text-xs" value={bulkCompany.sender_email} onChange={e => setBulkCompany(p => ({ ...p, sender_email: e.target.value }))} placeholder="hr@syncpedia.in" /></div>
            <div><Label className="text-[10px]">Company Address</Label><Input className="h-8 text-xs" value={bulkCompany.company_address} onChange={e => setBulkCompany(p => ({ ...p, company_address: e.target.value }))} placeholder="123 Tech Park" /></div>
            <div><Label className="text-[10px]">Website</Label><Input className="h-8 text-xs" value={bulkCompany.company_website} onChange={e => setBulkCompany(p => ({ ...p, company_website: e.target.value }))} /></div>
            <div><Label className="text-[10px]">Phone</Label><Input className="h-8 text-xs" value={bulkCompany.company_phone} onChange={e => setBulkCompany(p => ({ ...p, company_phone: e.target.value }))} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Candidates ({bulkCandidates.length})</CardTitle>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={addBulkCandidate}><Plus className="h-3 w-3" />Add Row</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-2 py-2 text-left font-medium text-muted-foreground w-8">#</th>
                    {BULK_FIELDS.map(f => (
                      <th key={f.key} className="px-1 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{f.label}</th>
                    ))}
                    <th className="px-2 py-2 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {bulkCandidates.map((c, i) => (
                    <tr key={c.id} className="border-b hover:bg-muted/10">
                      <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                      {BULK_FIELDS.map(f => (
                        <td key={f.key} className="px-1 py-1">
                          <Input
                            className="h-7 text-xs min-w-[100px]"
                            value={(c as any)[f.key]}
                            onChange={e => updateBulkCandidate(c.id, f.key, e.target.value)}
                            placeholder={f.placeholder}
                          />
                        </td>
                      ))}
                      <td className="px-1 py-1">
                        {bulkCandidates.length > 1 && (
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => removeBulkCandidate(c.id)}>
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Offer Letters</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Professional offer letter templates with A4 dimensions & email automation</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openNewTemplate}>
          <Plus className="h-3.5 w-3.5" /> New Template
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="templates" className="gap-1.5"><FileText className="h-3.5 w-3.5" />Templates</TabsTrigger>
          <TabsTrigger value="sent" className="gap-1.5"><Send className="h-3.5 w-3.5" />Sent Letters</TabsTrigger>
        </TabsList>

        <TabsContent value="templates">
          {templates.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="h-12 w-12 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No templates yet. Create your first offer letter template.</p>
                <Button className="mt-4 gap-1.5" onClick={openNewTemplate}><Plus className="h-4 w-4" /> Create Template</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map(t => (
                <Card key={t.id} className="group hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-base">{t.template_name}</CardTitle>
                        <CardDescription className="mt-1">{t.role_title}</CardDescription>
                      </div>
                      <Badge variant={t.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">{t.status}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground mb-3">Updated {format(new Date(t.updated_at), 'MMM dd, yyyy')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => openPreview(t.html_content)}><Eye className="h-3 w-3" />Preview</Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => openEditTemplate(t)}><Edit className="h-3 w-3" />Edit</Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => duplicateTemplate(t)}><Copy className="h-3 w-3" />Clone</Button>
                      <Button size="sm" className="h-7 text-xs gap-1" onClick={() => openSendDialog(t)}><Send className="h-3 w-3" />Send</Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => openBulkGenerate(t)}><Users className="h-3 w-3" />Bulk</Button>
                      {canDeleteTemplates && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-destructive hover:text-destructive" onClick={() => deleteTemplate(t.id)}><Trash2 className="h-3 w-3" /></Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="sent">
          {sentLetters.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Mail className="h-12 w-12 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No offer letters sent yet.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Sent</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sentLetters.map(s => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.recipient_name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{s.recipient_email}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{s.role_title}</Badge></TableCell>
                          <TableCell><Badge variant={s.status === 'sent' ? 'default' : 'secondary'} className="text-[10px]">{s.status}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{format(new Date(s.sent_at), 'MMM dd, yyyy')}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openPreview(s.html_content)}><Eye className="h-3 w-3" /></Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                title={s.pdf_url ? 'Open PDF saved on server' : 'Print / Save as PDF from browser'}
                                onClick={() => void openSentLetterPdf(s)}
                              ><Download className="h-3 w-3" /></Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-4xl max-h-[min(90dvh,calc(100dvh-2rem))]">
          <DialogHeader><DialogTitle>Template Preview (A4)</DialogTitle></DialogHeader>
          <div className="overflow-auto max-h-[70vh] flex flex-col items-center gap-6 p-4 bg-muted/30 rounded-lg">
            {splitPages(previewHtml).map((pageHtml, idx) => (
              <div key={idx} className="relative">
                {splitPages(previewHtml).length > 1 && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-background border rounded px-2 py-0.5 text-[10px] text-muted-foreground z-10">Page {idx + 1}</div>
                )}
                <iframe srcDoc={pageHtml} className="bg-white shadow-lg" style={{ width: '210mm', minHeight: '297mm', border: 'none' }} title={`Preview Page ${idx + 1}`} sandbox="allow-same-origin" />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreview(false)}>Close</Button>
            <Button onClick={() => {
              const w = window.open('', '_blank');
              if (w) { w.document.write(buildPrintableHtml(previewHtml)); w.document.close(); setTimeout(() => w.print(), 500); }
            }} className="gap-1.5"><Download className="h-3.5 w-3.5" />Print / Save as PDF</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Offer Letter Dialog - Multi-step */}
      <Dialog open={showSend} onOpenChange={setShowSend}>
        <DialogContent className="max-w-4xl max-h-[min(90dvh,calc(100dvh-2rem))] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Send Offer Letter</DialogTitle>
          </DialogHeader>

          <Tabs value={sendTab} onValueChange={(v) => setSendTab(v as any)}>
            <TabsList className="mb-4 w-full grid grid-cols-3">
              <TabsTrigger value="details" className="text-xs gap-1"><FileText className="h-3 w-3" />1. Details</TabsTrigger>
              <TabsTrigger value="letter" className="text-xs gap-1"><Eye className="h-3 w-3" />2. Letter Preview</TabsTrigger>
              <TabsTrigger value="email" className="text-xs gap-1"><Mail className="h-3 w-3" />3. Compose Email</TabsTrigger>
            </TabsList>

            <TabsContent value="details">
              <div className="space-y-4">
                <Card>
                  <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Candidate Information</CardTitle></CardHeader>
                  <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-4 pb-4">
                    <div><Label className="text-xs">Candidate Name *</Label><Input value={sendForm.recipient_name} onChange={e => setSendForm(f => ({ ...f, recipient_name: e.target.value }))} placeholder="John Doe" /></div>
                    <div><Label className="text-xs">Candidate Email *</Label><Input type="email" value={sendForm.recipient_email} onChange={e => setSendForm(f => ({ ...f, recipient_email: e.target.value }))} placeholder="john@example.com" /></div>
                    <div><Label className="text-xs">Role Title</Label><Input value={sendForm.role_title} onChange={e => setSendForm(f => ({ ...f, role_title: e.target.value }))} /></div>
                    <div><Label className="text-xs">Department</Label><Input value={sendForm.department} onChange={e => setSendForm(f => ({ ...f, department: e.target.value }))} placeholder="Engineering" /></div>
                    <div><Label className="text-xs">Date of Joining</Label><Input value={sendForm.start_date} onChange={e => setSendForm(f => ({ ...f, start_date: e.target.value }))} placeholder="January 15, 2026" /></div>
                    <div><Label className="text-xs">Salary / CTC</Label><Input value={sendForm.salary} onChange={e => setSendForm(f => ({ ...f, salary: e.target.value }))} placeholder="₹8,00,000 per annum" /></div>
                    <div><Label className="text-xs">Reporting To</Label><Input value={sendForm.reporting_to} onChange={e => setSendForm(f => ({ ...f, reporting_to: e.target.value }))} placeholder="Manager Name" /></div>
                    <div><Label className="text-xs">Work Location</Label><Input value={sendForm.work_location} onChange={e => setSendForm(f => ({ ...f, work_location: e.target.value }))} placeholder="Hyderabad, India" /></div>
                    <div><Label className="text-xs">Employment Type</Label><Input value={sendForm.employment_type} onChange={e => setSendForm(f => ({ ...f, employment_type: e.target.value }))} /></div>
                    <div><Label className="text-xs">Probation Period</Label><Input value={sendForm.probation_period} onChange={e => setSendForm(f => ({ ...f, probation_period: e.target.value }))} /></div>
                    <div><Label className="text-xs">Acceptance Deadline</Label><Input value={sendForm.deadline} onChange={e => setSendForm(f => ({ ...f, deadline: e.target.value }))} placeholder="April 20, 2026" /></div>
                    <div><Label className="text-xs">Ref Number</Label><Input value={sendForm.ref_number} onChange={e => setSendForm(f => ({ ...f, ref_number: e.target.value }))} /></div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Company & Sender</CardTitle></CardHeader>
                  <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-4 pb-4">
                    <div><Label className="text-xs">Company Name</Label><Input value={sendForm.company_name} onChange={e => setSendForm(f => ({ ...f, company_name: e.target.value }))} /></div>
                    <div><Label className="text-xs">Company Address</Label><Input value={sendForm.company_address} onChange={e => setSendForm(f => ({ ...f, company_address: e.target.value }))} placeholder="123 Tech Park, City" /></div>
                    <div><Label className="text-xs">Company Website</Label><Input value={sendForm.company_website} onChange={e => setSendForm(f => ({ ...f, company_website: e.target.value }))} placeholder="www.company.com" /></div>
                    <div><Label className="text-xs">Company Phone</Label><Input value={sendForm.company_phone} onChange={e => setSendForm(f => ({ ...f, company_phone: e.target.value }))} placeholder="+91 9876543210" /></div>
                    <div><Label className="text-xs">Sender Name</Label><Input value={sendForm.sender_name} onChange={e => setSendForm(f => ({ ...f, sender_name: e.target.value }))} /></div>
                    <div><Label className="text-xs">Sender Title</Label><Input value={sendForm.sender_title} onChange={e => setSendForm(f => ({ ...f, sender_title: e.target.value }))} placeholder="HR Manager" /></div>
                    <div className="sm:col-span-2"><Label className="text-xs">Sender Email</Label><Input value={sendForm.sender_email} onChange={e => setSendForm(f => ({ ...f, sender_email: e.target.value }))} placeholder="hr@syncpedia.in" /></div>
                  </CardContent>
                </Card>
                <div className="flex justify-end">
                  <Button onClick={() => setSendTab('letter')} className="gap-1.5">Next: Preview Letter <Eye className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="letter">
              <div className="space-y-4">
                <div className="overflow-auto max-h-[55vh] flex justify-center p-4 bg-gray-100 rounded-lg">
                  {sendTemplate && (
                    <iframe
                      srcDoc={replacePlaceholders(sendTemplate.html_content)}
                      className="bg-white shadow-lg"
                      style={{ width: '210mm', minHeight: '297mm', border: 'none' }}
                      title="Offer Letter Preview"
                      sandbox="allow-same-origin"
                    />
                  )}
                </div>
                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setSendTab('details')}>← Back</Button>
                  <div className="flex gap-2">
                    <Button variant="outline" className="gap-1.5" onClick={() => {
                      if (!sendTemplate) return;
                      const w = window.open('', '_blank');
                      if (w) { w.document.write(buildPrintableHtml(replacePlaceholders(sendTemplate.html_content))); w.document.close(); setTimeout(() => w.print(), 500); }
                    }}><Download className="h-3.5 w-3.5" />Save as PDF</Button>
                    <Button onClick={goToEmailCompose} className="gap-1.5">Next: Compose Email <Mail className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="email">
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_240px]">
                  <Card>
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm">Compose Email</CardTitle>
                      <CardDescription className="text-xs">
                        Edit before sending. This email accompanies the PDF offer letter. Sent from hr@syncpedia.in.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 px-4 pb-4">
                      <div>
                        <Label className="text-xs">To</Label>
                        <Input
                          value={emailDraft.to}
                          onChange={(e) => setEmailDraft((p) => ({ ...p, to: e.target.value }))}
                          className="mt-1"
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <Label className="text-xs">CC (optional)</Label>
                          <Input
                            value={emailDraft.cc}
                            onChange={(e) => setEmailDraft((p) => ({ ...p, cc: e.target.value }))}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">BCC (optional)</Label>
                          <Input
                            value={emailDraft.bcc}
                            onChange={(e) => setEmailDraft((p) => ({ ...p, bcc: e.target.value }))}
                            className="mt-1"
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">Subject</Label>
                        <Input
                          value={emailDraft.subject}
                          onChange={(e) => setEmailDraft((p) => ({ ...p, subject: e.target.value }))}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Body</Label>
                        <Textarea
                          rows={12}
                          value={emailDraft.body}
                          onChange={(e) => setEmailDraft((p) => ({ ...p, body: e.target.value }))}
                          className="mt-1 text-sm"
                        />
                      </div>
                      <Badge variant="outline" className="text-[11px]">
                        PDF · {emailDraft.attachmentName || 'Offer_Letter.pdf'}
                      </Badge>
                    </CardContent>
                  </Card>

                  <Card className="h-fit">
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm">Email Details</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 px-4 pb-4 text-xs">
                      <div>
                        <span className="text-muted-foreground">From:</span> hr@syncpedia.in
                      </div>
                      <div>
                        <span className="text-muted-foreground">To:</span> {emailDraft.to || '—'}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Attachment:</span> {emailDraft.attachmentName || '—'}
                      </div>
                    </CardContent>
                  </Card>
                </div>
                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setSendTab('letter')}>← Back</Button>
                  <Button
                    onClick={generatePdfAndSend}
                    disabled={sending}
                    className="gap-1.5 rounded-lg bg-[#2ed573] font-semibold text-[#0f2318] hover:bg-[#26c968]"
                  >
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {sending ? 'Sending…' : 'Send Offer Letter Mail'}
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
