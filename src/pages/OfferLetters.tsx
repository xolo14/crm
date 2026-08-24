import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { notifyOrgAdminsBulkAction } from '@/lib/notifications';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { buildMultiPagePrintableHtml, OFFER_PAGE_BREAK, splitOfferHtmlPages } from '@/utils/offerLetterPdf';
import {
  DocumentTemplateEditor,
  extractContentAreaHtml,
  extractDocumentCss,
  injectContentAreaHtml,
} from '@/components/templates/DocumentTemplateEditor';
import {
  extractOfferBodyBox,
  extractOfferTextBoxes,
  injectOfferBodyBox,
  injectOfferTextBoxesMarker,
  DEFAULT_OFFER_BODY_BOX,
  type OfferBodyBox,
  type OfferTextBox,
} from '@/components/templates/CanvasTextBoxFrame';
import { PlaceholderPalette } from '@/components/templates/PlaceholderPalette';
import { DocFormsWorkspace, DocIssuedPanel } from '@/modules/docForms/DocFormsHub';
import { applyPlaceholders } from '@/modules/docForms/types';
import {
  downloadPlaceholderExcelTemplate,
  mapSheetRowsToPlaceholders,
  parsePlaceholderSheetFile,
} from '@/lib/placeholderSheetImport';
import {
  applyMappedValuesToBulkRow,
  applyMappedValuesToSendState,
  findMissingOfferPlaceholders,
  getOfferPlaceholderValue,
  getOfferRequiredPlaceholderKeys,
  getOfferTemplatePlaceholderKeys,
  mapLeadToOfferPlaceholderValues,
  OFFER_BULK_CANDIDATE_KEYS,
  OFFER_COMPANY_SENDER_KEYS,
  OFFER_SEND_FORM_KEY_MAP,
  offerPlaceholderLabel,
} from '@/lib/offerLetterPlaceholders';
import {
  Plus, FileText, Send, Trash2, Edit, Eye, Upload, Download, Loader2, Mail, Copy, Image, Users, X, ChevronLeft, FilePlus, FileSpreadsheet, Variable, Lock, Unlock
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
  mail_json?: {
    mail_subject?: string;
    mail_body?: string;
    recipient_email_placeholder?: string;
    pdf_filename_pattern?: string;
  } | string | null;
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

type OfferMailConfig = {
  mail_subject: string;
  mail_body: string;
  recipient_email_placeholder: string;
  pdf_filename_pattern: string;
};

function parseOfferMailConfig(template: OfferTemplate | null | undefined): OfferMailConfig {
  const fallback: OfferMailConfig = {
    mail_subject: 'Offer Letter — {{candidate_name}}',
    mail_body: '<p>Dear {{candidate_name}},</p><p>Please find your offer letter attached as a PDF.</p><p>Regards,<br>HR Team</p>',
    recipient_email_placeholder: 'recipient_email',
    pdf_filename_pattern: '{{candidate_name}}_OfferLetter.pdf',
  };
  if (!template?.mail_json) return fallback;
  let raw: any = template.mail_json;
  // MySQL/PDO may return JSON as string; occasionally double-encoded
  for (let i = 0; i < 2 && typeof raw === 'string'; i++) {
    try {
      raw = JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  if (!raw || typeof raw !== 'object') return fallback;
  const pick = (key: keyof OfferMailConfig) => {
    const v = raw[key];
    if (v == null) return fallback[key];
    const s = String(v);
    return s.trim() !== '' ? s : fallback[key];
  };
  return {
    mail_subject: pick('mail_subject'),
    mail_body: pick('mail_body'),
    recipient_email_placeholder: pick('recipient_email_placeholder'),
    pdf_filename_pattern: pick('pdf_filename_pattern'),
  };
}

function withOfferFallbackValues(values: Record<string, string>): Record<string, string> {
  return {
    ...values,
    date: values.date || format(new Date(), 'MMMM dd, yyyy'),
    recipient_name: values.recipient_name || values.candidate_name || '',
  };
}

// Simple offer letter template that uses a letterhead background image
const DEFAULT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @font-face {
    font-family: 'Futura';
    src: local('Futura'), local('Futura-Book'), local('Futura Book'), local('Futura-Medium'), local('Futura Medium');
    font-weight: 400;
    font-style: normal;
  }
  @font-face {
    font-family: 'Futura';
    src: local('Futura-Bold'), local('Futura Bold'), local('Futura-Medium'), local('Futura Medium');
    font-weight: 700;
    font-style: normal;
  }
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
    position: absolute;
    left: 13.3%;
    top: 18.5%;
    width: 73.4%;
    min-height: 73%;
    height: auto;
    z-index: 1;
    padding: 0;
    margin: 0;
    overflow: visible;
    box-sizing: border-box;
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

  const [templates, setTemplates] = useState<OfferTemplate[]>([]);
  const [sentLetters, setSentLetters] = useState<SentLetter[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('templates');

  const [showEditor, setShowEditor] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<OfferTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState({
    template_name: '',
    role_title: '',
    html_content: DEFAULT_TEMPLATE,
    mail_subject: 'Offer Letter — {{candidate_name}}',
    mail_body: '<p>Dear {{candidate_name}},</p><p>Please find your offer letter attached as a PDF.</p><p>Regards,<br>HR Team</p>',
    recipient_email_placeholder: 'recipient_email',
    pdf_filename_pattern: '{{candidate_name}}_OfferLetter.pdf',
  });
  const [letterheadImage, setLetterheadImage] = useState<string>('');
  const [contentPadding, setContentPadding] = useState({ top: 55, right: 28, bottom: 25, left: 28 });
  const [saving, setSaving] = useState(false);

  // Multi-page support
  const [pages, setPages] = useState<string[]>([DEFAULT_TEMPLATE]);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageLetterheads, setPageLetterheads] = useState<string[]>(['']);
  const [pagePaddings, setPagePaddings] = useState<{ top: number; right: number; bottom: number; left: number }[]>([{ top: 55, right: 28, bottom: 25, left: 28 }]);
  const [pageTextBoxes, setPageTextBoxes] = useState<OfferTextBox[][]>([[]]);
  const [pageBodyBoxes, setPageBodyBoxes] = useState<OfferBodyBox[]>([{ ...DEFAULT_OFFER_BODY_BOX }]);
  const [showPlaceholderPanel, setShowPlaceholderPanel] = useState(true);
  /** Background + body margins fixed; text + free boxes still editable. */
  const [layoutLocked, setLayoutLocked] = useState(true);
  const bulkSheetInputRef = useRef<HTMLInputElement>(null);

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
  const [sendExtraValues, setSendExtraValues] = useState<Record<string, string>>({});
  const [offerLeads, setOfferLeads] = useState<any[]>([]);
  const [leadSuggestQuery, setLeadSuggestQuery] = useState('');
  const [leadSuggestOpen, setLeadSuggestOpen] = useState(false);
  const [bulkLeadSuggestRowId, setBulkLeadSuggestRowId] = useState<string | null>(null);

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
  const [bulkSelectedRowIds, setBulkSelectedRowIds] = useState<string[]>([]);
  const [bulkCompany, setBulkCompany] = useState({ company_name: 'Syncpedia Technologies', company_address: '', sender_name: '', sender_title: '', sender_email: '', company_website: '', company_phone: '' });
  const [bulkExtraByRowId, setBulkExtraByRowId] = useState<Record<string, Record<string, string>>>({});
  const [bulkFillField, setBulkFillField] = useState<string>('');
  const [bulkFillValue, setBulkFillValue] = useState('');
  const [bulkGenerating, setBulkGenerating] = useState(false);

  const fetchData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const [tRes, sRes] = await Promise.all([api.offerLetters.templates(), api.offerLetters.sent()]);
      setTemplates(((tRes as any).data || []) as OfferTemplate[]);
      setSentLetters(((sRes as any).data || []) as SentLetter[]);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error loading data', description: err.message });
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  /** Refresh sent letters when opening that tab so new sends appear without a full reload. */
  useEffect(() => {
    if (activeTab === 'sent') {
      void fetchData({ silent: true });
    }
  }, [activeTab, fetchData]);

  const PAGE_SEPARATOR = OFFER_PAGE_BREAK;

  const splitPages = (html: string): string[] => splitOfferHtmlPages(html);

  const joinPages = (pgs: string[]): string => pgs.join(PAGE_SEPARATOR);

  /** Keep edit canvas geometry identical to preview/PDF HTML. */
  const normalizeOfferPages = (pgs: string[]) => {
    const bodies = pgs.map((p) => extractOfferBodyBox(p));
    const boxes = pgs.map((p) => extractOfferTextBoxes(p));
    const normalized = pgs.map((p, i) =>
      injectOfferTextBoxesMarker(injectOfferBodyBox(p, bodies[i]), boxes[i]),
    );
    return { normalized, bodies, boxes };
  };

  const openNewTemplate = () => {
    setEditingTemplate(null);
    const { normalized, bodies, boxes } = normalizeOfferPages([DEFAULT_TEMPLATE]);
    setTemplateForm({
      template_name: '',
      role_title: '',
      html_content: joinPages(normalized),
      mail_subject: 'Offer Letter — {{candidate_name}}',
      mail_body: '<p>Dear {{candidate_name}},</p><p>Please find your offer letter attached as a PDF.</p><p>Regards,<br>HR Team</p>',
      recipient_email_placeholder: 'recipient_email',
      pdf_filename_pattern: '{{candidate_name}}_OfferLetter.pdf',
    });
    setLetterheadImage('');
    setContentPadding({ top: 55, right: 28, bottom: 25, left: 28 });
    setPages(normalized);
    setCurrentPage(0);
    setPageLetterheads(['']);
    setPagePaddings([{ top: 55, right: 28, bottom: 25, left: 28 }]);
    setPageTextBoxes(boxes);
    setPageBodyBoxes(bodies);
    setLayoutLocked(false);
    setShowPlaceholderPanel(true);
    setShowEditor(true);
  };

  const openEditTemplate = (t: OfferTemplate) => {
    setEditingTemplate(t);
    let mail: any = {};
    if (typeof t.mail_json === 'string') {
      try { mail = JSON.parse(t.mail_json); } catch { mail = {}; }
    } else if (t.mail_json && typeof t.mail_json === 'object') {
      mail = t.mail_json;
    }
    const pgs = splitPages(t.html_content);
    const { normalized, bodies, boxes } = normalizeOfferPages(pgs);
    setTemplateForm({
      template_name: t.template_name,
      role_title: t.role_title,
      html_content: joinPages(normalized),
      mail_subject: mail.mail_subject || 'Offer Letter — {{candidate_name}}',
      mail_body: mail.mail_body || '<p>Dear {{candidate_name}},</p><p>Please find your offer letter attached.</p>',
      recipient_email_placeholder: mail.recipient_email_placeholder || 'recipient_email',
      pdf_filename_pattern: mail.pdf_filename_pattern || '{{candidate_name}}_OfferLetter.pdf',
    });
    setPages(normalized);
    setCurrentPage(0);
    const letterheads = normalized.map(p => {
      const match = p.match(/class="letterhead-bg"\s+src="([^"]+)"/);
      return match && match[1] !== '{{letterhead_url}}' ? match[1] : '';
    });
    setPageLetterheads(letterheads);
    const paddings = normalized.map(p => extractPadding(p));
    setPagePaddings(paddings);
    setPageTextBoxes(boxes);
    setPageBodyBoxes(bodies);
    setLetterheadImage(letterheads[0] || '');
    setContentPadding(paddings[0]);
    setLayoutLocked(true);
    setShowPlaceholderPanel(true);
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
    const { normalized, bodies, boxes } = normalizeOfferPages([DEFAULT_TEMPLATE]);
    const newPage = normalized[0];
    setPages(prev => {
      const next = [...prev, newPage];
      syncTemplatFromPages(next);
      return next;
    });
    setPageLetterheads(prev => [...prev, '']);
    setPagePaddings(prev => [...prev, { top: 55, right: 28, bottom: 25, left: 28 }]);
    setPageTextBoxes(prev => [...prev, boxes[0] || []]);
    setPageBodyBoxes(prev => [...prev, bodies[0] || { ...DEFAULT_OFFER_BODY_BOX }]);
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
    setPageTextBoxes(prev => prev.filter((_, i) => i !== idx));
    setPageBodyBoxes(prev => prev.filter((_, i) => i !== idx));
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
    const mail_json = {
      mail_subject: templateForm.mail_subject,
      mail_body: templateForm.mail_body,
      recipient_email_placeholder: templateForm.recipient_email_placeholder,
      pdf_filename_pattern: templateForm.pdf_filename_pattern,
    };
    setSaving(true);
    try {
      if (editingTemplate) {
        await api.offerLetters.updateTemplate(editingTemplate.id, {
          template_name: templateForm.template_name,
          role_title: templateForm.role_title,
          html_content: templateForm.html_content,
          mail_json,
          status: 'active',
        });
        toast({ title: 'Template updated' });
      } else {
        await api.offerLetters.createTemplate({
          template_name: templateForm.template_name,
          role_title: templateForm.role_title,
          html_content: templateForm.html_content,
          mail_json,
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
    const { normalized } = normalizeOfferPages(splitPages(html));
    setPreviewHtml(joinPages(normalized));
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
    const { normalized } = normalizeOfferPages(splitPages(html));
    return buildMultiPagePrintableHtml(joinPages(normalized));
  };

  const loadOfferLeads = useCallback(async () => {
    try {
      const res = await api.leads.list();
      const list = Array.isArray(res) ? res : (res as any)?.data || (res as any)?.leads || [];
      setOfferLeads(Array.isArray(list) ? list : []);
    } catch {
      setOfferLeads([]);
    }
  }, []);

  const openSendDialog = async (t: OfferTemplate) => {
    // Always load fresh template so compose uses the latest saved mail_json body/subject
    let full = t;
    try {
      const res = await api.offerLetters.template(t.id);
      const row = (res as any)?.data;
      if (row && typeof row === 'object') full = { ...t, ...row };
    } catch {
      /* use list row */
    }
    setSendTemplate(full);
    setSendTab('details');
    const refNum = `OL-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    setSendForm({
      ...INITIAL_SEND_FORM,
      role_title: full.role_title || t.role_title,
      sender_name: user?.full_name || '',
      sender_email: 'hr@syncpedia.in',
      ref_number: refNum,
    });
    setSendExtraValues({});
    setLeadSuggestQuery('');
    setLeadSuggestOpen(false);
    void loadOfferLeads();
    setShowSend(true);
  };

  const offerSendValues = (): Record<string, string> =>
    withOfferFallbackValues({
      candidate_name: sendForm.recipient_name || '',
      recipient_name: sendForm.recipient_name || '',
      recipient_email: sendForm.recipient_email || '',
      role_title: sendForm.role_title || '',
      company_name: sendForm.company_name || '',
      department: sendForm.department || '',
      start_date: sendForm.start_date || '',
      salary: sendForm.salary || '',
      reporting_to: sendForm.reporting_to || '',
      deadline: sendForm.deadline || '',
      sender_name: sendForm.sender_name || '',
      sender_title: sendForm.sender_title || '',
      sender_email: sendForm.sender_email || '',
      company_address: sendForm.company_address || '',
      company_website: sendForm.company_website || '',
      company_phone: sendForm.company_phone || '',
      ref_number: sendForm.ref_number || '',
      work_location: sendForm.work_location || '',
      employment_type: sendForm.employment_type || '',
      probation_period: sendForm.probation_period || '',
      ...sendExtraValues,
    });

  const renderOfferPlaceholders = (text: string, values: Record<string, string>): string =>
    applyPlaceholders(text, withOfferFallbackValues(values));

  const replacePlaceholders = (html: string) => renderOfferPlaceholders(html, offerSendValues());

  const dynamicOfferPlaceholderKeys = useMemo(() => {
    if (!sendTemplate) return [] as string[];
    const mail = parseOfferMailConfig(sendTemplate);
    return getOfferTemplatePlaceholderKeys(sendTemplate.html_content || '', mail);
  }, [sendTemplate]);

  const sendRequiredKeys = useMemo(
    () => getOfferRequiredPlaceholderKeys(dynamicOfferPlaceholderKeys),
    [dynamicOfferPlaceholderKeys],
  );

  const leadNameSuggestions = useMemo(() => {
    const q = leadSuggestQuery.trim().toLowerCase();
    if (q.length < 2) return [] as any[];
    return offerLeads
      .filter((l) => String(l?.name || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [offerLeads, leadSuggestQuery]);

  const setSendPlaceholderValue = (key: string, value: string) => {
    const formKey = OFFER_SEND_FORM_KEY_MAP[key];
    if (formKey) {
      setSendForm((f) => ({ ...f, [formKey]: value }));
      if (key === 'candidate_name' || key === 'recipient_name' || formKey === 'recipient_name') {
        setLeadSuggestQuery(value);
        setLeadSuggestOpen(value.trim().length >= 2);
      }
      return;
    }
    setSendExtraValues((prev) => ({ ...prev, [key]: value }));
  };

  const applyLeadToSend = (lead: any) => {
    const mapped = mapLeadToOfferPlaceholderValues(lead, dynamicOfferPlaceholderKeys);
    const next = applyMappedValuesToSendState(mapped, sendForm as any, sendExtraValues);
    setSendForm((f) => ({ ...f, ...next.sendForm }));
    setSendExtraValues(next.extras);
    setLeadSuggestQuery(String(lead?.name || ''));
    setLeadSuggestOpen(false);
    const filled = Object.keys(mapped).length;
    toast({
      title: 'Lead applied',
      description: filled
        ? `Filled ${filled} matching placeholder(s) from the lead.`
        : 'Lead selected — no matching template placeholders found.',
    });
  };

  const assertSendPlaceholdersFilled = (): boolean => {
    const missing = findMissingOfferPlaceholders(
      dynamicOfferPlaceholderKeys,
      sendForm as any,
      sendExtraValues,
    );
    if (missing.length) {
      toast({
        variant: 'destructive',
        title: 'Fill all template fields',
        description: `Missing: ${missing.map(offerPlaceholderLabel).join(', ')}`,
      });
      return false;
    }
    return true;
  };

  const goToEmailCompose = () => {
    if (!assertSendPlaceholdersFilled()) return;
    const mailCfg = parseOfferMailConfig(sendTemplate);
    const values = offerSendValues();
    const toFromTemplate = renderOfferPlaceholders(`{{${mailCfg.recipient_email_placeholder}}}`, values).trim();
    // Compose must use the template's saved mail subject/body (placeholders replaced).
    const renderedSubject = renderOfferPlaceholders(mailCfg.mail_subject || '', values).trim();
    const renderedBody = renderOfferPlaceholders(mailCfg.mail_body || '', values);
    const attachmentPattern = renderOfferPlaceholders(
      mailCfg.pdf_filename_pattern || '{{candidate_name}}_OfferLetter.pdf',
      values,
    ).trim();
    const fallback = buildDefaultOfferEmailDraft(sendForm);
    setEmailDraft({
      to:
        toFromTemplate && !toFromTemplate.includes('{{')
          ? toFromTemplate
          : sendForm.recipient_email?.trim() || fallback.to,
      cc: '',
      bcc: '',
      subject: renderedSubject || fallback.subject,
      // Never replace with the old branded default when the template has a mail body.
      body: (renderedBody && renderedBody.trim()) ? renderedBody : fallback.body,
      attachmentName: (attachmentPattern || fallback.attachmentName).replace(/\s+/g, '_'),
    });
    setSendTab('email');
  };

  const generatePdfAndSend = async () => {
    if (!assertSendPlaceholdersFilled()) return;
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
      const draftBody = emailDraft.body.trim();
      const looksHtml = /<\/?[a-z][\s\S]*>/i.test(draftBody);
      const emailHtml = looksHtml ? draftBody : wrapOfferEmailPlainBody(draftBody, formForEmail);

      let pdfBase64 = '';
      try {
        const { buildHtmlDocumentPdfBase64 } = await import('@/utils/offerLetterPdf');
        pdfBase64 = await buildHtmlDocumentPdfBase64(finalHtml);
      } catch (pdfErr: any) {
        console.error(pdfErr);
        throw new Error(pdfErr?.message || 'Could not generate offer letter PDF in the browser');
      }

      const sendResult = await api.offerLetters.send({
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
        pdf_base64: pdfBase64,
      });

      if (sendResult?.record_saved === false) {
        toast({
          variant: 'destructive',
          title: 'Email sent, record not saved',
          description: sendResult?.warning
            || 'The offer letter email was sent, but the sent record could not be saved. Do not resend.',
        });
        setShowSend(false);
        void fetchData({ silent: true });
        return;
      }

      toast({
        title: 'Offer letter sent',
        description: `PDF emailed to ${emailDraft.to.trim()} from hr@syncpedia.in`,
      });
      setShowSend(false);
      void fetchData({ silent: true });
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
    finally { setSending(false); }
  };

  const insertPlaceholder = (placeholder: string) => {
    const token = ` ${placeholder} `;
    try {
      document.execCommand('styleWithCSS', false, 'true');
      const ok = document.execCommand('insertText', false, token);
      if (ok) {
        // Force sync from the live contentEditable (onInput is not always reliable with execCommand)
        const active = document.activeElement as HTMLElement | null;
        if (active?.isContentEditable) {
          updateVisualContent(active.innerHTML);
          return;
        }
      }
    } catch {
      /* fall through */
    }
    const page = pages[currentPage] || '';
    const inner = extractContentAreaHtml(page);
    updateCurrentPage(injectContentAreaHtml(page, `${inner}${token}`));
  };

  const updateVisualContent = (innerHtml: string) => {
    const page = pages[currentPage] || DEFAULT_TEMPLATE;
    const withContent = injectContentAreaHtml(page, innerHtml);
    const boxes = pageTextBoxes[currentPage] || [];
    const body = pageBodyBoxes[currentPage] || DEFAULT_OFFER_BODY_BOX;
    updateCurrentPage(injectOfferTextBoxesMarker(injectOfferBodyBox(withContent, body), boxes));
  };

  const updatePageTextBoxes = (boxes: OfferTextBox[]) => {
    setPageTextBoxes((prev) => {
      const next = [...prev];
      while (next.length <= currentPage) next.push([]);
      next[currentPage] = boxes;
      return next;
    });
    setPages((prev) => {
      const next = [...prev];
      const page = next[currentPage] || DEFAULT_TEMPLATE;
      const body = pageBodyBoxes[currentPage] || DEFAULT_OFFER_BODY_BOX;
      next[currentPage] = injectOfferTextBoxesMarker(injectOfferBodyBox(page, body), boxes);
      syncTemplatFromPages(next);
      return next;
    });
  };

  const updatePageBodyBox = (box: OfferBodyBox) => {
    setPageBodyBoxes((prev) => {
      const next = [...prev];
      while (next.length <= currentPage) next.push({ ...DEFAULT_OFFER_BODY_BOX });
      next[currentPage] = box;
      return next;
    });
    setPages((prev) => {
      const next = [...prev];
      const page = next[currentPage] || DEFAULT_TEMPLATE;
      const boxes = pageTextBoxes[currentPage] || [];
      next[currentPage] = injectOfferTextBoxesMarker(injectOfferBodyBox(page, box), boxes);
      syncTemplatFromPages(next);
      return next;
    });
  };

  const extractPadding = (html: string) => {
    const match = html.match(/\.content-area\s*\{[^}]*padding:\s*([\d.]+)mm\s+([\d.]+)mm\s+([\d.]+)mm\s+([\d.]+)mm/);
    if (match) return { top: parseFloat(match[1]), right: parseFloat(match[2]), bottom: parseFloat(match[3]), left: parseFloat(match[4]) };
    return { top: 55, right: 28, bottom: 25, left: 28 };
  };

  const duplicateTemplate = (t: OfferTemplate) => {
    setEditingTemplate(null);
    const pgs = splitPages(t.html_content);
    const { normalized, bodies, boxes } = normalizeOfferPages(pgs);
    const mail = parseOfferMailConfig(t);
    setTemplateForm({
      template_name: `${t.template_name} (Copy)`,
      role_title: t.role_title,
      html_content: joinPages(normalized),
      mail_subject: mail.mail_subject,
      mail_body: mail.mail_body,
      recipient_email_placeholder: mail.recipient_email_placeholder,
      pdf_filename_pattern: mail.pdf_filename_pattern,
    });
    setPages(normalized);
    setCurrentPage(0);
    const letterheads = normalized.map(p => {
      const match = p.match(/class="letterhead-bg"\s+src="([^"]+)"/);
      return match && match[1] !== '{{letterhead_url}}' ? match[1] : '';
    });
    setPageLetterheads(letterheads);
    setPagePaddings(normalized.map(p => extractPadding(p)));
    setPageTextBoxes(boxes);
    setPageBodyBoxes(bodies);
    setLetterheadImage(letterheads[0] || '');
    setContentPadding(extractPadding(normalized[0]));
    setLayoutLocked(true);
    setShowPlaceholderPanel(true);
    setShowEditor(true);
    toast({
      title: 'Duplicated',
      description: 'Editing a copy — save to create a new template.',
    });
  };

  const openBulkGenerate = async (t: OfferTemplate) => {
    let full = t;
    try {
      const res = await api.offerLetters.template(t.id);
      const row = (res as any)?.data;
      if (row && typeof row === 'object') full = { ...t, ...row };
    } catch {
      /* use list row */
    }
    setBulkTemplate(full);
    const first = EMPTY_CANDIDATE();
    setBulkCandidates([first]);
    setBulkSelectedRowIds([first.id]);
    setBulkCompany({ company_name: 'Syncpedia Technologies', company_address: '', sender_name: user?.full_name || '', sender_title: '', sender_email: '', company_website: '', company_phone: '' });
    setBulkExtraByRowId({});
    setBulkFillField('');
    setBulkFillValue('');
    setBulkLeadSuggestRowId(null);
    void loadOfferLeads();
    setShowBulk(true);
  };

  const addBulkCandidate = () => setBulkCandidates(prev => {
    const next = [...prev, EMPTY_CANDIDATE()];
    return next;
  });
  const removeBulkCandidate = (id: string) => {
    setBulkCandidates(prev => prev.filter(c => c.id !== id));
    setBulkSelectedRowIds(prev => prev.filter(x => x !== id));
    setBulkExtraByRowId(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const updateBulkCandidate = (id: string, field: string, value: string) => {
    setBulkCandidates(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };
  const setBulkExtraValue = (id: string, key: string, value: string) => {
    setBulkExtraByRowId(prev => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [key]: value,
      },
    }));
  };
  const toggleBulkRow = (id: string) => {
    setBulkSelectedRowIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleBulkSheetImport = async (file: File) => {
    try {
      if (!bulkTemplate) return;
      const mail = parseOfferMailConfig(bulkTemplate);
      const templateKeys = getOfferTemplatePlaceholderKeys(bulkTemplate.html_content || '', mail);
      const required = getOfferRequiredPlaceholderKeys(templateKeys);
      const rowKeys = required
        .filter((k) => !OFFER_COMPANY_SENDER_KEYS.has(k) && k !== 'ref_number')
        .map((k) => (k === 'recipient_name' ? 'candidate_name' : k));
      const allowedKeys = [...new Set(rowKeys)];
      if (!allowedKeys.includes('candidate_name')) allowedKeys.unshift('candidate_name');
      if (!allowedKeys.includes('recipient_email')) allowedKeys.splice(1, 0, 'recipient_email');

      const grid = await parsePlaceholderSheetFile(file);
      const mapped = mapSheetRowsToPlaceholders(grid, {
        allowedKeys,
        requireKeys: ['candidate_name'],
      });
      if (mapped.errors.length && mapped.rows.length === 0) {
        toast({ variant: 'destructive', title: 'Import failed', description: mapped.errors[0] });
        return;
      }
      const next = mapped.rows.map((row) => {
        const item = {
          ...EMPTY_CANDIDATE(),
          candidate_name: row.candidate_name || row.recipient_name || '',
          recipient_email: row.recipient_email || '',
          role_title: row.role_title || '',
          department: row.department || '',
          start_date: row.start_date || '',
          salary: row.salary || '',
          reporting_to: row.reporting_to || '',
          work_location: row.work_location || '',
          employment_type: row.employment_type || 'Full-Time',
          probation_period: row.probation_period || '6 months',
          deadline: row.deadline || '',
        };
        return item;
      });
      if (next.length === 0) {
        toast({
          variant: 'destructive',
          title: 'No valid rows',
          description: 'Need a candidate_name column matching this template.',
        });
        return;
      }
      setBulkCandidates(next);
      setBulkSelectedRowIds(next.map((r) => r.id));
      const extrasById: Record<string, Record<string, string>> = {};
      next.forEach((item, idx) => {
        const row = mapped.rows[idx];
        const extras: Record<string, string> = {};
        Object.keys(row).forEach((k) => {
          if (OFFER_BULK_CANDIDATE_KEYS.has(k) || k === 'candidate_name' || k === 'recipient_name') return;
          if (OFFER_COMPANY_SENDER_KEYS.has(k) || k === 'date' || k === 'ref_number') return;
          if (row[k]) extras[k] = row[k];
        });
        if (Object.keys(extras).length > 0) extrasById[item.id] = extras;
      });
      setBulkExtraByRowId(extrasById);
      toast({
        title: `Imported ${next.length} row(s)`,
        description: mapped.skipped ? `${mapped.skipped} row(s) skipped` : 'Matched to template placeholders',
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Import failed', description: err?.message || 'Could not read file' });
    }
  };

  const downloadBulkSheetTemplate = async () => {
    try {
      if (!bulkTemplate) return;
      const mail = parseOfferMailConfig(bulkTemplate);
      const keys = getOfferRequiredPlaceholderKeys(
        getOfferTemplatePlaceholderKeys(bulkTemplate.html_content || '', mail),
      )
        .filter((k) => !OFFER_COMPANY_SENDER_KEYS.has(k) && k !== 'ref_number')
        .map((k) => (k === 'recipient_name' ? 'candidate_name' : k));
      const headers = [...new Set(keys)];
      if (!headers.includes('candidate_name')) headers.unshift('candidate_name');
      if (!headers.includes('recipient_email')) headers.splice(1, 0, 'recipient_email');
      const sampleBase = headers.map((h) => (h === 'candidate_name' ? 'John Doe' : h === 'recipient_email' ? 'john@example.com' : ''));
      await downloadPlaceholderExcelTemplate(
        headers,
        sampleBase,
        'offer-letters-bulk-template.xlsx',
        'Candidates',
      );
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Download failed', description: err?.message || 'Could not create template' });
    }
  };

  const generateBulkLetters = async () => {
    if (!bulkTemplate) return;
    const mailCfg = parseOfferMailConfig(bulkTemplate);
    const templateKeys = getOfferTemplatePlaceholderKeys(bulkTemplate.html_content || '', mailCfg);
    const required = getOfferRequiredPlaceholderKeys(templateKeys);
    const companyKeys = required.filter((k) => OFFER_COMPANY_SENDER_KEYS.has(k));
    for (const k of companyKeys) {
      if (!String((bulkCompany as any)[k] ?? '').trim()) {
        toast({
          variant: 'destructive',
          title: 'Fill company/sender fields',
          description: `Missing: ${offerPlaceholderLabel(k)}`,
        });
        return;
      }
    }
    const valid = bulkCandidates.filter((c) => {
      for (const k of required) {
        if (OFFER_COMPANY_SENDER_KEYS.has(k) || k === 'date' || k === 'ref_number') continue;
        if (k === 'candidate_name' || k === 'recipient_name') {
          if (!c.candidate_name.trim()) return false;
          continue;
        }
        if (OFFER_BULK_CANDIDATE_KEYS.has(k)) {
          if (!String((c as any)[k] ?? '').trim()) return false;
        } else if (!String(bulkExtraByRowId[c.id]?.[k] ?? '').trim()) {
          return false;
        }
      }
      return true;
    });
    if (valid.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Fill all template placeholders',
        description: 'Every row must include all fields used in this template before send.',
      });
      return;
    }
    setBulkGenerating(true);
    const succeeded: string[] = [];
    const failed: string[] = [];
    const sentUnrecorded: string[] = [];
    try {
      const mailCfg = parseOfferMailConfig(bulkTemplate);
      for (const candidate of valid) {
        try {
          const refNum = `OL-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
          const values = withOfferFallbackValues({
            candidate_name: candidate.candidate_name,
            recipient_name: candidate.candidate_name,
            recipient_email: candidate.recipient_email,
            role_title: candidate.role_title || bulkTemplate.role_title,
            department: candidate.department,
            start_date: candidate.start_date,
            salary: candidate.salary,
            reporting_to: candidate.reporting_to,
            deadline: candidate.deadline,
            sender_name: bulkCompany.sender_name,
            sender_title: bulkCompany.sender_title,
            sender_email: bulkCompany.sender_email,
            company_name: bulkCompany.company_name,
            company_address: bulkCompany.company_address,
            company_website: bulkCompany.company_website,
            company_phone: bulkCompany.company_phone,
            ref_number: refNum,
            work_location: candidate.work_location,
            employment_type: candidate.employment_type,
            probation_period: candidate.probation_period,
            ...(bulkExtraByRowId[candidate.id] || {}),
          });
          const finalHtml = renderOfferPlaceholders(bulkTemplate.html_content, values);
          const renderedSubject = renderOfferPlaceholders(mailCfg.mail_subject, values).trim();
          const renderedBody = renderOfferPlaceholders(mailCfg.mail_body || '', values);
          const recipientTokenKey = (mailCfg.recipient_email_placeholder || 'recipient_email').replace(/^\{\{|\}\}$/g, '');
          const resolvedTo = values[recipientTokenKey] || candidate.recipient_email;
          const attachmentName = renderOfferPlaceholders(
            mailCfg.pdf_filename_pattern || '{{candidate_name}}_OfferLetter.pdf',
            values,
          ).trim().replace(/\s+/g, '_');

          let pdfBase64 = '';
          try {
            const { buildHtmlDocumentPdfBase64 } = await import('@/utils/offerLetterPdf');
            pdfBase64 = await buildHtmlDocumentPdfBase64(finalHtml);
          } catch (pdfErr: any) {
            throw new Error(pdfErr?.message || 'PDF generation failed');
          }

          // Always use the template mail body (with placeholders filled).
          const emailHtml = /<\/?[a-z][\s\S]*>/i.test(renderedBody)
            ? renderedBody
            : wrapOfferEmailPlainBody(renderedBody, {
                ...sendForm,
                recipient_name: candidate.candidate_name,
                company_name: bulkCompany.company_name,
                sender_name: bulkCompany.sender_name,
                sender_title: bulkCompany.sender_title,
                sender_email: bulkCompany.sender_email,
                company_address: bulkCompany.company_address,
              });

          const sendResult = await api.offerLetters.send({
            template_id: bulkTemplate.id,
            recipient_name: candidate.candidate_name,
            recipient_email: resolvedTo,
            role_title: candidate.role_title || bulkTemplate.role_title,
            html_content: finalHtml,
            email_subject: renderedSubject || `Offer Letter — ${candidate.role_title || bulkTemplate.role_title}`,
            email_html: emailHtml,
            attachment_name: attachmentName || `Offer_Letter_${candidate.candidate_name.replace(/\s+/g, '_')}.pdf`,
            status: 'sent',
            pdf_base64: pdfBase64,
          });
          if (sendResult?.record_saved === false) {
            sentUnrecorded.push(candidate.candidate_name);
          } else {
            succeeded.push(candidate.candidate_name);
          }
        } catch (err: any) {
          console.error('Bulk offer send failed', candidate.candidate_name, err);
          failed.push(
            `${candidate.candidate_name}${err?.message ? ` (${String(err.message).slice(0, 120)})` : ''}`,
          );
        }
      }
      const total = valid.length;
      const okCount = succeeded.length + sentUnrecorded.length;
      if (okCount > 0) {
        void notifyOrgAdminsBulkAction('offer_letters', okCount, bulkTemplate.template_name || undefined);
      }
      if (failed.length === 0 && sentUnrecorded.length === 0) {
        toast({ title: `${succeeded.length} offer letter(s) generated!`, description: 'Records saved. You can preview/print from Sent Letters tab.' });
        setShowBulk(false);
      } else {
        const parts: string[] = [`Sent ${succeeded.length + sentUnrecorded.length} of ${total}`];
        if (sentUnrecorded.length > 0) {
          parts.push(`emailed but record not saved (do NOT resend): ${sentUnrecorded.join(', ')}`);
        }
        if (failed.length > 0) {
          parts.push(`failed (safe to retry): ${failed.join(', ')}`);
        }
        toast({
          variant: 'destructive',
          title: 'Bulk send incomplete',
          description: parts.join('; '),
        });
        if (succeeded.length + sentUnrecorded.length > 0) setShowBulk(false);
      }
      void fetchData({ silent: true });
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
    finally { setBulkGenerating(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  // Full-screen editor view
  if (showEditor) {
    const layoutTools = (
      <div className="flex flex-col gap-1.5 w-full">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1">Page</p>
        <Button
          variant={layoutLocked ? 'default' : 'outline'}
          size="sm"
          className="h-8 w-full justify-start text-xs gap-1.5"
          onClick={() => setLayoutLocked((v) => !v)}
          title={layoutLocked ? 'Unlock to move letter margins / change background' : 'Lock background and letter margins'}
        >
          {layoutLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          {layoutLocked ? 'Layout locked' : 'Lock layout'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-full justify-start text-xs gap-1.5"
          disabled={layoutLocked}
          onClick={() => letterheadInputRef.current?.click()}
          title={layoutLocked ? 'Unlock layout to change background' : undefined}
        >
          <Image className="h-3.5 w-3.5" />{letterheadImage ? 'Change Background' : 'Background Image'}
        </Button>
        {letterheadImage ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-full justify-start text-xs gap-1.5 text-destructive hover:text-destructive"
            disabled={layoutLocked}
            onClick={removeLetterhead}
          >
            <Trash2 className="h-3.5 w-3.5" />Remove BG
          </Button>
        ) : null}
        <input ref={letterheadInputRef} type="file" accept="image/*" onChange={handleLetterheadUpload} className="hidden" />
        <Button variant="outline" size="sm" className="h-8 w-full justify-start text-xs gap-1.5" onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" />Import
        </Button>
        <Button variant="outline" size="sm" className="h-8 w-full justify-start text-xs gap-1.5" onClick={handleExportTemplate}>
          <Download className="h-3.5 w-3.5" />Export
        </Button>
        <input ref={fileInputRef} type="file" accept=".html,.htm" onChange={handleImportFile} className="hidden" />
        <Button
          variant={showPlaceholderPanel ? 'default' : 'outline'}
          size="sm"
          className="h-8 w-full justify-start text-xs gap-1.5"
          onClick={() => setShowPlaceholderPanel((v) => !v)}
        >
          <Variable className="h-3.5 w-3.5" />Placeholders
        </Button>
        <Button variant="outline" size="sm" className="h-8 w-full justify-start text-xs gap-1.5" onClick={addPage}>
          <FilePlus className="h-3.5 w-3.5" />Add Page
        </Button>
        {pages.length > 1 ? (
          <div className="flex flex-col gap-1 pt-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1">Pages</p>
            {pages.map((_, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <Button
                  variant={currentPage === idx ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 flex-1 text-xs"
                  onClick={() => switchPage(idx)}
                >
                  Page {idx + 1}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 px-0 text-destructive"
                  onClick={(e) => { e.stopPropagation(); removePage(idx); }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );

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
            {editingTemplate ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setEditingTemplate(null);
                  setTemplateForm((f) => ({
                    ...f,
                    template_name: `${f.template_name || 'Template'} (Copy)`,
                  }));
                  toast({
                    title: 'Duplicated',
                    description: 'Editing a copy — Create will save a new template.',
                  });
                }}
              >
                <Copy className="h-3.5 w-3.5" /> Duplicate
              </Button>
            ) : null}
            <Button size="sm" onClick={saveTemplate} disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {editingTemplate ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>

        {/* Left tools + full-page canvas + placeholders */}
        <div className="flex-1 overflow-hidden flex min-h-0">
          <div className="flex-1 min-w-0 overflow-hidden">
            <DocumentTemplateEditor
              key={`offer-page-${currentPage}-${editingTemplate?.id || 'new'}`}
              editorKey={`offer-page-${currentPage}`}
              value={extractContentAreaHtml(pages[currentPage] || DEFAULT_TEMPLATE)}
              onChange={updateVisualContent}
              backgroundImage={letterheadImage || undefined}
              contentPadding={`${contentPadding.top}mm ${contentPadding.right}mm ${contentPadding.bottom}mm ${contentPadding.left}mm`}
              placeholder="Click letter text to edit. Use Move text (blue bar) to drag it on the page. Add Text box for extra fields."
              enableTextBoxes
              textBoxes={pageTextBoxes[currentPage] || []}
              onTextBoxesChange={updatePageTextBoxes}
              bodyBox={pageBodyBoxes[currentPage] || DEFAULT_OFFER_BODY_BOX}
              onBodyBoxChange={updatePageBodyBox}
              layoutLocked={layoutLocked}
              documentCss={extractDocumentCss(pages[currentPage] || DEFAULT_TEMPLATE)}
              toolbarPlacement="left"
              toolbarExtra={layoutTools}
            />
          </div>
          {showPlaceholderPanel ? (
            <aside className="w-[320px] shrink-0 border-l bg-background overflow-y-auto flex flex-col">
              <PlaceholderPalette
                className="border-0 rounded-none"
                documentHtml={`${pages[currentPage] || ''}\n${templateForm.mail_subject || ''}\n${templateForm.mail_body || ''}\n${templateForm.pdf_filename_pattern || ''}`}
                onInsert={insertPlaceholder}
              />
              <div className="p-3 space-y-2">
                <p className="text-xs font-semibold">Email & PDF file</p>
                <div>
                  <Label className="text-[10px]">Mail subject</Label>
                  <Input className="h-8 text-xs" value={templateForm.mail_subject} onChange={(e) => setTemplateForm((f) => ({ ...f, mail_subject: e.target.value }))} placeholder="Offer — {{candidate_name}}" />
                </div>
                <div>
                  <Label className="text-[10px]">Mail body (HTML)</Label>
                  <Textarea
                    ref={(el) => {
                      if (!el) return;
                      el.style.height = 'auto';
                      el.style.height = `${Math.max(el.scrollHeight, 120)}px`;
                    }}
                    className="text-xs min-h-[120px] resize-none overflow-hidden border-0 shadow-none focus-visible:ring-0 bg-muted/30 rounded-md px-2 py-2"
                    value={templateForm.mail_body}
                    onChange={(e) => {
                      const el = e.currentTarget;
                      el.style.height = 'auto';
                      el.style.height = `${Math.max(el.scrollHeight, 120)}px`;
                      setTemplateForm((f) => ({ ...f, mail_body: e.target.value }));
                    }}
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Recipient email placeholder</Label>
                  <Input className="h-8 text-xs font-mono" value={templateForm.recipient_email_placeholder} onChange={(e) => setTemplateForm((f) => ({ ...f, recipient_email_placeholder: e.target.value }))} placeholder="recipient_email" />
                </div>
                <div>
                  <Label className="text-[10px]">PDF file name pattern</Label>
                  <Input className="h-8 text-xs font-mono" value={templateForm.pdf_filename_pattern} onChange={(e) => setTemplateForm((f) => ({ ...f, pdf_filename_pattern: e.target.value }))} placeholder="{{candidate_name}}_OfferLetter.pdf" />
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    );
  }

  // Full-page bulk generate view
  if (showBulk && bulkTemplate) {
    const bulkMailCfg = parseOfferMailConfig(bulkTemplate);
    const bulkTemplateKeys = getOfferTemplatePlaceholderKeys(
      bulkTemplate.html_content || '',
      bulkMailCfg,
    );
    const bulkRequiredKeys = getOfferRequiredPlaceholderKeys(bulkTemplateKeys).filter(
      (k) => !(k === 'recipient_name' && bulkTemplateKeys.includes('candidate_name')),
    );
    const bulkCompanyKeys = bulkRequiredKeys.filter((k) => OFFER_COMPANY_SENDER_KEYS.has(k));
    const bulkRowKeys = bulkRequiredKeys.filter((k) => !OFFER_COMPANY_SENDER_KEYS.has(k));
    const BULK_FIELDS = bulkRowKeys.map((k) => ({
      key: k === 'recipient_name' ? 'candidate_name' : (OFFER_BULK_CANDIDATE_KEYS.has(k) ? k : k),
      label: `${offerPlaceholderLabel(k === 'recipient_name' ? 'candidate_name' : k)} *`,
      placeholder: offerPlaceholderLabel(k === 'recipient_name' ? 'candidate_name' : k),
      extra: !OFFER_BULK_CANDIDATE_KEYS.has(k === 'recipient_name' ? 'candidate_name' : k),
      placeholderKey: k === 'recipient_name' ? 'candidate_name' : k,
    })).filter((f, idx, arr) => arr.findIndex((x) => x.key === f.key) === idx);

    const applyBulkFill = () => {
      const key = bulkFillField.trim();
      if (!key) return;
      const targets = bulkSelectedRowIds.length ? new Set(bulkSelectedRowIds) : new Set(bulkCandidates.map((c) => c.id));
      if (OFFER_BULK_CANDIDATE_KEYS.has(key) || key === 'candidate_name') {
        setBulkCandidates((prev) => prev.map((c) => (targets.has(c.id) ? { ...c, [key]: bulkFillValue } : c)));
      } else {
        setBulkExtraByRowId((prev) => {
          const next = { ...prev };
          for (const rowId of targets) {
            next[rowId] = { ...(next[rowId] || {}), [key]: bulkFillValue };
          }
          return next;
        });
      }
      toast({ title: 'Value applied', description: `Filled ${targets.size} row(s).` });
    };

    const applyLeadToBulkRow = (rowId: string, lead: any) => {
      const mapped = mapLeadToOfferPlaceholderValues(lead, bulkTemplateKeys);
      const current = bulkCandidates.find((c) => c.id === rowId);
      if (!current) return;
      const applied = applyMappedValuesToBulkRow(mapped, current as any, bulkExtraByRowId[rowId] || {});
      setBulkCandidates((prev) =>
        prev.map((c) => (c.id === rowId ? ({ ...c, ...applied.row } as typeof c) : c)),
      );
      setBulkExtraByRowId((ex) => ({ ...ex, [rowId]: applied.extras }));
      setBulkLeadSuggestRowId(null);
      toast({
        title: 'Lead applied',
        description: `Filled ${Object.keys(mapped).length} matching field(s).`,
      });
    };

    const bulkRowComplete = (c: typeof bulkCandidates[0]) => {
      for (const f of BULK_FIELDS) {
        const val = f.extra
          ? String(bulkExtraByRowId[c.id]?.[f.key] ?? '').trim()
          : String((c as any)[f.key] ?? '').trim();
        if (!val) return false;
      }
      for (const k of bulkCompanyKeys) {
        if (!String((bulkCompany as any)[k] ?? '').trim()) return false;
      }
      return true;
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Bulk Generate Offer Letters</h1>
            <p className="text-xs text-muted-foreground">
              Template: <strong>{bulkTemplate.template_name}</strong> — columns are only placeholders used in this letter
              {BULK_FIELDS.length || bulkCompanyKeys.length
                ? ` (${[...BULK_FIELDS.map((f) => f.key), ...bulkCompanyKeys].map((k) => `{{${k}}}`).join(", ")})`
                : ""}
              . Import Excel or type rows.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void downloadBulkSheetTemplate()}>
              <Download className="h-3.5 w-3.5" /> Excel template
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => bulkSheetInputRef.current?.click()}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> Import Excel
            </Button>
            <input
              ref={bulkSheetInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleBulkSheetImport(f);
                e.target.value = '';
              }}
            />
            <Button variant="outline" size="sm" onClick={() => setShowBulk(false)}>Cancel</Button>
            <Button size="sm" onClick={generateBulkLetters} disabled={bulkGenerating} className="gap-1.5">
              {bulkGenerating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Generate {bulkCandidates.filter(bulkRowComplete).length} Letter(s)
            </Button>
          </div>
        </div>

        {bulkCompanyKeys.length > 0 ? (
        <Card>
          <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Company & Sender (from template)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 pb-4">
            {bulkCompanyKeys.map((k) => (
              <div key={k}>
                <Label className="text-[10px]">{offerPlaceholderLabel(k)} *</Label>
                <Input
                  className="h-8 text-xs"
                  value={String((bulkCompany as any)[k] ?? '')}
                  onChange={(e) => setBulkCompany((p) => ({ ...p, [k]: e.target.value }))}
                  placeholder={offerPlaceholderLabel(k)}
                />
              </div>
            ))}
          </CardContent>
        </Card>
        ) : null}

        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Fill selected rows</CardTitle>
            <CardDescription className="text-xs">
              Pick a column, type once, then apply to selected rows (Excel-like fill down).
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-[220px_1fr_auto] gap-2 items-end">
            <div>
              <Label className="text-[10px]">Column</Label>
              <select
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                value={bulkFillField}
                onChange={(e) => setBulkFillField(e.target.value)}
              >
                <option value="">Select column</option>
                {BULK_FIELDS.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-[10px]">Value</Label>
              <Input className="h-8 text-xs" value={bulkFillValue} onChange={(e) => setBulkFillValue(e.target.value)} />
            </div>
            <Button type="button" className="h-8 text-xs" variant="outline" onClick={applyBulkFill} disabled={!bulkFillField}>
              Apply
            </Button>
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
                    <th className="px-2 py-2 w-8">
                      <Checkbox
                        checked={bulkSelectedRowIds.length > 0 && bulkSelectedRowIds.length === bulkCandidates.length}
                        onCheckedChange={(v) => setBulkSelectedRowIds(v === true ? bulkCandidates.map((c) => c.id) : [])}
                      />
                    </th>
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
                      <td className="px-2 py-1">
                        <Checkbox checked={bulkSelectedRowIds.includes(c.id)} onCheckedChange={() => toggleBulkRow(c.id)} />
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                      {BULK_FIELDS.map(f => (
                        <td key={f.key} className="px-1 py-1 relative">
                          <Input
                            className="h-7 text-xs min-w-[100px]"
                            value={(() => {
                              if (f.extra) return String(bulkExtraByRowId[c.id]?.[f.key] ?? '');
                              return String((c as any)[f.key] ?? '');
                            })()}
                            onChange={e => {
                              const v = e.target.value;
                              if (f.extra) setBulkExtraValue(c.id, f.key, v);
                              else updateBulkCandidate(c.id, f.key, v);
                              if (f.key === 'candidate_name') {
                                setBulkLeadSuggestRowId(v.trim().length >= 2 ? c.id : null);
                              }
                            }}
                            onFocus={() => {
                              if (f.key === 'candidate_name' && c.candidate_name.trim().length >= 2) {
                                setBulkLeadSuggestRowId(c.id);
                              }
                            }}
                            onBlur={() => {
                              window.setTimeout(() => {
                                setBulkLeadSuggestRowId((cur) => (cur === c.id ? null : cur));
                              }, 150);
                            }}
                            placeholder={f.placeholder}
                            autoComplete="off"
                          />
                          {f.key === 'candidate_name' && bulkLeadSuggestRowId === c.id && c.candidate_name.trim().length >= 2 ? (
                            <div className="absolute z-30 left-1 right-1 mt-0.5 max-h-40 overflow-y-auto rounded-md border bg-popover shadow-md py-1">
                              {(() => {
                                const matches = offerLeads
                                  .filter((l) =>
                                    String(l?.name || '')
                                      .toLowerCase()
                                      .includes(c.candidate_name.trim().toLowerCase()),
                                  )
                                  .slice(0, 6);
                                if (matches.length === 0) {
                                  return (
                                    <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                                      No matching leads
                                    </div>
                                  );
                                }
                                return matches.map((lead) => (
                                  <button
                                    key={lead.id}
                                    type="button"
                                    className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-muted/80"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => applyLeadToBulkRow(c.id, lead)}
                                  >
                                    <span className="font-medium block truncate">{lead.name}</span>
                                    <span className="text-muted-foreground truncate block">
                                      {[lead.email, lead.phone].filter(Boolean).join(' · ')}
                                    </span>
                                  </button>
                                ));
                              })()}
                            </div>
                          ) : null}
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
          <TabsTrigger value="forms" className="gap-1.5"><Users className="h-3.5 w-3.5" />Forms</TabsTrigger>
          <TabsTrigger value="sent" className="gap-1.5"><Send className="h-3.5 w-3.5" />Sent Letters</TabsTrigger>
          <TabsTrigger value="issued" className="gap-1.5"><Mail className="h-3.5 w-3.5" />Issued</TabsTrigger>
        </TabsList>

        <TabsContent value="forms">
          <DocFormsWorkspace formType="offer_letter" />
        </TabsContent>

        <TabsContent value="issued">
          <DocIssuedPanel docKind="offer_letter" />
        </TabsContent>

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
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => duplicateTemplate(t)}><Copy className="h-3 w-3" />Duplicate</Button>
                      <Button size="sm" className="h-7 text-xs gap-1" onClick={() => void openSendDialog(t)}><Send className="h-3 w-3" />Send</Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => void openBulkGenerate(t)}><Users className="h-3 w-3" />Bulk</Button>
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
            {splitPages(previewHtml).map((pageHtml, idx, arr) => (
              <div key={idx} className="relative">
                {arr.length > 1 && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-background border rounded px-2 py-0.5 text-[10px] text-muted-foreground z-10">Page {idx + 1} of {arr.length}</div>
                )}
                <iframe srcDoc={pageHtml} className="bg-white shadow-lg" style={{ width: '210mm', height: '297mm', border: 'none', overflow: 'hidden' }} title={`Preview Page ${idx + 1}`} sandbox="allow-same-origin" />
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
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm">Template placeholders</CardTitle>
                    <CardDescription className="text-xs">
                      Only placeholders used in this template
                      {sendRequiredKeys.length
                        ? ` (${sendRequiredKeys
                            .filter((k) => !(k === 'recipient_name' && sendRequiredKeys.includes('candidate_name')))
                            .map((k) => `{{${k}}}`)
                            .join(', ')})`
                        : ''}
                      . All required. Type a name to search leads and autofill matching fields.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-4 pb-4">
                    {sendRequiredKeys.length === 0 ? (
                      <p className="text-xs text-muted-foreground sm:col-span-2">
                        No fillable placeholders found in this template.
                      </p>
                    ) : (
                      sendRequiredKeys
                        .filter((key) => !(key === 'recipient_name' && sendRequiredKeys.includes('candidate_name')))
                        .map((key) => {
                        const isName = key === 'candidate_name' || key === 'recipient_name';
                        const value = getOfferPlaceholderValue(key, sendForm as any, sendExtraValues);
                        return (
                          <div key={key} className={isName ? 'relative sm:col-span-2' : undefined}>
                            <Label className="text-xs">
                              {offerPlaceholderLabel(key)} *
                              <span className="ml-1 font-mono text-[10px] text-muted-foreground">{`{{${key}}}`}</span>
                            </Label>
                            <Input
                              type={key.includes('email') ? 'email' : 'text'}
                              value={isName ? (leadSuggestQuery || value) : value}
                              onChange={(e) => setSendPlaceholderValue(key, e.target.value)}
                              onFocus={() => {
                                if (isName && (leadSuggestQuery || value).trim().length >= 2) {
                                  setLeadSuggestOpen(true);
                                }
                              }}
                              onBlur={() => {
                                window.setTimeout(() => setLeadSuggestOpen(false), 150);
                              }}
                              placeholder={offerPlaceholderLabel(key)}
                              autoComplete="off"
                            />
                            {isName && leadSuggestOpen && leadNameSuggestions.length > 0 ? (
                              <div className="absolute z-20 left-0 right-0 mt-1 max-h-52 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md py-1">
                                {leadNameSuggestions.map((lead) => (
                                  <button
                                    key={lead.id}
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted/80"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => applyLeadToSend(lead)}
                                  >
                                    <span className="font-medium block truncate">{lead.name}</span>
                                    <span className="text-[11px] text-muted-foreground truncate block">
                                      {[lead.email, lead.phone, lead.college].filter(Boolean).join(' · ') || 'Lead'}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </CardContent>
                </Card>
                <div className="flex justify-end">
                  <Button
                    onClick={() => {
                      if (!assertSendPlaceholdersFilled()) return;
                      setSendTab('letter');
                    }}
                    className="gap-1.5"
                  >
                    Next: Preview Letter <Eye className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="letter">
              <div className="space-y-4">
                <div className="overflow-auto max-h-[55vh] flex flex-col items-center gap-6 p-4 bg-gray-100 rounded-lg">
                  {sendTemplate &&
                    (() => {
                      const filled = replacePlaceholders(sendTemplate.html_content);
                      const { normalized } = normalizeOfferPages(splitPages(filled));
                      return normalized.map((pageHtml, idx, arr) => (
                      <div key={idx} className="relative shrink-0">
                        {arr.length > 1 && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-background border rounded px-2 py-0.5 text-[10px] text-muted-foreground z-10">
                            Page {idx + 1} of {arr.length}
                          </div>
                        )}
                        <iframe
                          srcDoc={pageHtml}
                          className="bg-white shadow-lg"
                          style={{ width: '210mm', height: '297mm', border: 'none', overflow: 'hidden' }}
                          title={`Offer Letter Preview Page ${idx + 1}`}
                          sandbox="allow-same-origin"
                        />
                      </div>
                      ));
                    })()}
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
                        Body and subject come from this template&apos;s Mail settings (placeholders already filled). Edit before sending. Sent from hr@syncpedia.in.
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
                          rows={18}
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
