import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import {
  Award,
  Bold,
  Check,
  Copy,
  Download,
  Eye,
  FileDown,
  Italic,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Trash2,
  Archive,
  Send,
  Type,
  Image as ImageIcon,
  FileSpreadsheet,
  ChevronLeft,
  Lock,
  Unlock,
  Variable,
  Users,
  Loader2,
  FileText,
  Minus,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TEMPLATE_FONT_FACES, TEMPLATE_FONT_SIZES, matchTemplateFontFace, matchTemplateFontSize } from "@/components/templates/DocumentTemplateEditor";
import { CanvasTextBoxFrame, cycleTextBoxDivider, normalizeTextBoxDivider } from "@/components/templates/CanvasTextBoxFrame";
import { DocFormsWorkspace, DocIssuedPanel } from "@/modules/docForms/DocFormsHub";
import { applyPlaceholders, extractPlaceholderKeys } from "@/modules/docForms/types";
import {
  downloadPlaceholderExcelTemplate,
  mapSheetRowsToPlaceholders,
  parsePlaceholderSheetFile,
} from "@/lib/placeholderSheetImport";
import {
  applyCertPlaceholders,
  canonicalCertPlaceholderKey,
  certPlaceholderLabel,
  extractAnglePlaceholderLabels,
  getCertificateBulkRowKeys,
  getCertificateSharedKeys,
  getCertificateTemplatePlaceholderKeys,
  layerHasCertPlaceholderTokens,
} from "@/lib/certificatePlaceholders";
import { ProtectedUploadImage } from "@/components/ProtectedUploadImage";
import { PlaceholderPalette } from "@/components/templates/PlaceholderPalette";
import { resolveUploadSrc } from "@/lib/resumeHref";
import { buildCertificatePdfBase64, certPageSizePx } from "@/utils/certificatePdf";
import { createRoot } from "react-dom/client";

type CertStatus = "active" | "draft" | "archived";
type IssuedStatus = "issued" | "revoked" | "expired";
type CertType = string;
type CertTypeOption = { code: string; label: string; builtin?: boolean };
const CERT_TYPES: CertType[] = ["CC", "ID", "LR", "IN", "WS", "CS", "AI"];
const ADD_CERT_TYPE_VALUE = "__add_new_type__";
const DEFAULT_QR_FG = "#1A6B3C";
const BUILTIN_CERT_TYPE_OPTIONS: CertTypeOption[] = [
  { code: "CC", label: "Course Certificate", builtin: true },
  { code: "ID", label: "Industrial", builtin: true },
  { code: "LR", label: "Letter of Recommendation", builtin: true },
  { code: "IN", label: "Internship", builtin: true },
  { code: "WS", label: "Soft Skills", builtin: true },
  { code: "CS", label: "Cybersecurity", builtin: true },
  { code: "AI", label: "AICTE", builtin: true },
];
type LayoutStyle = "classic" | "dark-pro" | "elegant";

/** Physical paper size for certificate output (preview + print/PDF). */
type CertPageFormat =
  | "a4-landscape"
  | "a4-portrait"
  | "letter-landscape"
  | "letter-portrait"
  | "a5-landscape"
  | "a5-portrait"
  | "square";

type CertPageSpec = {
  id: CertPageFormat;
  label: string;
  shortLabel: string;
  widthMm: number;
  heightMm: number;
  /** CSS @page size value */
  cssPageSize: string;
  hint: string;
};

const CERT_PAGE_FORMATS: CertPageSpec[] = [
  {
    id: "a4-landscape",
    label: "A4 Landscape",
    shortLabel: "A4 ↔",
    widthMm: 297,
    heightMm: 210,
    cssPageSize: "A4 landscape",
    hint: "Most common certificate layout (29.7 × 21 cm)",
  },
  {
    id: "a4-portrait",
    label: "A4 Portrait",
    shortLabel: "A4 ↕",
    widthMm: 210,
    heightMm: 297,
    cssPageSize: "A4 portrait",
    hint: "Tall certificates / award letters (21 × 29.7 cm)",
  },
  {
    id: "letter-landscape",
    label: "Letter Landscape",
    shortLabel: "Letter ↔",
    widthMm: 279.4,
    heightMm: 215.9,
    cssPageSize: "letter landscape",
    hint: "US Letter sideways (11 × 8.5 in)",
  },
  {
    id: "letter-portrait",
    label: "Letter Portrait",
    shortLabel: "Letter ↕",
    widthMm: 215.9,
    heightMm: 279.4,
    cssPageSize: "letter portrait",
    hint: "US Letter upright (8.5 × 11 in)",
  },
  {
    id: "a5-landscape",
    label: "A5 Landscape",
    shortLabel: "A5 ↔",
    widthMm: 210,
    heightMm: 148,
    cssPageSize: "A5 landscape",
    hint: "Compact certificates / cards (21 × 14.8 cm)",
  },
  {
    id: "a5-portrait",
    label: "A5 Portrait",
    shortLabel: "A5 ↕",
    widthMm: 148,
    heightMm: 210,
    cssPageSize: "A5 portrait",
    hint: "Small upright certificate (14.8 × 21 cm)",
  },
  {
    id: "square",
    label: "Square",
    shortLabel: "□ Square",
    widthMm: 210,
    heightMm: 210,
    cssPageSize: "210mm 210mm",
    hint: "Square award / digital share format (21 × 21 cm)",
  },
];

const DEFAULT_CERT_PAGE_FORMAT: CertPageFormat = "a4-landscape";

function isCertPageFormat(value: unknown): value is CertPageFormat {
  return CERT_PAGE_FORMATS.some((f) => f.id === value);
}

function resolveCertPageFormat(pageFormat?: unknown): CertPageFormat {
  return isCertPageFormat(pageFormat) ? pageFormat : DEFAULT_CERT_PAGE_FORMAT;
}

function getCertPageSpec(format?: CertPageFormat | null | unknown): CertPageSpec {
  const id = resolveCertPageFormat(format);
  return CERT_PAGE_FORMATS.find((f) => f.id === id) || CERT_PAGE_FORMATS[0];
}

function certPageIsPortrait(format?: CertPageFormat | null | unknown): boolean {
  const spec = getCertPageSpec(format);
  return spec.heightMm > spec.widthMm;
}

/** Scale certificate preview to fit available space (portrait + landscape). */
function CertificatePreviewFit({
  pageFormat,
  className,
  children,
}: {
  pageFormat?: CertPageFormat;
  className?: string;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ width: number; height: number; scale: number } | null>(null);
  const pageSpec = getCertPageSpec(pageFormat);
  // Same CSS px as captureCertificatePdfBase64 — font px stay consistent with emailed PDF.
  const { widthPx: designW, heightPx: designH } = certPageSizePx(pageSpec);
  const aspect = pageSpec.widthMm / pageSpec.heightMm;
  const isPortrait = certPageIsPortrait(pageFormat);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (cw <= 0 || ch <= 0) return;
      // Contain: fit full page inside the box without cropping.
      let width = cw;
      let height = width / aspect;
      if (height > ch) {
        height = ch;
        width = height * aspect;
      }
      const fitW = Math.floor(Math.max(80, width));
      const fitH = Math.floor(Math.max(80, height));
      setFit({
        width: fitW,
        height: fitH,
        scale: fitW / Math.max(1, designW),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect, pageFormat, designW]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex min-h-0 w-full items-center justify-center overflow-hidden",
        isPortrait ? "min-h-[200px]" : undefined,
        className,
      )}
    >
      <div
        className="mx-auto shrink-0 relative overflow-hidden"
        style={
          fit
            ? { width: fit.width, height: fit.height, maxWidth: "100%" }
            : { width: "100%", aspectRatio: String(aspect), maxWidth: "100%", maxHeight: "100%" }
        }
      >
        {fit ? (
          <div
            style={{
              width: designW,
              height: designH,
              transform: `scale(${fit.scale})`,
              transformOrigin: "top left",
            }}
          >
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/**
 * Card/list thumbnail.
 * Landscape keeps the classic scale preview (stable, full page visible).
 * Portrait uses contain-fit so the tall page is not clipped.
 */
function CertificatePreviewThumb({
  template,
  height = 140,
  className,
  ...previewProps
}: {
  template: CertTemplate;
  height?: number;
  className?: string;
} & Omit<
  ComponentProps<typeof CertificatePreview>,
  "template" | "scale"
>) {
  const isPortrait = certPageIsPortrait(template.style.pageFormat);

  if (!isPortrait) {
    // Same design px as PDF capture, then scale — keeps font proportions correct.
    const { widthPx: designW, heightPx: designH } = certPageSizePx(
      getCertPageSpec(template.style.pageFormat),
    );
    const scale = height / Math.max(1, designH);
    return (
      <div
        className={cn("overflow-hidden rounded-md w-full bg-gray-100", className)}
        style={{ height, position: "relative" }}
      >
        <div
          style={{
            width: designW,
            height: designH,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            pointerEvents: "none",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        >
          <CertificatePreview template={template} renderPdfBackground {...previewProps} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("overflow-hidden rounded-md w-full bg-gray-100 flex flex-col", className)}
      style={{ height }}
    >
      <CertificatePreviewFit pageFormat={template.style.pageFormat} className="flex-1 min-h-0 h-full">
        <CertificatePreview template={template} renderPdfBackground {...previewProps} />
      </CertificatePreviewFit>
    </div>
  );
}

const CERT_TYPE_LABELS: Record<string, string> = {
  CC: "Course Certificate",
  ID: "Industrial",
  LR: "Letter of Recommendation",
  IN: "Internship",
  WS: "Soft Skills",
  CS: "Cybersecurity",
  AI: "AICTE",
};

const CERT_TYPE_COLORS: Record<string, string> = {
  CC: "bg-teal-100 text-teal-800",
  ID: "bg-amber-100 text-amber-800",
  LR: "bg-purple-100 text-purple-800",
  IN: "bg-blue-100 text-blue-800",
  WS: "bg-red-100 text-red-800",
  CS: "bg-cyan-100 text-cyan-800",
  AI: "bg-emerald-100 text-emerald-800",
};

function parseCertTypeOptions(raw: unknown): CertTypeOption[] {
  if (!Array.isArray(raw)) return [...BUILTIN_CERT_TYPE_OPTIONS];
  const seen = new Set<string>();
  const extra: CertTypeOption[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const code = normalizeCertType(rec.code ?? rec.certType);
    const label = String(rec.label ?? rec.name ?? "").trim();
    if (!isCertType(code) || seen.has(code) || CERT_TYPES.includes(code)) continue;
    seen.add(code);
    extra.push({ code, label: label || code, builtin: false });
  }
  return [...BUILTIN_CERT_TYPE_OPTIONS, ...extra];
}

function certTypeLabel(code: string, options?: CertTypeOption[]): string {
  const match = (options || BUILTIN_CERT_TYPE_OPTIONS).find((t) => t.code === code);
  if (match?.label) return match.label;
  return CERT_TYPE_LABELS[code] || code;
}

function certTypeBadgeClass(code: string): string {
  return CERT_TYPE_COLORS[code] || "bg-slate-100 text-slate-800";
}

interface CertTemplateStyle {
  layout: LayoutStyle;
  /** Physical page size + orientation for certificates. */
  pageFormat?: CertPageFormat;
  bgColor: string;
  accentColor: string;
  bgImage?: string;
  bgPdf?: string;
  bgOverlayOpacity?: number;
  /** Email compose uses these (placeholders like {{recipient_name}}, {{cert_id}}). */
  mail_subject?: string;
  mail_body?: string;
}

const DEFAULT_CERT_MAIL_SUBJECT = "Your Certificate is Ready — {{cert_id}}";
const DEFAULT_CERT_MAIL_BODY = `Dear {{recipient_name}},

We are pleased to inform you that your certificate has been successfully issued.

Please find the attached certificate (PDF) for your reference. You can also
verify your certificate anytime using your unique certificate ID: {{cert_id}}

If you have any questions or need assistance, please do not hesitate to reach out.

Warm regards,
The Certifications Team`;

function rewriteCertMailText(text: string): string {
  return String(text || "")
    .replace(/\{\{\s*sync_id\s*\}\}/gi, "{{cert_id}}")
    .replace(/\{\{\s*certificate_id\s*\}\}/gi, "{{cert_id}}")
    .replace(/\bSYNC ID\b/g, "certificate ID");
}

function parseCertMailConfig(template: CertTemplate | null | undefined): {
  mail_subject: string;
  mail_body: string;
} {
  const style = (template?.style || {}) as CertTemplateStyle;
  const subject = String(style.mail_subject || "").trim();
  const body = String(style.mail_body || "").trim();
  return {
    mail_subject: rewriteCertMailText(subject) || DEFAULT_CERT_MAIL_SUBJECT,
    mail_body: rewriteCertMailText(body) || DEFAULT_CERT_MAIL_BODY,
  };
}

interface CertTemplateFields {
  title: string;
  companyName?: string;
  recipientName: string;
  domainName: string;
  bodyText: string;
  logoLeftImage?: string;
  logoRightImage?: string;
  watermarkText?: string;
  watermarkImage?: string;
  signatureImage?: string;
  signatoryName: string;
  signatoryTitle: string;
}

type CertLayerType = "text" | "company" | "name" | "domain" | "date" | "certID" | "qr" | "logo" | "signature" | "image";

interface CertOrgContext {
  orgName: string;
  orgPrefix: string;
  logoUrl?: string;
}

interface CertLayer {
  id: string;
  type: CertLayerType;
  label: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: "normal" | "bold";
  fontStyle?: "normal" | "italic";
  align?: "left" | "center" | "right";
  opacity?: number;
  zIndex?: number;
  locked?: boolean;
  /** Optional divider line on the layer box (off by default). */
  divider?: "none" | "top" | "bottom";
}

interface CertTemplate {
  id: string;
  name: string;
  status: CertStatus;
  createdAt: string;
  certType: CertType;
  /** Org-wide 2-letter prefix used in AA-CS-XXXXXX. Not stored on the template row. */
  certPrefix?: string;
  style: CertTemplateStyle;
  fields: CertTemplateFields;
  layers: CertLayer[];
}

interface IssuedCertificate {
  id: string;
  templateId: string;
  templateName: string;
  recipientName: string;
  courseName: string;
  certType: CertType;
  issueDate: string;
  status: IssuedStatus;
  verifyToken?: string;
}

interface VerifyPayload {
  certId: string;
  template: CertTemplate;
  overrides: Partial<CertTemplateFields>;
}

const CERT_USED_IDS_KEY = "cert_used_ids_v1";
const MAX_SIGNATURE_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_TEMPLATE_IMAGE_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB
const MAX_BG_IMAGE_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB — uploaded via multipart, not JSON
const IMPORT_EDITABLE_LAYER_TYPES: CertLayerType[] = ["company", "name", "domain", "date", "certID", "qr", "logo", "text", "image", "signature"];

/** Built-in boxes always present on a certificate (position editable). */
const CERT_BUILTIN_LAYER_TYPES: Array<Extract<CertLayerType, "date" | "certID" | "qr">> = ["date", "certID", "qr"];

/** Optional typed fields (prefer <<placeholders>> inside text boxes instead). */
const TYPED_CERT_FIELD_TYPES: Array<{
  type: Extract<CertLayerType, "company" | "name" | "domain" | "date" | "certID">;
  label: string;
  sample: string;
}> = [
  { type: "name", label: "Name", sample: "<<Name>>" },
  { type: "domain", label: "Domain", sample: "<<Course>>" },
  { type: "date", label: "Date", sample: "<<Date>>" },
  { type: "company", label: "Company", sample: "Company Name" },
  { type: "certID", label: "Cert ID", sample: "<<CertID>>" },
];

function normalizeCertPrefix(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 2);
}

function certOrgPrefix(org: { slug?: string | null; name?: string | null; cert_prefix?: string | null } | null | undefined): string {
  const claimed = normalizeCertPrefix(org?.cert_prefix);
  if (claimed.length === 2) return claimed;
  const fromSlug = String(org?.slug ?? "")
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 2)
    .toUpperCase();
  if (fromSlug.length === 2) return fromSlug;
  const fromName = String(org?.name ?? "")
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 2)
    .toUpperCase();
  return fromName.length === 2 ? fromName : "OR";
}

function sampleCertIdPattern(certType: CertType, orgPrefix: string): string {
  const prefix = (normalizeCertPrefix(orgPrefix) || "OR").padEnd(2, "X").slice(0, 2);
  return `${prefix}-${certType}-XXXXXX`;
}

function isCertIdSampleOrAuto(id: string): boolean {
  const v = String(id || "").trim().toUpperCase();
  return (
    /^[A-Z]{2}-[A-Z]{2}-XXXXXX$/.test(v) ||
    /^[A-Z]{2}-[A-Z]{2}-\d{6}$/.test(v) ||
    /^[A-Z0-9]{2,6}-[A-Z]{2,3}-\d{8}-/.test(v) ||
    v.includes("SYNC-") ||
    v.includes("YYYYMMDD") ||
    v.includes("XXXXX") ||
    /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(v) ||
    /\bsync[_\s-]?id\b/i.test(String(id || ""))
  );
}

function applyCertNumberToLayers(layers: CertLayer[] | undefined, certType: CertType, orgPrefix: string): CertLayer[] {
  const sample = sampleCertIdPattern(certType, orgPrefix);
  return (layers || []).map((layer) => {
    if (layer.type !== "certID") {
      // Rewrite any leftover Sync ID wording in free text
      const content = String(layer.content || "")
        .replace(/<<\s*sync[_\s-]?id\s*>>/gi, "<<CertID>>")
        .replace(/\{\{\s*sync_id\s*\}\}/gi, "{{cert_id}}")
        .replace(/\bSYNC ID\b/g, "Cert ID")
        .replace(/\bSync ID\b/g, "Cert ID");
      if (content !== layer.content) return { ...layer, content };
      return layer;
    }
    const label = String(layer.label || "").replace(/\bsync\s*id\b/gi, "Cert ID") || "Certificate ID";
    if (!String(layer.content || "").trim() || isCertIdSampleOrAuto(layer.content)) {
      return { ...layer, label, content: sample };
    }
    return { ...layer, label };
  });
}

function buildDefaultImportLayers(ctx: CertOrgContext, certType: CertType = "CC"): CertLayer[] {
  const idSample = sampleCertIdPattern(certType, ctx.orgPrefix);
  // Built-ins only: Issue date, Cert ID, QR. Other fields go in text boxes via <<placeholders>>.
  return [
    {
      id: crypto.randomUUID(),
      type: "date",
      label: "Issue Date",
      content: "<<Date>>",
      x: 20,
      y: 88,
      width: 22,
      height: 5,
      fontSize: 11,
      fontWeight: "normal",
      color: "#555555",
      align: "left",
      opacity: 1,
      zIndex: 13,
      locked: false,
    },
    {
      id: crypto.randomUUID(),
      type: "certID",
      label: "Certificate ID",
      content: idSample,
      x: 24,
      y: 86,
      width: 28,
      height: 6,
      fontSize: 9,
      fontWeight: "normal",
      color: "#333333",
      align: "left",
      opacity: 1,
      zIndex: 14,
      locked: false,
    },
    {
      id: crypto.randomUUID(),
      type: "qr",
      label: "QR Code",
      content: "",
      x: 10,
      y: 82,
      width: 12,
      height: 12,
      color: DEFAULT_QR_FG,
      opacity: 1,
      zIndex: 15,
      locked: false,
    },
  ];
}

function ensureBuiltinCertLayers(layers: CertLayer[] | undefined, ctx: CertOrgContext, certType: CertType): CertLayer[] {
  const next = [...(layers || [])];
  const defaults = buildDefaultImportLayers(ctx, certType);
  for (const type of CERT_BUILTIN_LAYER_TYPES) {
    if (next.some((l) => l.type === type)) continue;
    const def = defaults.find((l) => l.type === type);
    if (def) next.push({ ...def, id: crypto.randomUUID() });
  }
  return applyCertNumberToLayers(next, certType, ctx.orgPrefix);
}

function sanitizeImportLayers(layers: CertLayer[], ctx: CertOrgContext, certType: CertType = "CC"): CertLayer[] {
  const filtered = (layers || []).filter((l) => IMPORT_EDITABLE_LAYER_TYPES.includes(l.type));
  return ensureBuiltinCertLayers(filtered, ctx, certType).map((l, idx) => ({ ...l, zIndex: idx + 10 }));
}

function generateCertId(type: CertType = "CC", orgPrefix = "OR"): string {
  const used = getUsedCertIds();
  const prefix = normalizeCertPrefix(orgPrefix) || "OR";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
    const candidate = `${prefix}-${type}-${String(n).padStart(6, "0")}`;
    if (!used.has(candidate)) {
      reserveCertId(candidate);
      return candidate;
    }
  }
  const fallback = `${prefix}-${type}-${String(Date.now() % 1_000_000).padStart(6, "0")}`;
  reserveCertId(fallback);
  return fallback;
}

function getUsedCertIds(): Set<string> {
  // Soft client-side dedupe only; server cert ID uniqueness is the source of truth.
  try {
    const raw = sessionStorage.getItem(CERT_USED_IDS_KEY);
    if (!raw) return new Set<string>();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((x) => typeof x === "string"));
  } catch {
    return new Set<string>();
  }
}

function reserveCertId(id: string) {
  try {
    const used = Array.from(getUsedCertIds());
    used.push(id);
    const deduped = Array.from(new Set(used)).slice(-2000);
    sessionStorage.setItem(CERT_USED_IDS_KEY, JSON.stringify(deduped));
  } catch {
    // no-op when storage is unavailable
  }
}

function toBase64Url(input: string): string {
  const b64 = btoa(unescape(encodeURIComponent(input)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "===".slice((b64.length + 3) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

function encodeVerifyPayload(payload: VerifyPayload): string {
  return toBase64Url(JSON.stringify(payload));
}

function decodeVerifyPayload(encoded: string): VerifyPayload | null {
  try {
    const raw = fromBase64Url(encoded);
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (typeof parsed.certId !== "string") return null;
    if (!isCertTemplate(parsed.template)) return null;
    if (!isRecord(parsed.overrides)) return null;
    return parsed as unknown as VerifyPayload;
  } catch {
    return null;
  }
}

function compactTemplateForVerify(template: CertTemplate): CertTemplate {
  return {
    ...template,
    style: {
      ...template.style,
      bgImage: undefined,
      bgPdf: undefined,
    },
    fields: {
      ...template.fields,
      signatureImage: undefined,
      watermarkImage: undefined,
      logoLeftImage: undefined,
      logoRightImage: undefined,
    },
    layers: (template.layers || []).map((layer) => {
      // Never embed binary/image payloads in the verify token (blows past QR limits).
      if (
        layer.type === "image" ||
        layer.type === "logo" ||
        layer.type === "signature" ||
        layer.type === "qr"
      ) {
        return { ...layer, content: "" };
      }
      const c = String(layer.content || "");
      if (c.startsWith("data:") || c.startsWith("blob:")) {
        return { ...layer, content: "" };
      }
      return layer;
    }),
  };
}

function resolveEmbeddedVerify(certId: string, token: string): {
  template: CertTemplate;
  overrides: Partial<CertTemplateFields>;
  certId: string;
} | null {
  const payload = decodeVerifyPayload(token);
  if (!payload?.template) return null;
  const normalizedCertId = decodeURIComponent(certId);
  if (payload.certId !== normalizedCertId && payload.certId !== certId) return null;
  return {
    template: payload.template,
    overrides: payload.overrides || {},
    certId: payload.certId,
  };
}

function getVerifyURL(certID: string, token?: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://app.syncpedia.com";
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${origin}/verify/${encodeURIComponent(certID)}${qs}`;
}

/** Practical ceiling for QR (byte mode) + browser URL usability. */
const QR_SAFE_URL_MAX_CHARS = 1200;

/**
 * Draft verify link. Embeds a compact template token only when it still fits QR/URL limits;
 * otherwise falls back to the short cert-id URL (avoids qrcode.react RangeError "Data too long").
 */
function buildDraftVerifyUrl(template: CertTemplate, certId: string, overrides: Partial<CertTemplateFields> = {}): string {
  const shortUrl = getVerifyURL(certId);
  try {
    const payload: VerifyPayload = {
      certId,
      template: compactTemplateForVerify(template),
      overrides,
    };
    const full = getVerifyURL(certId, encodeVerifyPayload(payload));
    if (full.length <= QR_SAFE_URL_MAX_CHARS) return full;
  } catch {
    /* ignore encode failures */
  }
  return shortUrl;
}

/** URL safe to pass into QRCodeSVG — never long enough to throw RangeError("Data too long"). */
function qrSafeVerifyUrl(certID: string, verifyUrl?: string): string {
  const shortUrl = getVerifyURL(certID);
  const candidate = (verifyUrl && verifyUrl.trim()) || shortUrl;
  return candidate.length <= QR_SAFE_URL_MAX_CHARS ? candidate : shortUrl;
}

function generateOpaqueVerifyToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const templateSeeds: CertTemplate[] = [
  {
    id: crypto.randomUUID(),
    name: "SYNCPedia Classic",
    status: "active",
    createdAt: "2024-01-15",
    certType: "CC",
    style: { layout: "classic", pageFormat: "a4-landscape", bgColor: "#ffffff", accentColor: "#1A6B3C" },
    fields: {
      title: "Certificate of Completion",
      recipientName: "John Doe",
      domainName: "Web Development Fundamentals",
      bodyText: "Has successfully completed the course with distinction.",
      signatoryName: "Dr. Aisha Patel",
      signatoryTitle: "Director of Education",
    },
    layers: [],
  },
  {
    id: crypto.randomUUID(),
    name: "Dark Pro",
    status: "active",
    createdAt: "2024-02-10",
    certType: "LR",
    style: { layout: "dark-pro", pageFormat: "a4-landscape", bgColor: "#0f172a", accentColor: "#f59e0b" },
    fields: {
      title: "Professional Certification",
      recipientName: "Jane Smith",
      domainName: "Advanced Data Science",
      bodyText: "Has demonstrated exceptional proficiency and professional excellence.",
      signatoryName: "Mr. Rohan Mehta",
      signatoryTitle: "Chief Learning Officer",
    },
    layers: [],
  },
  {
    id: crypto.randomUUID(),
    name: "Classic Elegant",
    status: "draft",
    createdAt: "2024-03-05",
    certType: "IN",
    style: { layout: "elegant", pageFormat: "a4-portrait", bgColor: "#fefce8", accentColor: "#1e3a5f" },
    fields: {
      title: "Internship Certificate",
      recipientName: "Alex Johnson",
      domainName: "Product Management Internship",
      bodyText: "Has successfully completed the internship program with commendable performance.",
      signatoryName: "Ms. Priya Sharma",
      signatoryTitle: "Head of Programs",
    },
    layers: [],
  },
];

function statusBadgeVariant(status: CertStatus): "default" | "secondary" | "outline" {
  if (status === "active") return "default";
  if (status === "draft") return "secondary";
  return "outline";
}

function issuedStatusBadgeVariant(status: IssuedStatus): "default" | "secondary" | "outline" | "destructive" {
  if (status === "issued") return "default";
  if (status === "expired") return "secondary";
  return "destructive";
}

function downloadTextFile(filename: string, content: string, mime = "application/json") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function templateToSvg(template: CertTemplate): string {
  const page = getCertPageSpec(template.style.pageFormat);
  const width = Math.round(page.widthMm * 10);
  const height = Math.round(page.heightMm * 10);
  const cx = Math.round(width / 2);
  const f = template.fields;
  const bg = template.style.bgColor || "#ffffff";
  const accent = template.style.accentColor || "#1A6B3C";
  const text = template.style.layout === "dark-pro" ? "#ffffff" : "#0f172a";
  const subtle = template.style.layout === "dark-pro" ? "#cbd5e1" : "#475569";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${escapeXml(bg)}"/>
  <rect x="0" y="0" width="${width}" height="16" fill="${escapeXml(accent)}"/>
  <text x="90" y="90" fill="${escapeXml(subtle)}" font-size="28" font-family="Arial" letter-spacing="4">${escapeXml((f.companyName || "").toUpperCase())}</text>
  <text x="${cx}" y="260" text-anchor="middle" fill="${escapeXml(text)}" font-size="74" font-weight="700" font-family="Arial">${escapeXml(f.title)}</text>
  <text x="${cx}" y="360" text-anchor="middle" fill="${escapeXml(subtle)}" font-size="34" font-family="Arial">This is to certify that</text>
  <text x="${cx}" y="460" text-anchor="middle" fill="${escapeXml(accent)}" font-size="72" font-weight="700" font-family="Arial">${escapeXml(f.recipientName)}</text>
  <text x="${cx}" y="560" text-anchor="middle" fill="${escapeXml(subtle)}" font-size="34" font-family="Arial">in recognition of successful completion of</text>
  <text x="${cx}" y="640" text-anchor="middle" fill="${escapeXml(text)}" font-size="56" font-weight="600" font-family="Arial">${escapeXml(f.domainName)}</text>
  <text x="${cx}" y="730" text-anchor="middle" fill="${escapeXml(subtle)}" font-size="34" font-family="Arial">${escapeXml(f.bodyText)}</text>
  <line x1="90" y1="${height - 280}" x2="640" y2="${height - 280}" stroke="${escapeXml(text)}" stroke-opacity="0.35" stroke-width="2"/>
  <text x="90" y="${height - 230}" fill="${escapeXml(text)}" font-size="34" font-weight="700" font-family="Arial">${escapeXml(f.signatoryName)}</text>
  <text x="90" y="${height - 190}" fill="${escapeXml(subtle)}" font-size="26" font-family="Arial">${escapeXml(f.signatoryTitle)}</text>
  <rect x="${width - 280}" y="${height - 360}" width="180" height="180" fill="none" stroke="${escapeXml(accent)}" stroke-width="6"/>
</svg>`;
}

function exportTemplateImage(template: CertTemplate) {
  const svg = templateToSvg(template);
  const safeName = (template.name || "certificate-template").replace(/[^\w.-]+/g, "_").slice(0, 64);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

function printTemplatePdf(template: CertTemplate) {
  const svg = templateToSvg(template);
  const html = `<!doctype html><html><head><title>${template.name}</title><style>body{margin:0;padding:16px;background:#fff}img{width:100%;height:auto;display:block}</style></head><body><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" alt="Certificate"/></body></html>`;
  const w = window.open("", "_blank", "noopener,noreferrer,width=1200,height=900");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

function stableNowISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCertType(value: unknown): value is CertType {
  return /^[A-Z]{2}$/.test(String(value ?? "").trim().toUpperCase());
}

function normalizeCertType(value: unknown): CertType {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "ACH") return "ID";
  if (raw === "PRO") return "LR";
  if (raw === "INT") return "IN";
  return isCertType(raw) ? raw : "CC";
}

function isLayoutStyle(value: unknown): value is LayoutStyle {
  return value === "classic" || value === "dark-pro" || value === "elegant";
}

function isCertStatus(value: unknown): value is CertStatus {
  return value === "active" || value === "draft" || value === "archived";
}

function isCertTemplate(value: unknown): value is CertTemplate {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (!isCertStatus(value.status)) return false;
  if (typeof value.createdAt !== "string") return false;
  if (!isCertType(normalizeCertType(value.certType))) return false;
  if (!isRecord(value.style)) return false;
  if (!isLayoutStyle(value.style.layout)) return false;
  if (value.style.pageFormat !== undefined && !isCertPageFormat(value.style.pageFormat)) return false;
  if (typeof value.style.bgColor !== "string") return false;
  if (typeof value.style.accentColor !== "string") return false;
  if (value.style.bgImage !== undefined && typeof value.style.bgImage !== "string") return false;
  if (value.style.bgPdf !== undefined && typeof value.style.bgPdf !== "string") return false;
  if (value.style.bgOverlayOpacity !== undefined && typeof value.style.bgOverlayOpacity !== "number") return false;
  if (value.style.mail_subject !== undefined && typeof value.style.mail_subject !== "string") return false;
  if (value.style.mail_body !== undefined && typeof value.style.mail_body !== "string") return false;
  if (!isRecord(value.fields)) return false;
  if (typeof value.fields.title !== "string") return false;
  if (typeof value.fields.recipientName !== "string") return false;
  if (typeof value.fields.domainName !== "string") return false;
  if (typeof value.fields.bodyText !== "string") return false;
  if (value.fields.logoLeftImage !== undefined && typeof value.fields.logoLeftImage !== "string") return false;
  if (value.fields.logoRightImage !== undefined && typeof value.fields.logoRightImage !== "string") return false;
  if (value.fields.companyName !== undefined && typeof value.fields.companyName !== "string") return false;
  if (value.fields.watermarkText !== undefined && typeof value.fields.watermarkText !== "string") return false;
  if (value.fields.watermarkImage !== undefined && typeof value.fields.watermarkImage !== "string") return false;
  if (value.fields.signatureImage !== undefined && typeof value.fields.signatureImage !== "string") return false;
  if (typeof value.fields.signatoryName !== "string") return false;
  if (typeof value.fields.signatoryTitle !== "string") return false;
  const layers = Array.isArray(value.layers) ? value.layers : [];
  for (const layer of layers) {
    if (!isRecord(layer)) return false;
    if (typeof layer.id !== "string") return false;
    if (!["text", "company", "name", "domain", "date", "certID", "qr", "logo", "signature", "image"].includes(String(layer.type))) return false;
    if (typeof layer.label !== "string") return false;
    if (typeof layer.content !== "string") return false;
    if (typeof layer.x !== "number") return false;
    if (typeof layer.y !== "number") return false;
    if (typeof layer.width !== "number") return false;
    if (typeof layer.height !== "number") return false;
    if (layer.color !== undefined && typeof layer.color !== "string") return false;
    if (layer.fontSize !== undefined && typeof layer.fontSize !== "number") return false;
    if (layer.fontWeight !== undefined && layer.fontWeight !== "normal" && layer.fontWeight !== "bold") return false;
    if (layer.fontStyle !== undefined && layer.fontStyle !== "normal" && layer.fontStyle !== "italic") return false;
    if (layer.align !== undefined && layer.align !== "left" && layer.align !== "center" && layer.align !== "right") return false;
    if (layer.opacity !== undefined && typeof layer.opacity !== "number") return false;
    if (
      layer.divider !== undefined &&
      layer.divider !== "none" &&
      layer.divider !== "top" &&
      layer.divider !== "bottom"
    ) {
      return false;
    }
  }
  return true;
}

function asCertTemplate(value: unknown): CertTemplate | null {
  if (!isCertTemplate(value)) return null;
  return { ...value, certType: normalizeCertType(value.certType) };
}

function isIssuedStatus(value: unknown): value is IssuedStatus {
  return value === "issued" || value === "revoked" || value === "expired";
}

function isIssuedCertificate(value: unknown): value is IssuedCertificate {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.templateId !== "string") return false;
  if (typeof value.templateName !== "string") return false;
  if (typeof value.recipientName !== "string") return false;
  if (typeof value.courseName !== "string") return false;
  if (!isCertType(normalizeCertType(value.certType))) return false;
  if (typeof value.issueDate !== "string") return false;
  if (!isIssuedStatus(value.status)) return false;
  if (value.verifyToken !== undefined && typeof value.verifyToken !== "string") return false;
  return true;
}

function resolveQrFgColor(color: string | undefined, style?: CertTemplateStyle): string {
  const c = String(color || "").trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)) return c;
  if (style?.layout === "dark-pro") return style.accentColor || DEFAULT_QR_FG;
  return DEFAULT_QR_FG;
}

function qrLayerFgColor(layers: CertLayer[] | undefined, style?: CertTemplateStyle): string {
  const qr = (layers || []).find((l) => l.type === "qr");
  return resolveQrFgColor(qr?.color, style);
}

function QRCodeWidget({
  certID,
  size = 64,
  fgColor = DEFAULT_QR_FG,
  showUrlText = false,
  verifyUrl,
  fill = false,
}: {
  certID: string;
  size?: number;
  fgColor?: string;
  showUrlText?: boolean;
  verifyUrl?: string;
  fill?: boolean;
}) {
  // Always clamp — qrcode.react throws RangeError("Data too long") during render if the
  // payload exceeds QR capacity (common when draft verify URLs embed full templates).
  const url = qrSafeVerifyUrl(certID, verifyUrl);
  return (
    <div className={cn("flex flex-col items-center gap-1", fill && "h-full w-full")}>
      <QRCodeSVG
        value={url}
        size={size}
        fgColor={fgColor}
        bgColor="transparent"
        style={fill ? { width: "100%", height: "100%" } : undefined}
        className={fill ? "h-full w-full" : undefined}
      />
      {showUrlText && <span className="text-[10px] text-muted-foreground break-all text-center max-w-[160px]">{url}</span>}
    </div>
  );
}

function CertificatePreview({
  template,
  overrides,
  scale,
  certID,
  showQr = true,
  verifyUrl,
  renderPdfBackground = false,
  selectedLayerID,
  onLayerSelect,
  onLayerMove,
  onLayerResize,
  onLayerContentChange,
  recipientName,
  domainName,
  companyName,
  date,
  layoutLocked = false,
  bgImageOverride,
  placeholderValues,
}: {
  template: CertTemplate;
  overrides?: Partial<CertTemplateFields>;
  scale?: number;
  certID?: string;
  showQr?: boolean;
  verifyUrl?: string;
  renderPdfBackground?: boolean;
  selectedLayerID?: string | null;
  onLayerSelect?: (id: string | null) => void;
  onLayerMove?: (id: string, x: number, y: number) => void;
  onLayerResize?: (id: string, width: number, height: number) => void;
  onLayerContentChange?: (id: string, content: string) => void;
  recipientName?: string;
  domainName?: string;
  companyName?: string;
  date?: string;
  /** Background/chrome fixed; free text & image boxes stay movable. */
  layoutLocked?: boolean;
  /** Optional blob:/resolved URL for immediate preview after upload. */
  bgImageOverride?: string;
  /** Additional {{key}} placeholder values. */
  placeholderValues?: Record<string, string>;
}) {
  const fields: CertTemplateFields = { ...template.fields, ...(overrides || {}) };
  const resolvedCompanyName = companyName || fields.companyName || "";
  // Never show template UUID — always a Cert ID sample (OR-CC-XXXXXX) unless a real issued id is passed.
  const idForQr =
    (certID && String(certID).trim()) ||
    sampleCertIdPattern(template.certType, template.certPrefix || "OR");
  const layers = template.layers || [];
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const editable = Boolean(onLayerMove || onLayerResize);
  const pageSpec = getCertPageSpec(template.style.pageFormat);
  const pageAspect = pageSpec.widthMm / pageSpec.heightMm;

  const isLayerPositionLocked = (layer: CertLayer) => {
    if (layer.locked) return true;
    if (!layoutLocked) return false;
    // Free text/image + built-in Date / Cert ID / QR stay movable when layout is locked
    return !["text", "image", "date", "certID", "qr"].includes(layer.type);
  };

  const resolveLayerContent = (layer: CertLayer) => {
    let content = layer.content || "";
    // Template builder: show the exact preview text / <<tokens>> from the editor
    if (editable) {
      return content;
    }
    const tokenValues: Record<string, string> = {
      recipient_name: recipientName || "",
      name: recipientName || "",
      domain_name: domainName || "",
      domain: domainName || "",
      course: domainName || "",
      course_name: domainName || "",
      company_name: resolvedCompanyName || "",
      company: resolvedCompanyName || "",
      issue_date: date || "",
      date: date || "",
      ...(placeholderValues || {}),
      // Always Cert ID (never template UUID / sync-id label)
      cert_id: idForQr,
      certID: idForQr,
      CertID: idForQr,
      sync_id: idForQr,
    };
    if (layer.type === "certID") {
      return idForQr;
    }
    if (layerHasCertPlaceholderTokens(content)) {
      return applyCertPlaceholders(content, tokenValues);
    }
    if (layer.type === "company") return resolvedCompanyName || content;
    if (layer.type === "name") return recipientName || content;
    if (layer.type === "domain") return domainName || content;
    if (layer.type === "date") return date || content;
    if (placeholderValues && Object.keys(placeholderValues).length > 0) {
      return applyCertPlaceholders(content, tokenValues);
    }
    return content;
  };

  const bgImageSrc =
    bgImageOverride ||
    (template.style.bgImage ? resolveUploadSrc(template.style.bgImage) : "");
  const bgPdfSrc = template.style.bgPdf ? resolveUploadSrc(template.style.bgPdf) : "";
  const overlayOpacity =
    typeof template.style.bgOverlayOpacity === "number" ? template.style.bgOverlayOpacity : 0;

  const base = (
    <div
      ref={canvasRef}
      data-canvas-root
      className={cn(
        "relative w-full overflow-hidden rounded-xl border",
        template.style.layout === "classic" && "bg-white text-slate-900 border-slate-200",
        template.style.layout === "dark-pro" && "bg-slate-900 text-white border-slate-800",
        template.style.layout === "elegant" && "bg-amber-50 text-slate-900 border-amber-200",
      )}
      style={{
        aspectRatio: String(pageAspect),
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        backgroundColor: template.style.bgColor || "#ffffff",
      }}
      onClick={() => onLayerSelect?.(null)}
    >
      {bgImageOverride || template.style.bgImage ? (
        <ProtectedUploadImage
          path={bgImageOverride || template.style.bgImage}
          className="absolute inset-0 z-0 h-full w-full object-contain pointer-events-none select-none"
        />
      ) : null}
      {bgPdfSrc && renderPdfBackground && (
        <object
          data={`${bgPdfSrc}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
          type="application/pdf"
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ border: "none" }}
        >
          <ProtectedUploadImage
            path={template.style.bgPdf}
            className="absolute inset-0 w-full h-full object-fill pointer-events-none"
          />
        </object>
      )}
      {bgImageSrc && overlayOpacity > 0 ? (
        <div
          className="absolute inset-0 bg-white dark:bg-slate-900 pointer-events-none"
          style={{ opacity: overlayOpacity }}
        />
      ) : null}
      {template.style.bgPdf && renderPdfBackground && overlayOpacity > 0 ? (
        <div
          className="absolute inset-0 bg-white dark:bg-slate-900 pointer-events-none"
          style={{ opacity: overlayOpacity }}
        />
      ) : null}
      {/* Accent */}
      {template.style.layout === "classic" && (
        <div className="absolute inset-y-0 left-0 w-2" style={{ background: template.style.accentColor }} />
      )}
      {template.style.layout === "dark-pro" && (
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: template.style.accentColor }} />
      )}
      {template.style.layout === "elegant" && (
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: template.style.accentColor }} />
      )}

      {layers.length === 0 && (
      <div className="h-full w-full p-8 sm:p-10 flex flex-col items-center justify-between">
        <div className="w-full">
          <div className="flex items-center justify-between">
            {resolvedCompanyName ? (
              <div className={cn("text-xs font-extrabold tracking-widest uppercase")} style={{ color: template.style.accentColor }}>
                {resolvedCompanyName}
              </div>
            ) : (
              <div />
            )}
            <div />
          </div>

          <div className="mt-8 text-center">
            <h2 className={cn("text-2xl sm:text-3xl font-extrabold tracking-tight")} style={{ color: template.style.layout === "dark-pro" ? "#fff" : undefined }}>
              {fields.title}
            </h2>

            <div className="mt-5">
              <p className={cn("text-sm opacity-80")}>This is to certify that</p>
              <p className={cn("mt-2 text-2xl sm:text-3xl font-black")} style={{ color: template.style.accentColor }}>
                {fields.recipientName}
              </p>
            </div>

            <div className="mt-5">
              <p className={cn("text-sm opacity-80")}>in recognition of successful completion of</p>
              <p className={cn("mt-1 text-lg sm:text-xl font-semibold")}>{fields.domainName}</p>
            </div>

            <p className={cn("mt-4 text-sm leading-relaxed opacity-90 max-w-[56ch] mx-auto")}>{fields.bodyText}</p>
          </div>
        </div>

        <div className="w-full flex items-end justify-between gap-6">
          {showQr ? (
            <div className="shrink-0 self-end flex items-end gap-2">
              <div className="rounded-md border bg-white/80 p-1.5">
                <QRCodeWidget
                  certID={idForQr}
                  size={64}
                  fgColor={qrLayerFgColor(layers, template.style)}
                  verifyUrl={verifyUrl}
                />
              </div>
              <div className="text-[10px] font-extrabold font-mono px-2 py-1 rounded-md border bg-white/80" style={{ borderColor: template.style.accentColor }}>
                {idForQr}
              </div>
            </div>
          ) : (
            <div />
          )}

          <div className="w-[42%] max-w-[280px] text-right">
            {fields.signatureImage ? (
              <div className="mb-2 flex justify-end">
                <img src={fields.signatureImage} alt="Signature" className="h-10 max-w-[160px] object-contain" />
              </div>
            ) : null}
            <div className={cn("h-px w-full opacity-30", template.style.layout === "dark-pro" ? "bg-white" : "bg-slate-900")} />
            <div className="mt-3">
              <p className={cn("text-sm font-bold")}>{fields.signatoryName}</p>
              <p className={cn("text-xs opacity-80")}>{fields.signatoryTitle}</p>
            </div>
          </div>
        </div>
      </div>
      )}
      {layers.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)).map((layer) => {
        if (layer.type === "qr") {
          return (
            <CanvasTextBoxFrame
              key={layer.id}
              geom={{ x: layer.x, y: layer.y, width: layer.width, height: layer.height }}
              selected={selectedLayerID === layer.id}
              locked={isLayerPositionLocked(layer)}
              editable={editable}
              centerOrigin
              contentOverflow="hidden"
              style={{ opacity: layer.opacity ?? 1, zIndex: layer.zIndex ?? 10 }}
              onSelect={() => onLayerSelect?.(layer.id)}
              onMove={(g) => onLayerMove?.(layer.id, g.x, g.y)}
              onResize={(g) => onLayerResize?.(layer.id, g.width, g.height)}
            >
              <div className="h-full w-full pointer-events-none">
                <QRCodeWidget
                  certID={idForQr}
                  size={256}
                  fill
                  fgColor={resolveQrFgColor(layer.color, template.style)}
                  verifyUrl={verifyUrl}
                />
              </div>
            </CanvasTextBoxFrame>
          );
        }
        if (layer.type === "logo" || layer.type === "image" || (layer.type === "signature" && layer.content.startsWith("data:image"))) {
          return (
            <CanvasTextBoxFrame
              key={layer.id}
              geom={{ x: layer.x, y: layer.y, width: layer.width, height: layer.height }}
              selected={selectedLayerID === layer.id}
              locked={isLayerPositionLocked(layer)}
              editable={editable}
              centerOrigin
              contentOverflow="hidden"
              style={{ opacity: layer.opacity ?? 1, zIndex: layer.zIndex ?? 10 }}
              onSelect={() => onLayerSelect?.(layer.id)}
              onMove={(g) => onLayerMove?.(layer.id, g.x, g.y)}
              onResize={(g) => onLayerResize?.(layer.id, g.width, g.height)}
            >
              {layer.content ? (
                <ProtectedUploadImage
                  path={layer.content}
                  alt={layer.label}
                  className="w-full h-full object-contain pointer-events-none"
                />
              ) : null}
            </CanvasTextBoxFrame>
          );
        }
        return (
          <CanvasTextBoxFrame
            key={layer.id}
            geom={{ x: layer.x, y: layer.y, width: layer.width, height: layer.height }}
            selected={selectedLayerID === layer.id}
            locked={isLayerPositionLocked(layer)}
            editable={editable}
            centerOrigin
            contentOverflow="hidden"
            divider={normalizeTextBoxDivider(layer.divider)}
            className="whitespace-pre-wrap"
            style={{
              color: layer.color || "#111827",
              fontSize: `${layer.fontSize ?? 20}px`,
              fontFamily: layer.fontFamily || 'Georgia, "Times New Roman", serif',
              fontWeight: layer.fontWeight ?? "normal",
              fontStyle: layer.fontStyle ?? "normal",
              opacity: layer.opacity ?? 1,
              textAlign: layer.align ?? "center",
              zIndex: layer.zIndex ?? 10,
            }}
            onSelect={() => onLayerSelect?.(layer.id)}
            onMove={(g) => onLayerMove?.(layer.id, g.x, g.y)}
            onResize={(g) => {
              onLayerResize?.(layer.id, g.width, g.height);
              onLayerMove?.(layer.id, g.x, g.y);
            }}
          >
            <div
              className="h-full w-full outline-none overflow-hidden"
              onDoubleClick={(e) => {
                e.stopPropagation();
                onLayerSelect?.(layer.id);
                if (layer.type !== "text") return;
                const el = e.currentTarget;
                el.contentEditable = "true";
                el.focus();
                const range = document.createRange();
                range.selectNodeContents(el);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
              }}
              onBlur={(e) => {
                const el = e.currentTarget;
                if (el.contentEditable === "true") {
                  el.contentEditable = "false";
                  if (layer.type === "text") {
                    onLayerContentChange?.(layer.id, el.innerText);
                  }
                }
              }}
              onMouseDown={(e) => {
                if ((e.target as HTMLElement)?.isContentEditable) e.stopPropagation();
              }}
            >
              {resolveLayerContent(layer)}
            </div>
          </CanvasTextBoxFrame>
        );
      })}
    </div>
  );

  if (!scale) return base;

  return (
    <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: `${100 / scale}%` }}>
      {base}
    </div>
  );
}

/** Offscreen render + html2canvas so issue works even when preview step is unmounted. */
async function captureCertificatePdfBase64(opts: {
  template: CertTemplate;
  recipientName: string;
  domainName: string;
  companyName?: string;
  date: string;
  certID?: string;
  placeholderValues?: Record<string, string>;
}): Promise<string> {
  const page = getCertPageSpec(opts.template.style.pageFormat);
  const { widthPx, heightPx } = certPageSizePx(page);
  const expectsBgImage = Boolean(
    String(opts.template.style.bgImage || "").trim() ||
      String(opts.template.style.bgPdf || "").trim(),
  );
  const host = document.createElement("div");
  host.setAttribute("data-cert-pdf-capture", "1");
  host.style.cssText = [
    "position:fixed",
    "left:-14000px",
    "top:0",
    "z-index:-1",
    "pointer-events:none",
    "opacity:1",
    "background:#fff",
    `width:${widthPx}px`,
    `height:${heightPx}px`,
    "overflow:hidden",
  ].join(";");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    // PDF <object> backgrounds cannot be rasterized by html2canvas — prefer image bg.
    // If only bgPdf exists, still mount without object (layers/text still capture).
    const usePdfObject = false;
    await new Promise<void>((resolve) => {
      root.render(
        <div
          className="bg-white"
          style={{ width: widthPx, height: heightPx, overflow: "hidden", position: "relative" }}
        >
          <CertificatePreview
            template={opts.template}
            recipientName={opts.recipientName}
            domainName={opts.domainName}
            companyName={opts.companyName}
            date={opts.date}
            certID={opts.certID}
            placeholderValues={opts.placeholderValues}
            overrides={{ domainName: opts.domainName }}
            renderPdfBackground={usePdfObject}
            showQr
          />
        </div>,
      );
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });

    // Wait for ProtectedUploadImage async blob loads (poll up to 8s).
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const imgs = Array.from(host.querySelectorAll("img"));
      const allComplete =
        imgs.length > 0 &&
        imgs.every((img) => img.complete && img.naturalWidth > 0);
      if (!expectsBgImage && imgs.length === 0) break;
      if (expectsBgImage && allComplete) break;
      if (!expectsBgImage && imgs.length > 0 && allComplete) break;
      await new Promise((r) => setTimeout(r, 120));
    }

    const imgs = Array.from(host.querySelectorAll("img"));
    await Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete && img.naturalWidth > 0) {
              resolve();
              return;
            }
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
            setTimeout(done, 3000);
          }),
      ),
    );
    // Fonts / layout settle
    await new Promise((r) => setTimeout(r, 200));
    if (typeof document !== "undefined" && "fonts" in document) {
      try {
        await Promise.race([
          (document as Document & { fonts: FontFaceSet }).fonts.ready,
          new Promise((r) => setTimeout(r, 1500)),
        ]);
      } catch {
        /* ignore */
      }
    }

    const node = (host.firstElementChild as HTMLElement | null) || host;
    // Force explicit size on the preview root (width:100% of fixed host).
    const canvasRoot = host.querySelector("[data-canvas-root]") as HTMLElement | null;
    if (canvasRoot) {
      canvasRoot.style.width = `${widthPx}px`;
      canvasRoot.style.height = `${heightPx}px`;
      canvasRoot.style.aspectRatio = "auto";
      canvasRoot.style.borderRadius = "0";
      canvasRoot.style.border = "none";
    }

    return await buildCertificatePdfBase64(node, page, { widthPx, heightPx });
  } finally {
    root.unmount();
    host.remove();
  }
}

function TemplateBuilderModal({
  open,
  onOpenChange,
  initial,
  onSave,
  orgPrefix,
  defaultCompanyName,
  typeOptions,
  onCreateType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: CertTemplate;
  onSave: (next: CertTemplate) => Promise<void>;
  orgPrefix: string;
  defaultCompanyName: string;
  typeOptions: CertTypeOption[];
  onCreateType: (code: string, label: string) => Promise<CertTypeOption>;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<CertTemplate>(initial);
  const [prefixDraft, setPrefixDraft] = useState(() => normalizeCertPrefix(initial.certPrefix || orgPrefix) || "OR");
  const [previewOverrides, setPreviewOverrides] = useState<Partial<CertTemplateFields>>({});
  const previewRef = useRef<HTMLDivElement | null>(null);
  const canvasPrintRef = useRef<HTMLDivElement | null>(null);
  const [selectedLayerID, setSelectedLayerID] = useState<string | null>(null);
  const [bgUploadError, setBgUploadError] = useState("");
  const [bgUploading, setBgUploading] = useState(false);
  const [layoutLocked, setLayoutLocked] = useState(false);
  /** Local blob URL for instant canvas preview after upload (server path may need files.php). */
  const [bgLocalPreview, setBgLocalPreview] = useState<string>("");
  const bgFileInputRef = useRef<HTMLInputElement | null>(null);
  const movableImageInputRef = useRef<HTMLInputElement | null>(null);
  const [addTypeOpen, setAddTypeOpen] = useState(false);
  const [newTypeCode, setNewTypeCode] = useState("");
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [savingType, setSavingType] = useState(false);
  const [showPlaceholderPanel, setShowPlaceholderPanel] = useState(true);

  useEffect(() => {
    const prefix = normalizeCertPrefix(initial.certPrefix || orgPrefix) || "OR";
    const certType = normalizeCertType(initial.certType);
    setPrefixDraft(prefix);
    setDraft({
      ...initial,
      certType,
      certPrefix: prefix,
      layers: ensureBuiltinCertLayers(
        applyCertNumberToLayers(initial.layers, certType, prefix),
        { orgName: defaultCompanyName, orgPrefix: prefix, logoUrl: "" },
        certType,
      ),
      style: {
        ...initial.style,
        mail_subject: initial.style.mail_subject ?? DEFAULT_CERT_MAIL_SUBJECT,
        mail_body: initial.style.mail_body ?? DEFAULT_CERT_MAIL_BODY,
      },
    });
    setPreviewOverrides({});
    setSelectedLayerID(null);
    setShowPlaceholderPanel(true);
    setBgUploadError("");
    setBgUploading(false);
    setLayoutLocked(false);
    setBgLocalPreview((prev) => {
      if (prev.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(prev);
        } catch {
          /* ignore */
        }
      }
      return "";
    });
    setAddTypeOpen(false);
    setNewTypeCode("");
    setNewTypeLabel("");
    setSavingType(false);
  }, [initial, open, orgPrefix]);

  useEffect(() => {
    return () => {
      if (bgLocalPreview.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(bgLocalPreview);
        } catch {
          /* ignore */
        }
      }
    };
  }, [bgLocalPreview]);

  const applyCertType = (nextType: CertType) => {
    setDraft((p) => ({
      ...p,
      certType: nextType,
      certPrefix: prefixDraft,
      layers: applyCertNumberToLayers(p.layers, nextType, prefixDraft),
    }));
  };

  const submitNewCertType = async () => {
    const code = normalizeCertPrefix(newTypeCode);
    const label = newTypeLabel.trim();
    if (code.length !== 2) {
      toast({ variant: "destructive", title: "Type code required", description: "Enter exactly two letters (A–Z)." });
      return;
    }
    if (!label) {
      toast({ variant: "destructive", title: "Type name required", description: "Enter a name for this certificate type." });
      return;
    }
    if (typeOptions.some((t) => t.code === code)) {
      toast({ variant: "destructive", title: "Type exists", description: `${code} is already in the type list.` });
      return;
    }
    setSavingType(true);
    try {
      const created = await onCreateType(code, label);
      applyCertType(created.code);
      setAddTypeOpen(false);
      setNewTypeCode("");
      setNewTypeLabel("");
      toast({ title: "Type added", description: `${created.code} — ${created.label}` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not add type", description: e?.message || "Try a different two-letter code." });
    } finally {
      setSavingType(false);
    }
  };

  const certNumberSample = useMemo(
    () => sampleCertIdPattern(draft.certType, prefixDraft),
    [draft.certType, prefixDraft],
  );
  const visibleTypeOptions = useMemo(() => {
    if (typeOptions.some((t) => t.code === draft.certType)) return typeOptions;
    if (!isCertType(draft.certType)) return typeOptions;
    return [...typeOptions, { code: draft.certType, label: certTypeLabel(draft.certType, typeOptions), builtin: false }];
  }, [typeOptions, draft.certType]);
  const verifyUrl = useMemo(() => buildDraftVerifyUrl(draft, certNumberSample), [draft, certNumberSample]);
  const generatedVerifyLink = verifyUrl;

  const accentPresets = useMemo(
    () => [
      "#1A6B3C", // brand green
      "#0f172a",
      "#1e3a5f",
      "#f59e0b",
      "#2563eb",
      "#a855f7",
      "#ef4444",
    ],
    [],
  );

  const bgPresets = useMemo(
    () => [
      "#ffffff",
      "#f8fafc",
      "#fefce8",
      "#0f172a",
      "#111827",
      "#0b1220",
    ],
    [],
  );

  const setField = <K extends keyof CertTemplateFields>(key: K, value: CertTemplateFields[K]) => {
    setDraft((p) => ({ ...p, fields: { ...p.fields, [key]: value } }));
    setPreviewOverrides((p) => ({ ...p, [key]: value }));
  };

  const setStyle = <K extends keyof CertTemplateStyle>(key: K, value: CertTemplateStyle[K]) => {
    setDraft((p) => ({ ...p, style: { ...p.style, [key]: value } }));
  };

  const handleBackgroundImageUpload = async (file: File) => {
    setBgUploadError("");
    if (file.size > MAX_BG_IMAGE_UPLOAD_BYTES) {
      setBgUploadError("Image must be 50 MB or smaller.");
      return;
    }
    const mime = (file.type || "").toLowerCase();
    if (!mime.startsWith("image/")) {
      setBgUploadError("Please choose a JPG, PNG, or WebP image.");
      return;
    }
    setBgUploading(true);
    try {
      const url = await api.certificates.uploadTemplateAsset(file, "background");
      const localPreview = URL.createObjectURL(file);
      setBgLocalPreview((prev) => {
        if (prev.startsWith("blob:")) {
          try {
            URL.revokeObjectURL(prev);
          } catch {
            /* ignore */
          }
        }
        return localPreview;
      });
      setDraft((p) => ({
        ...p,
        style: {
          ...p.style,
          bgImage: url,
          bgOverlayOpacity: 0,
        },
      }));
      toast({ title: "Background uploaded", description: file.name });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setBgUploadError(msg);
    } finally {
      setBgUploading(false);
    }
  };
  const setLayer = (layerId: string, patch: Partial<CertLayer>) => {
    setDraft((p) => ({
      ...p,
      layers: (p.layers || []).map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer)),
    }));
  };
  const placeholderSourceHtml = useMemo(() => {
    return [
      ...(draft.layers || []).map((l) => String(l.content || "")),
      String(draft.fields.bodyText || ""),
      String(draft.fields.title || ""),
      String(draft.style.mail_subject || ""),
      String(draft.style.mail_body || ""),
      String(draft.style.pdf_filename_pattern || ""),
    ].join("\n");
  }, [
    draft.layers,
    draft.fields.bodyText,
    draft.fields.title,
    draft.style.mail_subject,
    draft.style.mail_body,
    draft.style.pdf_filename_pattern,
  ]);

  const removeLayer = (layerId: string) => {
    const layer = (draft.layers || []).find((l) => l.id === layerId);
    if (layer && CERT_BUILTIN_LAYER_TYPES.includes(layer.type as "date" | "certID" | "qr")) {
      toast({
        variant: "destructive",
        title: "Built-in field",
        description: "Issue date, Cert ID, and QR stay on the template. Drag to move them instead.",
      });
      return;
    }
    setDraft((p) => ({ ...p, layers: (p.layers || []).filter((l) => l.id !== layerId) }));
    setSelectedLayerID((id) => (id === layerId ? null : id));
  };

  const addTextLayer = () => {
    const layer: CertLayer = {
      id: crypto.randomUUID(),
      type: "text",
      label: "Text",
      content: "Type here… insert <<placeholders>> from the panel",
      x: 50,
      y: 40,
      width: 55,
      height: 10,
      color: "#111827",
      fontSize: 18,
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontWeight: "normal",
      fontStyle: "normal",
      align: "center",
      opacity: 1,
      zIndex: (draft.layers || []).length + 10,
      locked: false,
    };
    setDraft((p) => ({ ...p, layers: [...(p.layers || []), layer] }));
    setSelectedLayerID(layer.id);
    setLayoutLocked(false);
  };

  /** Add or focus a typed merge-field layer (name / domain / date / company / certID). */
  const addTypedLayer = (type: (typeof TYPED_CERT_FIELD_TYPES)[number]["type"]) => {
    const existing = (draft.layers || []).find((l) => l.type === type);
    if (existing) {
      setSelectedLayerID(existing.id);
      setLayoutLocked(false);
      toast({ title: "Selected", description: `${existing.label} — drag on the canvas to move.` });
      return;
    }
    const meta = TYPED_CERT_FIELD_TYPES.find((t) => t.type === type)!;
    const defaults = buildDefaultImportLayers(
      { orgName: defaultCompanyName, orgPrefix: prefixDraft, logoUrl: "" },
      draft.certType,
    );
    const fromDefault = defaults.find((l) => l.type === type);
    let layer: CertLayer;
    if (fromDefault) {
      layer = {
        ...fromDefault,
        id: crypto.randomUUID(),
        content:
          type === "company"
            ? defaultCompanyName
            : type === "certID"
              ? sampleCertIdPattern(draft.certType, prefixDraft)
              : meta.sample,
        locked: false,
      };
    } else {
      layer = {
        id: crypto.randomUUID(),
        type,
        label: meta.label,
        content: type === "company" ? defaultCompanyName : meta.sample,
        x: 50,
        y: 40,
        width: 50,
        height: 8,
        fontSize: 20,
        fontWeight: "bold",
        color: "#1A6B3C",
        align: "center",
        opacity: 1,
        zIndex: (draft.layers || []).length + 10,
        locked: false,
      };
    }
    setDraft((p) => ({ ...p, layers: [...(p.layers || []), layer] }));
    setSelectedLayerID(layer.id);
    setLayoutLocked(false);
    toast({ title: "Placeholder added", description: `${meta.label} fills automatically when you issue.` });
  };

  const addQrLayer = () => {
    const existing = (draft.layers || []).find((l) => l.type === "qr");
    if (existing) {
      setSelectedLayerID(existing.id);
      setLayoutLocked(false);
      toast({ title: "Selected", description: "QR Code — drag on the canvas to move, pick a color in the toolbar." });
      return;
    }
    const defaults = buildDefaultImportLayers(
      { orgName: defaultCompanyName, orgPrefix: prefixDraft, logoUrl: "" },
      draft.certType,
    );
    const fromDefault = defaults.find((l) => l.type === "qr");
    const layer: CertLayer = fromDefault
      ? { ...fromDefault, id: crypto.randomUUID(), locked: false }
      : {
          id: crypto.randomUUID(),
          type: "qr",
          label: "QR Code",
          content: "",
          x: 10,
          y: 82,
          width: 12,
          height: 12,
          color: DEFAULT_QR_FG,
          opacity: 1,
          zIndex: (draft.layers || []).length + 10,
          locked: false,
        };
    setDraft((p) => ({ ...p, layers: [...(p.layers || []), layer] }));
    setSelectedLayerID(layer.id);
    setLayoutLocked(false);
    toast({ title: "QR added", description: "Drag to place · resize with corners · choose QR color in the toolbar." });
  };

  const focusOrAddBuiltin = (type: "date" | "certID" | "qr") => {
    const existing = (draft.layers || []).find((l) => l.type === type);
    if (existing) {
      setSelectedLayerID(existing.id);
      setLayoutLocked(false);
      toast({
        title: "Selected",
        description: `${existing.label || type} — drag on the canvas to reposition.`,
      });
      return;
    }
    if (type === "qr") {
      addQrLayer();
      return;
    }
    addTypedLayer(type);
  };

  const insertCertPlaceholder = (token: string) => {
    const label = token.replace(/^<<\s*|\s*>>$/g, "").replace(/^\{\{\s*|\s*\}\}$/g, "").trim();
    if (!label) return;

    const selected = (draft.layers || []).find((l) => l.id === selectedLayerID);
    // Only insert into free text boxes — builtins (date / certID / QR) stay dedicated boxes.
    const canInsertInto = !!selected && selected.type === "text";

    if (canInsertInto && selected) {
      const current = String(selected.content || "");
      const cleaned =
        current === "Type here… insert <<placeholders>> from the panel" || current === "Type here…"
          ? ""
          : current;
      const spacer = cleaned && !/\s$/.test(cleaned) ? " " : "";
      const next = cleaned ? `${cleaned}${spacer}${token}` : token;
      setLayer(selected.id, { content: next, label: selected.label || label });
      setLayoutLocked(false);
      toast({
        title: "Placeholder inserted",
        description: `${token} added to the selected text box.`,
      });
      return;
    }

    const offset = ((draft.layers || []).filter((l) => l.type === "text").length % 6) * 7;
    const layer: CertLayer = {
      id: crypto.randomUUID(),
      type: "text",
      label,
      content: token.startsWith("<<") ? token : `<<${label}>>`,
      x: 50,
      y: 28 + offset,
      width: 48,
      height: 8,
      color: "#111827",
      fontSize: 16,
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontWeight: "normal",
      fontStyle: "normal",
      align: "center",
      opacity: 1,
      zIndex: (draft.layers || []).length + 10,
      locked: false,
    };
    setDraft((p) => ({ ...p, layers: [...(p.layers || []), layer] }));
    setSelectedLayerID(layer.id);
    setLayoutLocked(false);
    setShowPlaceholderPanel(true);
    toast({
      title: "Text box added",
      description: `Created a text box with ${token}. Select it and keep inserting placeholders into the same box.`,
    });
  };

  const addImageLayer = async (file?: File) => {
    const pick = async (): Promise<File | null> => {
      if (file) return file;
      return await new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,image/jpeg,image/jpg,image/webp";
        input.onchange = () => resolve(input.files?.[0] || null);
        input.click();
      });
    };
    const f = await pick();
    if (!f) return;
    if (f.size > MAX_BG_IMAGE_UPLOAD_BYTES) {
      toast({ variant: "destructive", title: "Image too large", description: "Image must be 50 MB or smaller." });
      return;
    }
    const data = await readFileAsDataUrl(f);
    const layer: CertLayer = {
      id: crypto.randomUUID(),
      type: "image",
      label: "Image",
      content: data,
      x: 20,
      y: 18,
      width: 18,
      height: 18,
      opacity: 1,
      zIndex: (draft.layers || []).length + 10,
      locked: false,
    };
    setDraft((p) => ({ ...p, layers: [...(p.layers || []), layer] }));
    setSelectedLayerID(layer.id);
    setLayoutLocked(false);
    toast({ title: "Image added", description: "Drag the image on the canvas to place it (logo, seal, etc.)." });
  };

  const exportJson = () => {
    setSelectedLayerID(null);
    downloadTextFile(`${draft.name || "certificate-template"}.json`, JSON.stringify(draft, null, 2));
    toast({ title: "Exported JSON", description: "Template JSON downloaded." });
  };

  const exportPdfViaPrint = async () => {
    setSelectedLayerID(null);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const target = canvasPrintRef.current ?? previewRef.current;
    if (!target) return;

    const page = getCertPageSpec(draft.style.pageFormat);
    const printStyle = document.createElement("style");
    const styleId = `cert-print-${crypto.randomUUID()}`;
    printStyle.id = styleId;

    // Hide everything except previewRef container during print.
    printStyle.textContent = `
@media print {
  @page {
    size: ${page.cssPageSize};
    margin: 0;
  }
  body * { visibility: hidden !important; }
  #${styleId}-scope, #${styleId}-scope * { visibility: visible !important; }
  #${styleId}-scope {
    position: absolute !important;
    inset: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
  }
  #${styleId}-scope [data-canvas-root] {
    width: ${page.widthMm}mm !important;
    height: ${page.heightMm}mm !important;
    max-width: none !important;
    aspect-ratio: auto !important;
    border-radius: 0 !important;
  }
}`;
    document.head.appendChild(printStyle);

    const wrapper = document.createElement("div");
    wrapper.id = `${styleId}-scope`;
    wrapper.style.background = "white";
    wrapper.style.padding = "0";
    wrapper.appendChild(target.cloneNode(true));
    document.body.appendChild(wrapper);

    try {
      window.print();
      toast({ title: "Print dialog opened", description: `${page.label} — choose “Save as PDF”.` });
    } finally {
      wrapper.remove();
      printStyle.remove();
    }
  };

  const generateCertificate = () => {
    window.open(generatedVerifyLink, "_blank", "noopener,noreferrer");
    toast({ title: "Generated", description: "Opened clean certificate view." });
  };

  const saveDraft = async () => {
    if (normalizeCertPrefix(prefixDraft).length !== 2) {
      toast({ variant: "destructive", title: "Prefix required", description: "Enter exactly two letters for the organization prefix." });
      return;
    }
    try {
      await onSave({ ...draft, certPrefix: prefixDraft, status: "draft" });
      onOpenChange(false);
      toast({ title: "Saved", description: "Template saved as draft." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save failed", description: e?.message || "Unable to save template." });
    }
  };

  const saveAndActivate = async () => {
    if (normalizeCertPrefix(prefixDraft).length !== 2) {
      toast({ variant: "destructive", title: "Prefix required", description: "Enter exactly two letters for the organization prefix." });
      return;
    }
    try {
      await onSave({ ...draft, certPrefix: prefixDraft, status: "active" });
      onOpenChange(false);
      toast({ title: "Saved", description: "Template saved and activated." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save failed", description: e?.message || "Unable to save template." });
    }
  };

  if (!open) return null;

  return (
    <>
    <div className="fixed inset-0 z-50 bg-background flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b bg-background shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" className="gap-1 shrink-0" onClick={() => onOpenChange(false)}>
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          <div className="min-w-0">
            <h1 className="text-sm font-bold truncate">Template Builder</h1>
            <p className="text-[10px] text-muted-foreground truncate">
              Like offer letters · Text box + {"<<placeholders>>"} · Date / Cert ID / QR are built-in (drag to place)
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          <Button
            type="button"
            variant={showPlaceholderPanel ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setShowPlaceholderPanel((v) => !v)}
          >
            <Variable className="h-3.5 w-3.5" />
            Placeholders
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={saveDraft}>
            Save Draft
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={generateCertificate}>
            <Award className="h-3.5 w-3.5" />
            Generate
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={saveAndActivate}>
            <Send className="h-3.5 w-3.5" />
            Save & Activate
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 h-full min-h-0">
          {/* LEFT: Preview stays put — does not scroll with right panel */}
          <div
            className={cn(
              "flex flex-col p-4 sm:p-6 bg-muted/15 border-b lg:border-b-0 lg:border-r lg:min-h-0 lg:h-full min-h-0 overflow-hidden",
              certPageIsPortrait(draft.style.pageFormat)
                ? "min-h-[min(62vh,820px)]"
                : "min-h-[min(50vh,680px)]",
            )}
          >
            <div className="flex items-center justify-between mb-3 shrink-0">
              <div className="flex items-center gap-2">
                <Badge variant={statusBadgeVariant(draft.status)} className="text-[10px]">{draft.status}</Badge>
                <Badge variant="outline" className={cn("text-[10px]", certTypeBadgeClass(draft.certType))}>
                  {draft.certType} · {certTypeLabel(draft.certType, visibleTypeOptions)}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={exportJson}>
                  <FileDown className="h-3.5 w-3.5" />
                  Export JSON
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={exportPdfViaPrint}>
                  <Printer className="h-3.5 w-3.5" />
                  Export PDF
                </Button>
              </div>
            </div>

            <div ref={previewRef} className="flex flex-1 min-h-0 w-full max-w-[960px] mx-auto flex-col">
              {/* Word / Slides-style formatting ribbon for selected text layer */}
              {(() => {
                const selected = (draft.layers || []).find((l) => l.id === selectedLayerID);
                const isText =
                  selected &&
                  ["text", "company", "name", "domain", "date", "certID"].includes(selected.type);
                const canDeleteSelected =
                  !!selected &&
                  !CERT_BUILTIN_LAYER_TYPES.includes(selected.type as "date" | "certID" | "qr");
                const isQr = selected?.type === "qr";
                const isImage =
                  selected &&
                  (selected.type === "image" ||
                    selected.type === "logo" ||
                    selected.type === "signature");
                if (isQr && selected) {
                  return (
                    <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-md border bg-card px-2 py-1.5 shadow-sm">
                      <Button
                        type="button"
                        variant={layoutLocked ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => setLayoutLocked((v) => !v)}
                      >
                        {layoutLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                        {layoutLocked ? "Locked" : "Lock"}
                      </Button>
                      <QrCode className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[11px] font-medium">QR color</span>
                      <Input
                        type="color"
                        className="h-8 w-10 p-1 cursor-pointer"
                        value={resolveQrFgColor(selected.color, draft.style)}
                        onChange={(e) => setLayer(selected.id, { color: e.target.value })}
                        title="QR code color"
                      />
                      <span className="text-[11px] text-muted-foreground">Drag this box independently of Cert ID</span>
                      <Button type="button" variant="default" size="sm" className="h-7 text-xs ml-auto gap-1" onClick={addTextLayer}>
                        <Plus className="h-3 w-3" />Text box
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addImageLayer}>
                        <ImageIcon className="h-3 w-3" />Image
                      </Button>
                    </div>
                  );
                }
                if (isImage && selected) {
                  return (
                    <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-md border bg-card px-2 py-1.5 shadow-sm">
                      <Button
                        type="button"
                        variant={layoutLocked ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => setLayoutLocked((v) => !v)}
                      >
                        {layoutLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                        {layoutLocked ? "Locked" : "Lock"}
                      </Button>
                      <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[11px] font-medium">Image selected</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                        onClick={() => removeLayer(selected.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </Button>
                      <Button type="button" variant="default" size="sm" className="h-7 text-xs ml-auto gap-1" onClick={addTextLayer}>
                        <Plus className="h-3 w-3" />Text box
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addImageLayer}>
                        <ImageIcon className="h-3 w-3" />Image
                      </Button>
                    </div>
                  );
                }
                if (!selected || !isText) {
                  return (
                    <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
                      <Type className="h-3.5 w-3.5" />
                      {layoutLocked
                        ? "Layout locked · unlock to move built-in fields · text/image still movable"
                        : "Add Text box → insert <<placeholders>> · drag Date / Cert ID / QR to place"}
                      <Button
                        type="button"
                        variant={layoutLocked ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => setLayoutLocked((v) => !v)}
                      >
                        {layoutLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                        {layoutLocked ? "Layout locked" : "Lock layout"}
                      </Button>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground px-1">Built-in</span>
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => focusOrAddBuiltin("date")}>
                        Issue date
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => focusOrAddBuiltin("certID")}>
                        Cert ID
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => focusOrAddBuiltin("qr")}>
                        <QrCode className="h-3 w-3" /> QR
                      </Button>
                      <Button type="button" variant="default" size="sm" className="h-7 text-xs ml-auto gap-1" onClick={addTextLayer}>
                        <Plus className="h-3 w-3" /> Text box
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addImageLayer}>
                        <ImageIcon className="h-3 w-3" />Image
                      </Button>
                    </div>
                  );
                }
                return (
                  <div className="mb-2 flex flex-wrap items-center gap-1 rounded-md border bg-card px-2 py-1.5 shadow-sm">
                    <Button
                      type="button"
                      variant={layoutLocked ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => setLayoutLocked((v) => !v)}
                    >
                      {layoutLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                      {layoutLocked ? "Locked" : "Lock"}
                    </Button>
                    <Select
                      value={matchTemplateFontFace(selected.fontFamily)}
                      onValueChange={(v) => setLayer(selected.id, { fontFamily: v })}
                    >
                      <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Font" /></SelectTrigger>
                      <SelectContent>
                        {TEMPLATE_FONT_FACES.map((f) => (
                          <SelectItem key={f.label} value={f.value}>
                            <span style={{ fontFamily: f.value }}>{f.label}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={String(parseInt(matchTemplateFontSize(selected.fontSize ?? 20), 10))}
                      onValueChange={(v) => setLayer(selected.id, { fontSize: Number(v) })}
                    >
                      <SelectTrigger className="h-8 w-[72px] text-xs"><SelectValue placeholder="Size" /></SelectTrigger>
                      <SelectContent>
                        {TEMPLATE_FONT_SIZES.map((s) => (
                          <SelectItem key={s.value} value={String(parseInt(s.value, 10))}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant={selected.fontWeight === "bold" ? "default" : "ghost"}
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setLayer(selected.id, { fontWeight: selected.fontWeight === "bold" ? "normal" : "bold" })}
                    >
                      <Bold className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant={selected.fontStyle === "italic" ? "default" : "ghost"}
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setLayer(selected.id, { fontStyle: selected.fontStyle === "italic" ? "normal" : "italic" })}
                    >
                      <Italic className="h-3.5 w-3.5" />
                    </Button>
                    <Input
                      type="color"
                      className="h-8 w-10 p-1 cursor-pointer"
                      value={selected.color || "#111827"}
                      onChange={(e) => setLayer(selected.id, { color: e.target.value })}
                      title="Text color"
                    />
                    <Select value={selected.align ?? "center"} onValueChange={(v) => setLayer(selected.id, { align: v as "left" | "center" | "right" })}>
                      <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="left">Left</SelectItem>
                        <SelectItem value="center">Center</SelectItem>
                        <SelectItem value="right">Right</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant={selected.divider && selected.divider !== "none" ? "default" : "outline"}
                      size="sm"
                      className="h-8 text-xs gap-1"
                      title="Optional divider line on this text box (bottom → top → off)"
                      onClick={() =>
                        setLayer(selected.id, {
                          divider: cycleTextBoxDivider(normalizeTextBoxDivider(selected.divider)),
                        })
                      }
                    >
                      <Minus className="h-3.5 w-3.5" />
                      {selected.divider === "bottom"
                        ? "Line: bottom"
                        : selected.divider === "top"
                          ? "Line: top"
                          : "Add line"}
                    </Button>
                    {canDeleteSelected ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1 text-destructive hover:text-destructive border-destructive/40"
                        title="Delete this text box"
                        onClick={() => removeLayer(selected.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </Button>
                    ) : null}
                    <Button type="button" variant="default" size="sm" className="h-7 text-xs ml-auto gap-1" onClick={addTextLayer}>
                      <Plus className="h-3 w-3" />Text box
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addImageLayer}>
                      <ImageIcon className="h-3 w-3" />Image
                    </Button>
                  </div>
                );
              })()}
              <CertificatePreviewFit
                pageFormat={draft.style.pageFormat}
                className={cn(
                  "flex-1 min-h-0",
                  certPageIsPortrait(draft.style.pageFormat) && "min-h-[280px]",
                )}
              >
                <div ref={canvasPrintRef} className="w-full">
                  <CertificatePreview
                    template={draft}
                    overrides={previewOverrides}
                    renderPdfBackground
                    verifyUrl={verifyUrl}
                    selectedLayerID={selectedLayerID}
                    onLayerSelect={setSelectedLayerID}
                    onLayerMove={(id, x, y) => setLayer(id, { x, y })}
                    onLayerResize={(id, width, height) => setLayer(id, { width, height })}
                    onLayerContentChange={(id, content) => {
                      setLayer(id, { content });
                    }}
                    recipientName={draft.fields.recipientName}
                    domainName={draft.fields.domainName}
                    companyName={draft.fields.companyName || defaultCompanyName}
                    date={new Date().toISOString().slice(0, 10)}
                    certID={certNumberSample}
                    layoutLocked={layoutLocked}
                    bgImageOverride={bgLocalPreview || undefined}
                  />
                </div>
              </CertificatePreviewFit>
            </div>
          </div>

          {/* RIGHT: Form — only this column scrolls */}
          <div className="p-4 sm:p-6 h-auto lg:h-full min-h-0 overflow-y-auto overscroll-contain">
            <div className="space-y-4 pb-8">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-3">
                  <Label className="text-xs">Template Name</Label>
                  <Input value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} placeholder="Template Name" />
                </div>

                <div>
                  <Label className="text-xs">Certificate Type</Label>
                  <Select
                    value={draft.certType}
                    onValueChange={(v) => {
                      if (v === ADD_CERT_TYPE_VALUE) {
                        setNewTypeCode("");
                        setNewTypeLabel("");
                        setAddTypeOpen(true);
                        return;
                      }
                      applyCertType(normalizeCertType(v));
                    }}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {visibleTypeOptions.map((t) => (
                        <SelectItem key={t.code} value={t.code}>
                          {t.code} — {t.label}
                        </SelectItem>
                      ))}
                      <SelectItem value={ADD_CERT_TYPE_VALUE}>
                        + Add new type
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">Org prefix</Label>
                  <Input
                    value={prefixDraft}
                    maxLength={2}
                    className="h-10 font-mono uppercase tracking-widest"
                    placeholder="AA"
                    onChange={(e) => {
                      const nextPrefix = normalizeCertPrefix(e.target.value);
                      setPrefixDraft(nextPrefix);
                      setDraft((p) => ({
                        ...p,
                        certPrefix: nextPrefix,
                        layers: applyCertNumberToLayers(p.layers, p.certType, nextPrefix),
                      }));
                    }}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">Two letters. Unique across organizations.</p>
                </div>

                <div>
                  <Label className="text-xs">Page size</Label>
                  <Select
                    value={resolveCertPageFormat(draft.style.pageFormat)}
                    disabled={layoutLocked}
                    onValueChange={(v) => setStyle("pageFormat", v as CertPageFormat)}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select page size" />
                    </SelectTrigger>
                    <SelectContent>
                      {CERT_PAGE_FORMATS.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(() => {
                    const page = getCertPageSpec(draft.style.pageFormat);
                    return (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {page.widthMm} × {page.heightMm} mm · {page.hint}
                      </p>
                    );
                  })()}
                </div>

                <div className="sm:col-span-3">
                  <Label className="text-xs">Certificate number</Label>
                  <div className="flex h-10 items-center gap-1 rounded-md border bg-muted/30 px-3 font-mono text-sm tracking-wide">
                    <span>{(prefixDraft || "AA").padEnd(2, "A").slice(0, 2)}</span>
                    <span className="text-muted-foreground">-</span>
                    <span>{draft.certType}</span>
                    <span className="text-muted-foreground">-</span>
                    <span className="text-muted-foreground">XXXXXX</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Format AA-{draft.certType}-XXXXXX. Prefix is editable above. Type follows the dropdown. Last 6 digits are generated when issued.
                  </p>
                </div>

                <div>
                  <Label className="text-xs">Theme</Label>
                  <Select
                    value={draft.style.layout}
                    disabled={layoutLocked}
                    onValueChange={(v) => setStyle("layout", v as LayoutStyle)}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select theme" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="classic">Classic</SelectItem>
                      <SelectItem value="dark-pro">Dark Pro</SelectItem>
                      <SelectItem value="elegant">Elegant</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[11px] text-muted-foreground">Colors / accent style only</p>
                </div>
              </div>

              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">Style</CardTitle>
                  <CardDescription className="text-xs">
                    {layoutLocked
                      ? "Layout locked — unlock to change background / colors"
                      : "Background and accent colors"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Button
                      type="button"
                      variant={layoutLocked ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => setLayoutLocked((v) => !v)}
                    >
                      {layoutLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                      {layoutLocked ? "Layout locked" : "Lock layout"}
                    </Button>
                  </div>

                  {/* Background + movable image side by side */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-lg border p-3 space-y-2">
                      <Label className="text-xs">Background image</Label>
                      <p className="text-[10px] text-muted-foreground">
                        Full-page backdrop (not movable).
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          ref={bgFileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/jpg,image/webp"
                          className="text-xs max-w-full file:mr-2 file:rounded file:border file:border-input file:bg-background file:px-2 file:py-1"
                          disabled={bgUploading}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleBackgroundImageUpload(f);
                            e.target.value = "";
                          }}
                        />
                        {bgUploading ? <span className="text-xs text-muted-foreground">Uploading…</span> : null}
                        {draft.style.bgImage ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 text-destructive hover:text-destructive"
                            onClick={() => {
                              setStyle("bgImage", undefined);
                              setBgLocalPreview((prev) => {
                                if (prev.startsWith("blob:")) {
                                  try {
                                    URL.revokeObjectURL(prev);
                                  } catch {
                                    /* ignore */
                                  }
                                }
                                return "";
                              });
                            }}
                          >
                            Remove
                          </Button>
                        ) : null}
                      </div>
                      {bgUploadError ? <p className="text-xs text-destructive">{bgUploadError}</p> : null}
                      {draft.style.bgImage || bgLocalPreview ? (
                        <ProtectedUploadImage
                          path={bgLocalPreview || draft.style.bgImage}
                          alt="Background preview"
                          className="max-h-20 w-full rounded border object-contain bg-muted/20"
                        />
                      ) : null}
                    </div>

                    <div className="rounded-lg border p-3 space-y-2">
                      <Label className="text-xs">Movable image</Label>
                      <p className="text-[10px] text-muted-foreground">
                        Logo, seal, signature — drag on the canvas.
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          ref={movableImageInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/jpg,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void addImageLayer(f);
                            e.target.value = "";
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs gap-1"
                          onClick={() => movableImageInputRef.current?.click()}
                        >
                          <ImageIcon className="h-3.5 w-3.5" />
                          Upload image
                        </Button>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Add more images anytime — each becomes its own movable box.
                      </p>
                    </div>
                  </div>

                  <fieldset disabled={layoutLocked} className={cn(layoutLocked && "opacity-60")}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Background</Label>
                      <div className="flex items-center gap-2">
                        <Input value={draft.style.bgColor} onChange={(e) => setStyle("bgColor", e.target.value)} />
                        <input
                          type="color"
                          value={draft.style.bgColor}
                          onChange={(e) => setStyle("bgColor", e.target.value)}
                          className="h-10 w-12 rounded border bg-transparent p-1"
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {bgPresets.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className={cn("h-7 w-7 rounded-md border", draft.style.bgColor === c && "ring-2 ring-primary")}
                            style={{ background: c }}
                            onClick={() => setStyle("bgColor", c)}
                            aria-label={`Set background ${c}`}
                          />
                        ))}
                      </div>
                      <div className="mt-2">
                        <Label className="text-xs">Background Overlay (0 - 1)</Label>
                        <Input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={draft.style.bgOverlayOpacity ?? 0}
                          onChange={(e) => setStyle("bgOverlayOpacity", Number(e.target.value))}
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">
                          0 = show photo fully. Raise only if text needs a lighter wash.
                        </p>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs">Accent</Label>
                      <div className="flex items-center gap-2">
                        <Input value={draft.style.accentColor} onChange={(e) => setStyle("accentColor", e.target.value)} />
                        <input
                          type="color"
                          value={draft.style.accentColor}
                          onChange={(e) => setStyle("accentColor", e.target.value)}
                          className="h-10 w-12 rounded border bg-transparent p-1"
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {accentPresets.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className={cn("h-7 w-7 rounded-md border", draft.style.accentColor === c && "ring-2 ring-primary")}
                            style={{ background: c }}
                            onClick={() => setStyle("accentColor", c)}
                            aria-label={`Set accent ${c}`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  </fieldset>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">Placeholders</CardTitle>
                  <CardDescription className="text-xs">
                    Same as offer letters: add a Text box on the canvas, then insert {"<<fields>>"} into that text. Issue date, Cert ID, and QR are built-in — only drag to reposition.
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  <PlaceholderPalette
                    tokenStyle="angle"
                    documentHtml={placeholderSourceHtml}
                    onInsert={insertCertPlaceholder}
                    description="Select a text box first (or a new one is created) · type around <<tokens>> · they fill when you issue"
                  />
                  <div className="rounded-md border bg-muted/20 p-2 text-[11px] text-muted-foreground space-y-1">
                    <p>
                      <strong className="text-foreground">Built-in (always on canvas):</strong> Issue date · Cert ID · QR — click their toolbar buttons to select, then drag.
                    </p>
                    <p>
                      <strong className="text-foreground">Your text:</strong> use <strong>Text box</strong> / <strong>Image</strong> on the canvas toolbar. Double-click a text box to edit.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">Issue preview defaults</CardTitle>
                  <CardDescription className="text-xs">
                    Optional sample values for the canvas preview. Real values are filled when you issue.
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Title</Label>
                      <Input value={draft.fields.title} onChange={(e) => setField("title", e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Sample recipient name</Label>
                      <Input value={draft.fields.recipientName} onChange={(e) => setField("recipientName", e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Sample domain / course</Label>
                      <Input value={draft.fields.domainName} onChange={(e) => setField("domainName", e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Signatory name</Label>
                      <Input value={draft.fields.signatoryName} onChange={(e) => setField("signatoryName", e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Signatory title</Label>
                      <Input value={draft.fields.signatoryTitle} onChange={(e) => setField("signatoryTitle", e.target.value)} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">Email (compose)</CardTitle>
                  <CardDescription className="text-xs">
                    Used on Issue → Compose Email. Placeholders like {"{{recipient_name}}"}, {"{{cert_id}}"} are filled when sending.
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  <div>
                    <Label className="text-xs">Mail subject</Label>
                    <Input
                      value={rewriteCertMailText(draft.style.mail_subject || "") || DEFAULT_CERT_MAIL_SUBJECT}
                      onChange={(e) => setStyle("mail_subject", e.target.value)}
                      placeholder={DEFAULT_CERT_MAIL_SUBJECT}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Mail body</Label>
                    <Textarea
                      rows={10}
                      className="text-sm min-h-[160px]"
                      value={rewriteCertMailText(draft.style.mail_body || "") || DEFAULT_CERT_MAIL_BODY}
                      onChange={(e) => setStyle("mail_body", e.target.value)}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>

    <Dialog open={addTypeOpen} onOpenChange={setAddTypeOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add certificate type</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Type code</Label>
            <Input
              value={newTypeCode}
              maxLength={2}
              className="h-10 font-mono uppercase tracking-widest"
              placeholder="DS"
              onChange={(e) => setNewTypeCode(normalizeCertPrefix(e.target.value))}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">Exactly two letters. Used in the certificate number (AA-DS-XXXXXX).</p>
          </div>
          <div>
            <Label className="text-xs">Type name</Label>
            <Input
              value={newTypeLabel}
              maxLength={120}
              className="h-10"
              placeholder="Data Science"
              onChange={(e) => setNewTypeLabel(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setAddTypeOpen(false)} disabled={savingType}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submitNewCertType()} disabled={savingType}>
            {savingType ? "Saving…" : "Add type"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function TemplateCard({
  template,
  typeOptions,
  onEdit,
  onDuplicate,
  onArchive,
  onDelete,
  onIssue,
  onPreview,
  onBulk,
}: {
  template: CertTemplate;
  typeOptions?: CertTypeOption[];
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onIssue: () => void;
  onPreview: () => void;
  onBulk: () => void;
}) {
  return (
    <Card className="group hover:shadow-md transition-shadow h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{template.name}</CardTitle>
            <CardDescription className="mt-1 text-xs">
              Created {template.createdAt} · <span className="font-mono">{template.id}</span>
            </CardDescription>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              title="Preview template"
              onClick={onPreview}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={onPreview} className="gap-2">
                  <Eye className="h-4 w-4" /> Preview
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onEdit} className="gap-2">
                  <Pencil className="h-4 w-4" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDuplicate} className="gap-2">
                  <Copy className="h-4 w-4" /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={onBulk}
                  disabled={template.status !== "active"}
                  className="gap-2"
                >
                  <Users className="h-4 w-4" /> Bulk issue
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onArchive} className="gap-2">
                  <Archive className="h-4 w-4" /> Archive
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDelete} className="gap-2 text-destructive focus:text-destructive">
                  <Trash2 className="h-4 w-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <Badge variant={statusBadgeVariant(template.status)} className="text-[10px]">
            {template.status}
          </Badge>
          <Badge variant="outline" className={cn("text-[10px]", certTypeBadgeClass(template.certType))}>
            {template.certType} · {certTypeLabel(template.certType, typeOptions)}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            {getCertPageSpec(template.style.pageFormat).shortLabel}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 flex-1 flex flex-col">
        <button
          type="button"
          className="w-full text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onPreview}
          title="Preview template"
        >
          <CertificatePreviewThumb template={template} height={140} />
        </button>

        <div className="flex flex-wrap gap-2 mt-auto">
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={onIssue} disabled={template.status !== "active"}>
            <Award className="h-3.5 w-3.5" />
            Issue
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-8 text-xs gap-1.5"
            onClick={onBulk}
            disabled={template.status !== "active"}
          >
            <Users className="h-3.5 w-3.5" />
            Bulk
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuItem onClick={() => printTemplatePdf(template)}>
                Export PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportTemplateImage(template)}>
                Export JPG
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
  return new File([blob], filename.replace(/\.[^.]+$/, "") + "." + ext, { type: blob.type || "image/jpeg" });
}

/** Upload large embedded images before saving template JSON to the API. */
async function prepareCertTemplateForSave(template: CertTemplate): Promise<CertTemplate> {
  const next: CertTemplate = {
    ...template,
    style: { ...template.style },
    fields: { ...template.fields },
    layers: [...(template.layers || [])],
  };
  const inlineThreshold = 400 * 1024;
  if (typeof next.style.bgImage === "string" && next.style.bgImage.startsWith("data:") && next.style.bgImage.length > inlineThreshold) {
    const file = await dataUrlToFile(next.style.bgImage, "background.jpg");
    next.style.bgImage = await api.certificates.uploadTemplateAsset(file, "background");
  }
  return next;
}

type StudentRecipient = {
  id: string;
  name: string;
  email: string;
};

type CertLeadOption = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  college: string;
  course_interest: string;
};

function mapLeadToCertPlaceholderValues(
  lead: CertLeadOption,
  keys: string[],
): Record<string, string> {
  const mapped: Record<string, string> = {};
  const name = lead.name.trim();
  const email = lead.email.trim();
  const company = lead.company.trim();
  const course = lead.course_interest.trim();
  const college = lead.college.trim();
  const phone = lead.phone.trim();

  for (const key of keys) {
    const canon = canonicalCertPlaceholderKey(key);
    if (canon === "recipient_name" || key === "name") mapped[key] = name;
    else if (canon === "recipient_email" || key === "email") mapped[key] = email;
    else if (canon === "domain_name" || key === "domain" || key === "course" || key === "course_name") {
      mapped[key] = course || mapped[key] || "";
    } else if (canon === "company_name" || key === "company") mapped[key] = company;
    else if (key === "college" || canon === "college") mapped[key] = college;
    else if (key === "phone" || canon === "phone") mapped[key] = phone;
  }

  // Always seed common aliases if those keys exist on the form.
  if (keys.includes("recipient_name") && name) mapped.recipient_name = name;
  if (keys.includes("name") && name) mapped.name = name;
  if (keys.includes("recipient_email") && email) mapped.recipient_email = email;
  if (keys.includes("email") && email) mapped.email = email;
  if (keys.includes("domain_name") && course) mapped.domain_name = course;
  if (keys.includes("company_name") && company) mapped.company_name = company;

  return mapped;
}

function normalizeLeadOption(row: any): CertLeadOption | null {
  const id = String(row?.id || "").trim();
  if (!id) return null;
  return {
    id,
    name: String(row?.name || row?.full_name || "").trim(),
    email: String(row?.email || "").trim(),
    phone: String(row?.phone || "").trim(),
    company: String(row?.company || "").trim(),
    college: String(row?.college || "").trim(),
    course_interest: String(row?.course_interest || row?.course || row?.domain || "").trim(),
  };
}

function seedBulkRecipientRow(
  keys: string[],
  seed: Record<string, string> = {},
  defaults: Record<string, string> = {},
): Record<string, string> {
  const row: Record<string, string> = {};
  for (const k of keys) {
    const fromSeed = seed[k];
    const fromDefault = defaults[k];
    row[k] = String(fromSeed != null && String(fromSeed) !== "" ? fromSeed : fromDefault ?? "");
  }
  return row;
}

/** Single-recipient issue: form fields = placeholders on the selected template only. */
function SingleIssueCertDialog({
  open,
  onOpenChange,
  template,
  orgPrefix,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: CertTemplate | null;
  orgPrefix: string;
  onConfirm: (issued: IssuedCertificate[]) => Promise<void>;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<"details" | "preview" | "email">("details");
  const [values, setValues] = useState<Record<string, string>>({});
  const [issueDate, setIssueDate] = useState(stableNowISODate());
  const [isIssuing, setIsIssuing] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [leadSuggestionsOpen, setLeadSuggestionsOpen] = useState(false);
  const [leadSearch, setLeadSearch] = useState("");
  const [leads, setLeads] = useState<CertLeadOption[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [issuePayload, setIssuePayload] = useState<{
    studentName: string;
    studentEmail: string;
    certificateId: string;
    pdfUrl: string;
  } | null>(null);
  const [emailDraft, setEmailDraft] = useState({
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
    attachmentUrl: "",
    attachmentName: "",
  });

  const templateKeys = useMemo(
    () => getCertificateTemplatePlaceholderKeys(template),
    [template],
  );
  const fillKeys = useMemo(
    () => templateKeys.filter((k) => k !== "issue_date"),
    [templateKeys],
  );

  useEffect(() => {
    if (!open || !template) return;
    setStep("details");
    setIssueDate(stableNowISODate());
    setIsIssuing(false);
    setSendingEmail(false);
    setEmailSent(false);
    setIssuePayload(null);
    setLeadSuggestionsOpen(false);
    setLeadSearch("");
    setSelectedLeadId(null);
    setEmailDraft({ to: "", cc: "", bcc: "", subject: "", body: "", attachmentUrl: "", attachmentName: "" });
    const seed: Record<string, string> = {};
    for (const k of getCertificateTemplatePlaceholderKeys(template)) {
      if (k === "issue_date") continue;
      if (k === "company_name") seed[k] = template.fields.companyName || "";
      else if (k === "domain_name") seed[k] = template.fields.domainName || "";
      else seed[k] = "";
    }
    setValues(seed);
  }, [open, template]);

  useEffect(() => {
    if (!open || step !== "details") return;
    const q = leadSearch.trim();
    if (!leadSuggestionsOpen || q.length < 1) {
      setLeads([]);
      setLeadsLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLeadsLoading(true);
      try {
        const res = await api.leads.list({
          search: q,
          limit: 50,
          all: false,
        });
        const rows = Array.isArray((res as any)?.data) ? (res as any).data : [];
        const next = rows
          .map(normalizeLeadOption)
          .filter((l: CertLeadOption | null): l is CertLeadOption => !!l && (!!l.name || !!l.email));
        if (!cancelled) setLeads(next);
      } catch {
        if (!cancelled) setLeads([]);
      } finally {
        if (!cancelled) setLeadsLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, step, leadSearch, leadSuggestionsOpen]);

  const setValue = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const applyLead = (lead: CertLeadOption) => {
    const mapped = mapLeadToCertPlaceholderValues(lead, fillKeys);
    setValues((prev) => ({ ...prev, ...mapped }));
    setSelectedLeadId(lead.id);
    setLeadSuggestionsOpen(false);
    setLeadSearch(lead.name || lead.email);
    toast({
      title: "Lead selected",
      description: `${lead.name || lead.email} — fields filled from lead.`,
    });
  };

  const assertFilled = (): boolean => {
    const missing = fillKeys.filter((k) => !String(values[k] ?? "").trim());
    if (!issueDate.trim()) missing.push("issue_date");
    if (missing.length) {
      toast({
        variant: "destructive",
        title: "Fill all template fields",
        description: `Missing: ${missing.map(certPlaceholderLabel).join(", ")}`,
      });
      return false;
    }
    return true;
  };

  const recipientName = String(values.recipient_name || values.name || "").trim();
  const recipientEmail = String(values.recipient_email || values.email || "").trim();
  const domainName = String(values.domain_name || values.course_name || values.domain || "").trim();
  const companyName = String(values.company_name || template?.fields.companyName || "").trim();

  const placeholderValues = useMemo(
    () => ({
      ...values,
      issue_date: issueDate,
      date: issueDate,
      name: recipientName,
      domain: domainName,
      company: companyName,
    }),
    [values, issueDate, recipientName, domainName, companyName],
  );

  const goPreview = () => {
    if (!assertFilled()) return;
    setStep("preview");
  };

  const confirmIssue = async () => {
    if (!template || !assertFilled()) return;
    setIsIssuing(true);
    try {
      const certId = generateCertId(template.certType, orgPrefix);
      const verifyToken = generateOpaqueVerifyToken();
      const nextIssued: IssuedCertificate = {
        id: certId,
        templateId: template.id,
        templateName: template.name,
        recipientName,
        courseName: domainName || template.fields.domainName || "Certificate",
        certType: template.certType,
        issueDate,
        status: "issued",
        verifyToken,
      };
      await onConfirm([nextIssued]);

      let pdfBase64 = "";
      try {
        pdfBase64 = await captureCertificatePdfBase64({
          template,
          recipientName: recipientName || template.fields.recipientName,
          domainName: domainName || template.fields.domainName,
          companyName: companyName || template.fields.companyName,
          date: issueDate,
          certID: certId,
          placeholderValues,
        });
      } catch (pdfErr) {
        console.error(pdfErr);
        toast({
          variant: "destructive",
          title: "PDF capture failed",
          description:
            pdfErr instanceof Error
              ? pdfErr.message
              : "Could not build the certificate PDF. Use an image background (not PDF-only) and try again.",
        });
        return;
      }

      if (!pdfBase64) {
        toast({
          variant: "destructive",
          title: "PDF missing",
          description: "Certificate PDF was empty. Fix the template background and re-issue.",
        });
        return;
      }

      const res = await api.certificates.issue({
        recipientId: `single-${crypto.randomUUID()}`,
        templateId: template.id,
        syncId: certId,
        recipientName,
        recipientEmail,
        courseName: domainName,
        issueDate,
        verifyToken,
        pdf_base64: pdfBase64,
      });
      const issuedCertId = String((res as any)?.certificateId || (res as any)?.syncId || certId).trim();
      const payload = {
        studentName: String((res as any)?.studentName || recipientName).trim(),
        studentEmail: String((res as any)?.studentEmail || recipientEmail).trim(),
        certificateId: issuedCertId,
        pdfUrl: String((res as any)?.pdfUrl || "").trim(),
      };
      const emailValues = {
        ...placeholderValues,
        recipient_name: payload.studentName,
        candidate_name: payload.studentName,
        recipient_email: payload.studentEmail,
        cert_id: payload.certificateId,
        certificate_id: payload.certificateId,
        CertID: payload.certificateId,
        course_name: domainName,
        issue_date: issueDate,
        date: issueDate,
      };
      const mailCfg = parseCertMailConfig(template);
      setIssuePayload(payload);
      setEmailDraft({
        to: payload.studentEmail,
        cc: "",
        bcc: "",
        subject: applyPlaceholders(mailCfg.mail_subject, emailValues),
        body: applyPlaceholders(mailCfg.mail_body, emailValues),
        attachmentUrl: payload.pdfUrl,
        attachmentName: `Certificate_${payload.studentName.replace(/\s+/g, "_")}_${payload.certificateId}.pdf`,
      });
      setStep("email");
      toast({ title: "Certificate issued" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Issue failed", description: e?.message || "Unable to issue." });
    } finally {
      setIsIssuing(false);
    }
  };

  const sendEmail = async () => {
    if (!issuePayload) return;
    if (!emailDraft.to.trim() || !emailDraft.subject.trim() || !emailDraft.body.trim()) {
      toast({ variant: "destructive", title: "Missing email fields", description: "To, subject and body are required." });
      return;
    }
    try {
      setSendingEmail(true);
      await api.certificates.sendEmail({
        certificateId: issuePayload.certificateId,
        to: emailDraft.to.trim(),
        cc: emailDraft.cc.trim() || undefined,
        bcc: emailDraft.bcc.trim() || undefined,
        subject: emailDraft.subject,
        body: emailDraft.body,
        attachmentUrl: emailDraft.attachmentUrl,
        attachmentName: emailDraft.attachmentName,
      });
      setEmailSent(true);
      toast({ title: "Certificate email sent!" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Email send failed", description: e?.message || "Unable to send email." });
    } finally {
      setSendingEmail(false);
    }
  };

  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[min(90dvh,100%)] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="text-base">Issue Certificate — {template.name}</DialogTitle>
        </DialogHeader>

        <div className="mb-3 flex items-center gap-2 text-xs">
          <Badge variant={step === "details" ? "default" : "secondary"} className="text-[10px]">1. Details</Badge>
          <Badge variant={step === "preview" ? "default" : "secondary"} className="text-[10px]">2. Preview</Badge>
          <Badge variant={step === "email" ? "default" : "secondary"} className="text-[10px]">3. Email</Badge>
        </div>

        {step === "details" ? (
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">Template placeholders</CardTitle>
              <CardDescription className="text-xs">
                Only fields used in this template
                {fillKeys.length ? `: ${fillKeys.map((k) => `{{${k}}}`).join(", ")}` : ""}.
                All must be filled to continue.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-4 pb-4">
              {fillKeys.length === 0 ? (
                <p className="text-xs text-muted-foreground sm:col-span-2">No fillable placeholders on this template.</p>
              ) : (
                fillKeys.map((key) => {
                  const isRecipientName = key === "recipient_name" || key === "name";
                  if (isRecipientName) {
                    return (
                      <div key={key} className="sm:col-span-2 space-y-1.5">
                        <Label className="text-xs">
                          {certPlaceholderLabel(key)} *
                          <span className="ml-1 font-mono text-[10px] text-muted-foreground">{`{{${key}}}`}</span>
                        </Label>
                        <Input
                          value={values[key] || ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setSelectedLeadId(null);
                            setValue(key, v);
                            setLeadSearch(v);
                            setLeadSuggestionsOpen(v.trim().length > 0);
                          }}
                          onFocus={() => {
                            const v = values[key] || "";
                            if (v.trim()) {
                              setLeadSearch(v);
                              setLeadSuggestionsOpen(true);
                            }
                          }}
                          onBlur={() => {
                            // Delay so click on a suggestion still registers
                            window.setTimeout(() => setLeadSuggestionsOpen(false), 180);
                          }}
                          placeholder="Start typing to search all leads, or enter name manually"
                          autoComplete="off"
                        />
                        {selectedLeadId ? (
                          <p className="text-[10px] text-emerald-700">Filled from a portal lead — you can still edit any field.</p>
                        ) : (
                          <p className="text-[10px] text-muted-foreground">
                            Matches appear only while you type. Pick a lead to auto-fill, or keep typing for a manual name.
                          </p>
                        )}
                        {leadSuggestionsOpen && (values[key] || "").trim() ? (
                          <div className="rounded-md border bg-background shadow-sm overflow-hidden">
                            <div className="px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground border-b bg-muted/40">
                              {leadsLoading ? "Searching all leads…" : `Leads matching “${String(values[key] || "").trim()}”`}
                            </div>
                            <div className="max-h-48 overflow-y-auto overscroll-contain">
                              {!leadsLoading && leads.length === 0 ? (
                                <p className="px-3 py-3 text-xs text-muted-foreground">
                                  No leads found. Keep typing to enter the name manually.
                                </p>
                              ) : (
                                leads.map((lead) => {
                                  const meta = [lead.email, lead.phone, lead.company, lead.course_interest]
                                    .filter(Boolean)
                                    .join(" · ");
                                  return (
                                    <button
                                      key={lead.id}
                                      type="button"
                                      className={cn(
                                        "flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/60 transition-colors",
                                        selectedLeadId === lead.id && "bg-primary/5",
                                      )}
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => applyLead(lead)}
                                    >
                                      <Check
                                        className={cn(
                                          "mt-0.5 h-4 w-4 shrink-0",
                                          selectedLeadId === lead.id ? "opacity-100 text-primary" : "opacity-0",
                                        )}
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium">
                                          {lead.name || lead.email || "Unnamed lead"}
                                        </div>
                                        {meta ? (
                                          <div className="truncate text-[11px] text-muted-foreground">{meta}</div>
                                        ) : null}
                                      </div>
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  }
                  return (
                    <div key={key}>
                      <Label className="text-xs">
                        {certPlaceholderLabel(key)} *
                        <span className="ml-1 font-mono text-[10px] text-muted-foreground">{`{{${key}}}`}</span>
                      </Label>
                      <Input
                        type={key.includes("email") ? "email" : "text"}
                        value={values[key] || ""}
                        onChange={(e) => {
                          setSelectedLeadId(null);
                          setValue(key, e.target.value);
                        }}
                        placeholder={certPlaceholderLabel(key)}
                      />
                    </div>
                  );
                })
              )}
              <div>
                <Label className="text-xs">Issue date *</Label>
                <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </div>
            </CardContent>
          </Card>
        ) : null}

        {step === "preview" ? (
          <CertificatePreviewFit
            pageFormat={template.style.pageFormat}
            className={cn(
              "rounded-lg border bg-muted/20 p-3",
              certPageIsPortrait(template.style.pageFormat) ? "max-h-[min(72vh,920px)] min-h-[320px]" : "max-h-[60vh]",
            )}
          >
            <CertificatePreview
              template={template}
              recipientName={recipientName || template.fields.recipientName}
              domainName={domainName || template.fields.domainName}
              companyName={companyName || template.fields.companyName}
              date={issueDate}
              placeholderValues={placeholderValues}
              overrides={{ domainName: domainName || template.fields.domainName }}
              renderPdfBackground
            />
          </CertificatePreviewFit>
        ) : null}

        {step === "email" && issuePayload ? (
          emailSent ? (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">Email sent</CardTitle>
                <CardDescription className="text-xs">Delivered to {issuePayload.studentEmail}</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">Compose Email</CardTitle>
                <CardDescription className="text-xs">
                  Body and subject come from this template&apos;s Email settings (placeholders filled). Edit before sending.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-4 pb-4">
                <div>
                  <Label className="text-xs">To</Label>
                  <Input value={emailDraft.to} onChange={(e) => setEmailDraft((p) => ({ ...p, to: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Subject</Label>
                  <Input value={emailDraft.subject} onChange={(e) => setEmailDraft((p) => ({ ...p, subject: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Body</Label>
                  <Textarea rows={12} value={emailDraft.body} onChange={(e) => setEmailDraft((p) => ({ ...p, body: e.target.value }))} />
                </div>
                <Badge variant="outline" className="text-[11px]">PDF · {emailDraft.attachmentName}</Badge>
              </CardContent>
            </Card>
          )
        ) : null}

        <DialogFooter>
          <div className="flex w-full flex-col sm:flex-row gap-2 sm:justify-between">
            <Button
              variant="outline"
              onClick={() => {
                if (step === "details") onOpenChange(false);
                else if (step === "preview") setStep("details");
                else setStep("preview");
              }}
            >
              {step === "details" ? "Cancel" : "Back"}
            </Button>
            {step === "details" ? (
              <Button onClick={goPreview}>Next: Preview</Button>
            ) : step === "preview" ? (
              <Button onClick={() => void confirmIssue()} disabled={isIssuing}>
                {isIssuing ? "Issuing…" : "Issue & Compose Email"}
              </Button>
            ) : emailSent ? (
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            ) : (
              <Button onClick={() => void sendEmail()} disabled={sendingEmail}>
                {sendingEmail ? "Sending…" : "Send Email"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueCertWizard({
  open,
  onOpenChange,
  templates,
  initialTemplateId,
  onConfirm,
  orgPrefix,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: CertTemplate[];
  initialTemplateId?: string;
  onConfirm: (issued: IssuedCertificate[]) => Promise<void>;
  orgPrefix: string;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(initialTemplateId || null);
  const templateLocked = Boolean(initialTemplateId);
  const [courseName, setCourseName] = useState("");
  const [issueDate, setIssueDate] = useState(stableNowISODate());
  const [certIdsByRecipientId, setCertIdsByRecipientId] = useState<Record<string, string>>({});
  const [verifyTokensByRecipientId, setVerifyTokensByRecipientId] = useState<Record<string, string>>({});
  const [rowValuesByRecipientId, setRowValuesByRecipientId] = useState<Record<string, Record<string, string>>>({});
  const [extraGlobalValues, setExtraGlobalValues] = useState<Record<string, string>>({});
  const [students, setStudents] = useState<StudentRecipient[]>([]);
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [bulkLeadSuggestionsOpen, setBulkLeadSuggestionsOpen] = useState(false);
  const [bulkLeadSearch, setBulkLeadSearch] = useState("");
  const [bulkLeads, setBulkLeads] = useState<CertLeadOption[]>([]);
  const [bulkLeadsLoading, setBulkLeadsLoading] = useState(false);
  const sheetInputRef = useRef<HTMLInputElement | null>(null);
  const [isIssuing, setIsIssuing] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailLogRows, setEmailLogRows] = useState<any[]>([]);
  const [issuePayload, setIssuePayload] = useState<{
    studentName: string;
    studentEmail: string;
    certificateId: string;
    pdfUrl: string;
    templateId: string;
  } | null>(null);
  const [emailDraft, setEmailDraft] = useState({
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
    attachmentUrl: "",
    attachmentName: "",
  });

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSelectedRecipientIds([]);
    setSelectedTemplateId(initialTemplateId || null);
    setCourseName("");
    setIssueDate(stableNowISODate());
    setCertIdsByRecipientId({});
    setVerifyTokensByRecipientId({});
    setRowValuesByRecipientId({});
    setExtraGlobalValues({});
    setStudents([]);
    setManualName("");
    setManualEmail("");
    setBulkLeadSuggestionsOpen(false);
    setBulkLeadSearch("");
    setBulkLeads([]);
    setIsIssuing(false);
    setSendingEmail(false);
    setEmailSent(false);
    setIssuePayload(null);
    setEmailDraft({ to: "", cc: "", bcc: "", subject: "", body: "", attachmentUrl: "", attachmentName: "" });
    setEmailLogRows([]);
  }, [open, initialTemplateId]);

  const activeTemplates = useMemo(() => templates.filter((t) => t.status !== "archived"), [templates]);
  const selectedTemplate = useMemo(
    () => (selectedTemplateId ? templates.find((t) => t.id === selectedTemplateId) || null : null),
    [templates, selectedTemplateId],
  );

  const selectedRecipients = useMemo(
    () => students.filter((r) => selectedRecipientIds.includes(r.id)),
    [selectedRecipientIds, students],
  );
  const templateBulkKeys = useMemo(
    () => getCertificateTemplatePlaceholderKeys(selectedTemplate),
    [selectedTemplate],
  );
  const templateRowKeys = useMemo(() => getCertificateBulkRowKeys(templateBulkKeys), [templateBulkKeys]);
  const templateSharedKeys = useMemo(() => getCertificateSharedKeys(templateBulkKeys), [templateBulkKeys]);
  const templateHasDomain = templateBulkKeys.includes("domain_name");
  const templateHasCompany = templateBulkKeys.includes("company_name");

  const rowDefaults = useMemo(() => {
    const d: Record<string, string> = { ...extraGlobalValues };
    if (templateHasDomain && courseName.trim()) d.domain_name = courseName.trim();
    if (templateHasCompany) {
      d.company_name = extraGlobalValues.company_name || selectedTemplate?.fields.companyName || "";
    }
    return d;
  }, [extraGlobalValues, courseName, templateHasDomain, templateHasCompany, selectedTemplate]);

  useEffect(() => {
    if (!open || step !== 1) return;
    const q = bulkLeadSearch.trim();
    if (!bulkLeadSuggestionsOpen || q.length < 1) {
      setBulkLeads([]);
      setBulkLeadsLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setBulkLeadsLoading(true);
      try {
        const res = await api.leads.list({
          search: q,
          limit: 50,
          all: false,
        });
        const rows = Array.isArray((res as any)?.data) ? (res as any).data : [];
        const next = rows
          .map(normalizeLeadOption)
          .filter((l: CertLeadOption | null): l is CertLeadOption => !!l && (!!l.name || !!l.email));
        if (!cancelled) setBulkLeads(next);
      } catch {
        if (!cancelled) setBulkLeads([]);
      } finally {
        if (!cancelled) setBulkLeadsLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, step, bulkLeadSearch, bulkLeadSuggestionsOpen]);

  const ensureRecipientSelected = (recipient: StudentRecipient, seed: Record<string, string> = {}) => {
    setStudents((prev) => (prev.some((s) => s.id === recipient.id) ? prev : [recipient, ...prev]));
    setSelectedRecipientIds((prev) => (prev.includes(recipient.id) ? prev : [...prev, recipient.id]));
    setRowValuesByRecipientId((prev) => {
      if (prev[recipient.id]) {
        return {
          ...prev,
          [recipient.id]: {
            ...prev[recipient.id],
            ...Object.fromEntries(Object.entries(seed).filter(([, v]) => String(v || "").trim() !== "")),
          },
        };
      }
      const base = seedBulkRecipientRow(
        templateRowKeys,
        {
          recipient_name: recipient.name,
          recipient_email: recipient.email,
          name: recipient.name,
          email: recipient.email,
          ...seed,
        },
        rowDefaults,
      );
      return { ...prev, [recipient.id]: base };
    });
  };

  const setRecipientRowValue = (recipientId: string, key: string, value: string) => {
    setRowValuesByRecipientId((prev) => ({
      ...prev,
      [recipientId]: { ...(prev[recipientId] || seedBulkRecipientRow(templateRowKeys, {}, rowDefaults)), [key]: value },
    }));
    if (key === "recipient_name" || key === "name") {
      setStudents((prev) => prev.map((s) => (s.id === recipientId ? { ...s, name: value } : s)));
    }
    if (key === "recipient_email" || key === "email") {
      setStudents((prev) => prev.map((s) => (s.id === recipientId ? { ...s, email: value } : s)));
    }
  };

  const removeSelectedRecipient = (id: string) => {
    setSelectedRecipientIds((prev) => prev.filter((x) => x !== id));
  };

  const addManualRecipient = () => {
    const name = manualName.trim();
    const email = manualEmail.trim();
    if (!name) {
      toast({ variant: "destructive", title: "Name required", description: "Enter a recipient name to add manually." });
      return;
    }
    const recipient: StudentRecipient = {
      id: `manual-${crypto.randomUUID()}`,
      name,
      email,
    };
    ensureRecipientSelected(recipient, {
      recipient_name: name,
      recipient_email: email,
      name,
      email,
    });
    setManualName("");
    setManualEmail("");
    setBulkLeadSuggestionsOpen(false);
    toast({ title: "Recipient added", description: name });
  };

  const addLeadAsRecipient = (lead: CertLeadOption) => {
    const mapped = mapLeadToCertPlaceholderValues(lead, templateRowKeys);
    const recipient: StudentRecipient = {
      id: `lead-${lead.id}`,
      name: lead.name || lead.email || "Recipient",
      email: lead.email || "",
    };
    ensureRecipientSelected(recipient, mapped);
    setManualName(lead.name || "");
    setManualEmail(lead.email || "");
    setBulkLeadSuggestionsOpen(false);
    setBulkLeadSearch(lead.name || lead.email);
    toast({ title: "Lead added", description: `${recipient.name} — placeholders filled where available.` });
  };

  const applyGlobalExtrasToSelected = () => {
    if (selectedRecipientIds.length === 0 || templateRowKeys.length === 0) return;
    setRowValuesByRecipientId((prev) => {
      const next = { ...prev };
      for (const rid of selectedRecipientIds) {
        const current = next[rid] || seedBulkRecipientRow(templateRowKeys, {}, rowDefaults);
        const updated = { ...current };
        for (const key of templateRowKeys) {
          if (key === "recipient_name" || key === "name" || key === "recipient_email" || key === "email") continue;
          const v = key === "domain_name" ? courseName || extraGlobalValues[key] : extraGlobalValues[key];
          if (v != null && String(v).trim() !== "") updated[key] = String(v);
        }
        next[rid] = updated;
      }
      return next;
    });
    toast({ title: "Applied", description: `Filled defaults onto ${selectedRecipientIds.length} selected recipient(s).` });
  };

  const handleCertSheetImport = async (file: File) => {
    try {
      if (!selectedTemplate) {
        toast({
          variant: "destructive",
          title: "Select a template first",
          description: "Excel columns follow the placeholders on the selected certificate template.",
        });
        return;
      }
      const allowedKeys = [...templateBulkKeys, "candidate_name", "email", "course_name", "name", "domain"];
      const grid = await parsePlaceholderSheetFile(file);
      const mapped = mapSheetRowsToPlaceholders(grid, {
        allowedKeys,
        requireKeys: templateBulkKeys.includes("recipient_name") ? ["recipient_name"] : [],
      });
      const rows =
        mapped.rows.length > 0
          ? mapped.rows
          : mapSheetRowsToPlaceholders(grid, { allowedKeys }).rows.filter(
              (r) => r.recipient_name || r.candidate_name || r.name,
            );

      if (rows.length === 0) {
        toast({
          variant: "destructive",
          title: "Import failed",
          description: mapped.errors[0] || "Need a recipient_name (or name) column and at least one data row.",
        });
        return;
      }

      const imported: StudentRecipient[] = rows.map((row) => ({
        id: `sheet-${crypto.randomUUID()}`,
        name: row.recipient_name || row.candidate_name || row.name || "Recipient",
        email: row.recipient_email || row.email || "",
      }));
      const rowMap: Record<string, Record<string, string>> = {};
      imported.forEach((s, i) => {
        const raw = rows[i];
        const seed: Record<string, string> = {
          ...raw,
          recipient_name: raw.recipient_name || raw.candidate_name || raw.name || s.name,
          recipient_email: raw.recipient_email || raw.email || s.email,
          domain_name: raw.domain_name || raw.course_name || raw.domain || "",
        };
        rowMap[s.id] = seedBulkRecipientRow(templateRowKeys, seed, rowDefaults);
      });
      const dateFromSheet = rows.find((r) => r.issue_date)?.issue_date;
      if (dateFromSheet) setIssueDate(dateFromSheet);
      const companyFromSheet = rows.find((r) => r.company_name)?.company_name;
      if (companyFromSheet && templateHasCompany) {
        setExtraGlobalValues((prev) => ({ ...prev, company_name: companyFromSheet }));
      }
      const firstCourse = imported.map((s) => rowMap[s.id]?.domain_name).find((c) => String(c || "").trim());
      if (firstCourse && !courseName.trim() && templateHasDomain) setCourseName(firstCourse);

      setStudents((prev) => {
        const keep = prev.filter((s) => !String(s.id).startsWith("sheet-"));
        return [...imported, ...keep];
      });
      setSelectedRecipientIds(imported.map((s) => s.id));
      setRowValuesByRecipientId((prev) => ({ ...prev, ...rowMap }));
      toast({
        title: `Imported ${imported.length} recipient(s)`,
        description: `Matched columns to this template’s placeholders (${templateRowKeys.join(", ") || "—"}).`,
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Import failed", description: e?.message || "Could not read file" });
    }
  };

  const downloadCertSheetTemplate = async () => {
    if (!selectedTemplate) {
      toast({
        variant: "destructive",
        title: "Select a template first",
        description: "The Excel columns are built from placeholders on the selected template.",
      });
      return;
    }
    const headers = templateBulkKeys.length ? [...templateBulkKeys] : ["recipient_name", "recipient_email"];
    const sample = headers.map((h) => {
      if (h === "recipient_name") return "Priya Patel";
      if (h === "recipient_email") return "priya@example.com";
      if (h === "domain_name") return "Full Stack Development";
      if (h === "issue_date") return stableNowISODate();
      if (h === "company_name") return "Syncpedia Technologies";
      return "";
    });
    await downloadPlaceholderExcelTemplate(headers, sample, "certificates-bulk-template.xlsx", "Recipients");
  };

  const goNext = () => {
    if (step === 1) {
      if (!selectedTemplate) {
        toast({ variant: "destructive", title: "Select template", description: "Choose a certificate template first." });
        return;
      }
      if (!issueDate.trim()) {
        toast({ variant: "destructive", title: "Issue date required", description: "Select an issue date." });
        return;
      }
      if (templateHasCompany) {
        const company = String(extraGlobalValues.company_name || selectedTemplate.fields.companyName || "").trim();
        if (!company) {
          toast({
            variant: "destructive",
            title: "Company required",
            description: "This template uses {{company_name}} — fill it before continuing.",
          });
          return;
        }
      }
      for (const key of templateSharedKeys) {
        if (key === "issue_date" || key === "company_name") continue;
        if (!String(extraGlobalValues[key] || "").trim()) {
          toast({
            variant: "destructive",
            title: "Fill shared placeholders",
            description: `Missing: ${certPlaceholderLabel(key)}`,
          });
          return;
        }
      }
      if (selectedRecipientIds.length === 0) {
        toast({ variant: "destructive", title: "Select recipients", description: "Add or pick at least one recipient to continue." });
        return;
      }
      const missing: string[] = [];
      for (const r of selectedRecipients) {
        const row = rowValuesByRecipientId[r.id] || {};
        for (const key of templateRowKeys) {
          const value = String(row[key] ?? "").trim();
          if (!value) missing.push(`${r.name || "Recipient"} → ${certPlaceholderLabel(key)}`);
        }
      }
      if (missing.length) {
        toast({
          variant: "destructive",
          title: "Fill all template placeholders",
          description: missing.slice(0, 6).join("; ") + (missing.length > 6 ? ` (+${missing.length - 6} more)` : ""),
        });
        return;
      }
      const nextIds: Record<string, string> = {};
      const nextTokens: Record<string, string> = {};
      const seenIds = new Set<string>();
      const seenTokens = new Set<string>();
      for (const r of selectedRecipients) {
        let certId = generateCertId(selectedTemplate.certType, orgPrefix);
        while (seenIds.has(certId)) certId = generateCertId(selectedTemplate.certType, orgPrefix);
        seenIds.add(certId);
        let token = generateOpaqueVerifyToken();
        while (seenTokens.has(token)) token = generateOpaqueVerifyToken();
        seenTokens.add(token);
        nextIds[r.id] = certId;
        nextTokens[r.id] = token;
      }
      setCertIdsByRecipientId(nextIds);
      setVerifyTokensByRecipientId(nextTokens);
      setStep(2);
      return;
    }
  };

  const goBack = () => setStep((s) => (s === 3 ? 2 : 1));

  const confirm = async () => {
    if (!selectedTemplate) return;
    if (selectedRecipients.length === 0) return;
    const resolveRecipientName = (r: StudentRecipient) =>
      String(rowValuesByRecipientId[r.id]?.recipient_name || rowValuesByRecipientId[r.id]?.name || r.name || "").trim();
    const resolveRecipientEmail = (r: StudentRecipient) =>
      String(rowValuesByRecipientId[r.id]?.recipient_email || rowValuesByRecipientId[r.id]?.email || r.email || "").trim();
    const resolveCourse = (r: StudentRecipient) =>
      String(rowValuesByRecipientId[r.id]?.domain_name || courseName || selectedTemplate.fields.domainName || "").trim();
    const resolveCompany = () =>
      String(extraGlobalValues.company_name || selectedTemplate.fields.companyName || "").trim();

    const seenIds = new Set<string>();
    const seenTokens = new Set<string>();
    const issuedByRecipientId: Record<string, IssuedCertificate> = {};
    const issuedList: IssuedCertificate[] = selectedRecipients.map((r) => {
      let certId = certIdsByRecipientId[r.id] || generateCertId(selectedTemplate.certType, orgPrefix);
      while (seenIds.has(certId)) certId = generateCertId(selectedTemplate.certType, orgPrefix);
      seenIds.add(certId);
      let verifyToken = verifyTokensByRecipientId[r.id] || generateOpaqueVerifyToken();
      while (seenTokens.has(verifyToken)) verifyToken = generateOpaqueVerifyToken();
      seenTokens.add(verifyToken);
      const nextIssued: IssuedCertificate = {
        id: certId,
        templateId: selectedTemplate.id,
        templateName: selectedTemplate.name,
        recipientName: resolveRecipientName(r),
        courseName: resolveCourse(r) || "Certificate",
        certType: selectedTemplate.certType,
        issueDate,
        status: "issued",
        verifyToken,
      };
      issuedByRecipientId[r.id] = nextIssued;
      return nextIssued;
    });
    try {
      setIsIssuing(true);
      await onConfirm(issuedList);
      const issueResults: Array<{ recipientId: string; res: any }> = [];
      for (const recipient of selectedRecipients) {
        const issued = issuedByRecipientId[recipient.id] || issuedList[0];
        const name = resolveRecipientName(recipient);
        const email = resolveRecipientEmail(recipient);
        const course = resolveCourse(recipient);
        const row = rowValuesByRecipientId[recipient.id] || {};
        const placeholderValues = {
          ...extraGlobalValues,
          ...row,
          recipient_name: name,
          candidate_name: name,
          name,
          recipient_email: email,
          email,
          cert_id: issued.id,
          certificate_id: issued.id,
          CertID: issued.id,
          course_name: course,
          domain_name: course,
          issue_date: issueDate,
          date: issueDate,
          company_name: resolveCompany(),
        };
        let pdfBase64 = "";
        try {
          pdfBase64 = await captureCertificatePdfBase64({
            template: selectedTemplate,
            recipientName: name,
            domainName: course || selectedTemplate.fields.domainName,
            companyName: placeholderValues.company_name || selectedTemplate.fields.companyName,
            date: issueDate,
            certID: issued.id,
            placeholderValues,
          });
        } catch (pdfErr) {
          console.error(pdfErr);
          toast({
            variant: "destructive",
            title: "PDF capture failed",
            description:
              pdfErr instanceof Error
                ? `${name}: ${pdfErr.message}`
                : `Could not build PDF for ${name}. Use an image background and retry.`,
          });
          continue;
        }
        if (!pdfBase64) {
          toast({
            variant: "destructive",
            title: "PDF missing",
            description: `Empty PDF for ${name}. Skipped.`,
          });
          continue;
        }
        const res = await api.certificates.issue({
          recipientId: recipient.id,
          templateId: selectedTemplate.id,
          syncId: issued.id,
          recipientName: name,
          recipientEmail: email,
          courseName: course,
          issueDate,
          verifyToken: issued.verifyToken,
          pdf_base64: pdfBase64,
        });
        issueResults.push({ recipientId: recipient.id, res });
      }
      const primary = selectedRecipients[0];
      const primaryIssued = issuedByRecipientId[primary.id] || issuedList[0];
      const firstRes = issueResults[0]?.res || {};
      const issuedCertId = String(firstRes?.certificateId || firstRes?.syncId || primaryIssued.id || "").trim();
      const payload = {
        studentName: String(firstRes?.studentName || resolveRecipientName(primary) || "").trim(),
        studentEmail: String(firstRes?.studentEmail || resolveRecipientEmail(primary) || "").trim(),
        certificateId: issuedCertId,
        pdfUrl: String(firstRes?.pdfUrl || "").trim(),
        templateId: selectedTemplate.id,
      };
      const primaryRow = rowValuesByRecipientId[primary.id] || {};
      const emailValues = {
        ...extraGlobalValues,
        ...primaryRow,
        recipient_name: payload.studentName,
        candidate_name: payload.studentName,
        recipient_email: payload.studentEmail,
        cert_id: payload.certificateId,
        certificate_id: payload.certificateId,
        CertID: payload.certificateId,
        course_name: resolveCourse(primary),
        issue_date: issueDate,
        date: issueDate,
        company_name: resolveCompany(),
        domain_name: resolveCourse(primary),
      };
      const mailCfg = parseCertMailConfig(selectedTemplate);
      setIssuePayload(payload);
      setEmailDraft({
        to: payload.studentEmail,
        cc: "",
        bcc: "",
        subject: applyPlaceholders(mailCfg.mail_subject, emailValues),
        body: applyPlaceholders(mailCfg.mail_body, emailValues),
        attachmentUrl: payload.pdfUrl,
        attachmentName: `Certificate_${payload.studentName.replace(/\s+/g, "_")}_${payload.certificateId}.pdf`,
      });
      setStep(3);
      toast({ title: "Issued certificates", description: `${issuedList.length} certificate(s) issued.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Issue failed", description: e?.message || "Unable to issue certificates." });
    } finally {
      setIsIssuing(false);
    }
  };

  const sendEmail = async () => {
    if (!issuePayload) return;
    if (!emailDraft.to.trim() || !emailDraft.subject.trim() || !emailDraft.body.trim()) {
      toast({ variant: "destructive", title: "Missing email fields", description: "To, subject and body are required." });
      return;
    }
    try {
      setSendingEmail(true);
      await api.certificates.sendEmail({
        certificateId: issuePayload.certificateId,
        to: emailDraft.to.trim(),
        cc: emailDraft.cc.trim() || undefined,
        bcc: emailDraft.bcc.trim() || undefined,
        subject: emailDraft.subject,
        body: emailDraft.body,
        attachmentUrl: emailDraft.attachmentUrl,
        attachmentName: emailDraft.attachmentName,
      });
      setEmailSent(true);
      toast({ title: "Certificate email sent!" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Email send failed", description: e?.message || "Unable to send email." });
    } finally {
      setSendingEmail(false);
    }
  };

  const loadEmailLogs = async () => {
    if (!issuePayload) return;
    try {
      const res = await api.certificates.emailLogs(issuePayload.certificateId);
      const rows = Array.isArray((res as any)?.data) ? (res as any).data : [];
      setEmailLogRows(rows);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Unable to load email log", description: e?.message || "Try again." });
    }
  };

  const resetForAnother = () => {
    setStep(1);
    setSelectedRecipientIds([]);
    setCourseName("");
    setIssueDate(stableNowISODate());
    setCertIdsByRecipientId({});
    setVerifyTokensByRecipientId({});
    setRowValuesByRecipientId({});
    setExtraGlobalValues({});
    setManualName("");
    setManualEmail("");
    setStudents([]);
    setIssuePayload(null);
    setEmailSent(false);
    setEmailDraft({ to: "", cc: "", bcc: "", subject: "", body: "", attachmentUrl: "", attachmentName: "" });
    setEmailLogRows([]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[min(90dvh,100%)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {selectedTemplate
              ? `Bulk issue — ${selectedTemplate.name}`
              : "Bulk issue certificates"}
          </DialogTitle>
          {selectedTemplate ? (
            <DialogDescription className="text-xs">
              {templateLocked ? "Using this template · " : ""}
              Placeholders:{" "}
              {templateBulkKeys.length
                ? templateBulkKeys.map((k) => `{{${k}}}`).join(", ")
                : "none detected"}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <div className="mb-4 flex items-center gap-2 text-xs">
          <Badge variant={step === 1 ? "default" : "secondary"} className="text-[10px]">1. Recipients</Badge>
          <Badge variant={step === 2 ? "default" : "secondary"} className="text-[10px]">2. Review</Badge>
          <Badge variant={step === 3 ? "default" : "secondary"} className="text-[10px]">3. Send Email</Badge>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            {!templateLocked ? (
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">Template</CardTitle>
                  <CardDescription className="text-xs">
                    Choose which certificate template to issue (Bulk from a template card skips this).
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <Select
                    value={selectedTemplateId || undefined}
                    onValueChange={(v) => {
                      setSelectedTemplateId(v);
                      setSelectedRecipientIds([]);
                      setRowValuesByRecipientId({});
                    }}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select template" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeTemplates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} ({t.certType})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">Template placeholders</CardTitle>
                <CardDescription className="text-xs">
                  Shared fields for this template
                  {selectedTemplate && templateBulkKeys.length
                    ? ` · ${templateBulkKeys.map((k) => `{{${k}}}`).join(", ")}`
                    : selectedTemplate
                      ? " · no custom placeholders"
                      : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {!selectedTemplate ? (
                  <p className="text-sm text-muted-foreground">Select a template to see its placeholders.</p>
                ) : (
                  <>
                    {templateBulkKeys.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {templateBulkKeys.map((k) => (
                          <code key={k} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{`{{${k}}}`}</code>
                        ))}
                      </div>
                    ) : null}
                    <div>
                      <Label className="text-xs">Issue date *</Label>
                      <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                    </div>
                    {templateHasCompany ? (
                      <div>
                        <Label className="text-xs">{certPlaceholderLabel("company_name")} *</Label>
                        <Input
                          value={extraGlobalValues.company_name || selectedTemplate.fields.companyName || ""}
                          onChange={(e) => setExtraGlobalValues((prev) => ({ ...prev, company_name: e.target.value }))}
                          placeholder="Company name"
                        />
                      </div>
                    ) : null}
                    {templateHasDomain ||
                    templateRowKeys.some((k) => !["recipient_name", "recipient_email", "name", "email"].includes(k)) ||
                    templateSharedKeys.some((k) => k !== "issue_date" && k !== "company_name") ? (
                      <div className="rounded-md border p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <Label className="text-xs">Defaults for recipients</Label>
                            <p className="text-[10px] text-muted-foreground">
                              Optional — applied when you add/select recipients. Edit per person below.
                            </p>
                          </div>
                          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={applyGlobalExtrasToSelected}>
                            Apply to selected
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {templateHasDomain ? (
                            <div>
                              <Label className="text-[11px]">{certPlaceholderLabel("domain_name")}</Label>
                              <Input
                                value={courseName}
                                onChange={(e) => setCourseName(e.target.value)}
                                placeholder="Course / Domain default"
                              />
                            </div>
                          ) : null}
                          {templateSharedKeys
                            .filter((k) => k !== "issue_date" && k !== "company_name" && k !== "domain_name")
                            .map((k) => (
                              <div key={k}>
                                <Label className="text-[11px]">
                                  {certPlaceholderLabel(k)}{" "}
                                  <span className="font-mono text-muted-foreground">{`{{${k}}}`}</span>
                                </Label>
                                <Input
                                  value={extraGlobalValues[k] || ""}
                                  onChange={(e) => setExtraGlobalValues((prev) => ({ ...prev, [k]: e.target.value }))}
                                  placeholder={certPlaceholderLabel(k)}
                                />
                              </div>
                            ))}
                          {templateRowKeys
                            .filter((k) => !["recipient_name", "recipient_email", "name", "email", "domain_name"].includes(k))
                            .filter((k) => !templateSharedKeys.includes(k))
                            .map((k) => (
                              <div key={k}>
                                <Label className="text-[11px]">
                                  {certPlaceholderLabel(k)}{" "}
                                  <span className="font-mono text-muted-foreground">{`{{${k}}}`}</span>
                                </Label>
                                <Input
                                  value={extraGlobalValues[k] || ""}
                                  onChange={(e) => setExtraGlobalValues((prev) => ({ ...prev, [k]: e.target.value }))}
                                  placeholder={certPlaceholderLabel(k)}
                                />
                              </div>
                            ))}
                        </div>
                      </div>
                    ) : null}
                    <div>
                      <Label className="text-xs">Preview</Label>
                      <div className="mt-2">
                        <CertificatePreviewFit
                          pageFormat={selectedTemplate.style.pageFormat}
                          className={cn(
                            "rounded-lg border bg-muted/10 p-2",
                            certPageIsPortrait(selectedTemplate.style.pageFormat)
                              ? "max-h-[min(48vh,520px)] min-h-[220px]"
                              : "max-h-[40vh]",
                          )}
                        >
                          <CertificatePreview
                            template={selectedTemplate}
                            recipientName={selectedRecipients[0]?.name || selectedTemplate.fields.recipientName}
                            domainName={courseName || selectedTemplate.fields.domainName}
                            companyName={extraGlobalValues.company_name || selectedTemplate.fields.companyName}
                            date={issueDate}
                            placeholderValues={extraGlobalValues}
                            overrides={{ domainName: courseName || selectedTemplate.fields.domainName }}
                            renderPdfBackground
                          />
                        </CertificatePreviewFit>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3 px-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm">Recipients</CardTitle>
                    <CardDescription className="text-xs">
                      Type to search all portal leads, add manually, or import Excel. Every template placeholder must be filled per recipient
                      {templateRowKeys.length ? `: ${templateRowKeys.map((k) => `{{${k}}}`).join(", ")}` : ""}.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs gap-1"
                      onClick={() => void downloadCertSheetTemplate()}
                    >
                      <Download className="h-3.5 w-3.5" /> Excel template
                    </Button>
                    <Button type="button" variant="default" size="sm" className="h-8 text-xs gap-1" onClick={() => sheetInputRef.current?.click()}>
                      <FileSpreadsheet className="h-3.5 w-3.5" /> Import Excel
                    </Button>
                    <input
                      ref={sheetInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleCertSheetImport(f);
                        e.target.value = "";
                      }}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div className="rounded-md border p-3 space-y-2">
                  <Label className="text-xs">Recipient name — type to search all leads, or enter manually</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                    <Input
                      value={manualName}
                      onChange={(e) => {
                        const v = e.target.value;
                        setManualName(v);
                        setBulkLeadSearch(v);
                        setBulkLeadSuggestionsOpen(v.trim().length > 0);
                      }}
                      onFocus={() => {
                        if (manualName.trim()) {
                          setBulkLeadSearch(manualName);
                          setBulkLeadSuggestionsOpen(true);
                        }
                      }}
                      onBlur={() => window.setTimeout(() => setBulkLeadSuggestionsOpen(false), 180)}
                      placeholder="Start typing name, email, phone, or company…"
                      autoComplete="off"
                    />
                    <Input
                      type="email"
                      value={manualEmail}
                      onChange={(e) => setManualEmail(e.target.value)}
                      placeholder="Recipient email (optional until Add)"
                    />
                    <Button type="button" className="gap-1" onClick={addManualRecipient}>
                      <Plus className="h-4 w-4" /> Add
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Matches appear only while you type. Click a lead to add and auto-fill, or press Add for a manual entry.
                  </p>
                  {bulkLeadSuggestionsOpen && manualName.trim() ? (
                    <div className="rounded-md border bg-background overflow-hidden">
                      <div className="px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground border-b bg-muted/40">
                        {bulkLeadsLoading
                          ? "Searching all leads…"
                          : `Leads matching “${manualName.trim()}”`}
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {!bulkLeadsLoading && bulkLeads.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">
                            No leads found. Keep typing and press Add for a manual recipient.
                          </p>
                        ) : (
                          bulkLeads.map((lead) => {
                            const meta = [lead.email, lead.phone, lead.company, lead.course_interest]
                              .filter(Boolean)
                              .join(" · ");
                            return (
                              <button
                                key={lead.id}
                                type="button"
                                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/60"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => addLeadAsRecipient(lead)}
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium">{lead.name || lead.email}</div>
                                  {meta ? <div className="truncate text-[11px] text-muted-foreground">{meta}</div> : null}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">
                  Selected ({selectedRecipients.length}) — fill all placeholders
                </CardTitle>
                <CardDescription className="text-xs">
                  Name and email are editable. All fields used by this template are required before Review.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {selectedRecipients.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No recipients selected yet.</p>
                ) : (
                  <ScrollArea className="h-[360px] pr-3">
                    <div className="space-y-3">
                      {selectedRecipients.map((r, index) => {
                        const row =
                          rowValuesByRecipientId[r.id] ||
                          seedBulkRecipientRow(
                            templateRowKeys,
                            { recipient_name: r.name, recipient_email: r.email, name: r.name, email: r.email },
                            rowDefaults,
                          );
                        return (
                          <div key={r.id} className="rounded-xl border p-3 space-y-2 bg-background">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs font-medium text-muted-foreground">Recipient {index + 1}</div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-destructive"
                                onClick={() => removeSelectedRecipient(r.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                              </Button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {(templateRowKeys.length
                                ? templateRowKeys
                                : ["recipient_name", "recipient_email"]
                              ).map((key) => (
                                <div key={key} className={key === "recipient_name" || key === "name" ? "sm:col-span-2" : undefined}>
                                  <Label className="text-[11px]">
                                    {certPlaceholderLabel(key)} *
                                    <span className="ml-1 font-mono text-muted-foreground">{`{{${key}}}`}</span>
                                  </Label>
                                  <Input
                                    type={key.includes("email") ? "email" : "text"}
                                    className="h-8 text-xs"
                                    value={row[key] || ""}
                                    onChange={(e) => setRecipientRowValue(r.id, key, e.target.value)}
                                    placeholder={certPlaceholderLabel(key)}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {step === 2 && (
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">Review</CardTitle>
              <CardDescription className="text-xs">Each recipient gets a unique certificate ID + QR</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {!selectedTemplate ? (
                <div className="text-sm text-muted-foreground">No template selected.</div>
              ) : (
                <ScrollArea className="h-[420px] pr-3">
                  <div className="space-y-3">
                    {selectedRecipients.map((r) => {
                      const id = certIdsByRecipientId[r.id] || generateCertId(selectedTemplate.certType, orgPrefix);
                      const token = verifyTokensByRecipientId[r.id] || "";
                      const verifyUrl = token ? getVerifyURL(id, token) : "";
                      const row = rowValuesByRecipientId[r.id] || {};
                      const name = String(row.recipient_name || row.name || r.name || "").trim();
                      const email = String(row.recipient_email || row.email || r.email || "").trim();
                      const merged = {
                        ...extraGlobalValues,
                        ...row,
                        issue_date: issueDate,
                        company_name: extraGlobalValues.company_name || selectedTemplate.fields.companyName || "",
                      };
                      return (
                        <div key={r.id} className="rounded-xl border p-4 bg-background">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold truncate">{name}</div>
                              <div className="text-xs text-muted-foreground truncate">{email || "No email"}</div>
                              <div className="mt-2 text-xs font-mono break-all">{id}</div>
                            </div>
                            <div className="shrink-0">
                              <QRCodeWidget certID={id} size={72} fgColor={qrLayerFgColor(selectedTemplate.layers, selectedTemplate.style)} verifyUrl={verifyUrl} />
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {templateBulkKeys.map((k) => {
                              const v =
                                k === "issue_date"
                                  ? issueDate
                                  : k === "company_name"
                                    ? merged.company_name
                                    : String(merged[k] || "").trim();
                              return (
                                <code key={k} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                                  {`{{${k}}}: ${v || "—"}`}
                                </code>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        )}

        {step === 3 && issuePayload && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
            <div className="space-y-3">
              <div className="rounded-md border border-emerald-300 bg-emerald-50 text-emerald-900 px-3 py-2 text-sm">
                Certificate issued successfully for {issuePayload.studentName} — Cert ID {issuePayload.certificateId}
              </div>
              {emailSent ? (
                <Card>
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm">Certificate email sent!</CardTitle>
                    <CardDescription className="text-xs">
                      The certificate PDF was successfully delivered to {issuePayload.studentEmail}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    <div className="text-xs font-mono">Cert ID: {issuePayload.certificateId}</div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={resetForAnother}>Issue another</Button>
                      <Button variant="outline" onClick={loadEmailLogs}>View email log</Button>
                    </div>
                    {emailLogRows.length > 0 ? (
                      <div className="rounded-md border p-2 text-xs space-y-1">
                        {emailLogRows.slice(0, 3).map((row) => (
                          <div key={row.id} className="flex items-center justify-between gap-2">
                            <span className="truncate">{row.to_email}</span>
                            <span className="text-muted-foreground">{row.sent_at || row.created_at}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm">Compose Email</CardTitle>
                    <CardDescription className="text-xs">
                      Body and subject come from this template&apos;s Email settings (placeholders filled). Edit before sending.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    <div>
                      <Label className="text-xs">To</Label>
                      <Input value={emailDraft.to} onChange={(e) => setEmailDraft((p) => ({ ...p, to: e.target.value }))} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">CC (optional)</Label>
                        <Input value={emailDraft.cc} onChange={(e) => setEmailDraft((p) => ({ ...p, cc: e.target.value }))} />
                      </div>
                      <div>
                        <Label className="text-xs">BCC (optional)</Label>
                        <Input value={emailDraft.bcc} onChange={(e) => setEmailDraft((p) => ({ ...p, bcc: e.target.value }))} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Subject</Label>
                      <Input value={emailDraft.subject} onChange={(e) => setEmailDraft((p) => ({ ...p, subject: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Body</Label>
                      <Textarea rows={18} value={emailDraft.body} onChange={(e) => setEmailDraft((p) => ({ ...p, body: e.target.value }))} />
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[11px]">
                        PDF · {emailDraft.attachmentName}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
            <Card className="h-fit">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">Email Details</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 text-xs space-y-2">
                <div><span className="text-muted-foreground">From:</span> support@syncpedia.in</div>
                <div><span className="text-muted-foreground">To:</span> {emailDraft.to || "—"}</div>
                <div><span className="text-muted-foreground">Attachment:</span> {emailDraft.attachmentName || "—"}</div>
              </CardContent>
            </Card>
          </div>
        )}

        <DialogFooter>
          <div className="flex w-full flex-col sm:flex-row gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => (step === 1 ? onOpenChange(false) : goBack())}>
              {step === 1 ? "Cancel" : "Back"}
            </Button>
            {step === 1 ? (
              <Button onClick={goNext} className="gap-1.5">
                Next
              </Button>
            ) : step === 2 ? (
              <Button onClick={confirm} className="gap-1.5" disabled={isIssuing}>
                <Send className="h-4 w-4" />
                {isIssuing ? "Preparing email..." : "Send Mail"}
              </Button>
            ) : (
              <Button onClick={sendEmail} className="gap-1.5" disabled={sendingEmail || emailSent}>
                <Send className="h-4 w-4" />
                {sendingEmail ? "Sending email with certificate…" : emailSent ? "Email Sent" : "Send Certificate Email"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatCertIdParts(certId: string) {
  const parts = certId.split("-");
  const [p0, p1, p2, p3] = [parts[0] || "", parts[1] || "", parts[2] || "", parts.slice(3).join("-") || ""];
  return { prefix: p0, type: p1, date: p2, suffix: p3 };
}

/** Shows the stored issued PDF (same file as email attachment), not a live template re-render. */
function IssuedCertificatePdfViewer({ certificateId }: { certificateId: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    setLoading(true);
    setError("");
    setUrl("");
    void (async () => {
      try {
        const blob = await api.certificates.pdf(certificateId);
        if (cancelled) return;
        const next = URL.createObjectURL(blob);
        revoked = next;
        setUrl(next);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load certificate PDF");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [certificateId]);

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading certificate PDF…
      </div>
    );
  }
  if (error || !url) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        {error || "PDF not available for this certificate."}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/20">
      <iframe title={`Certificate ${certificateId}`} src={url} className="h-[min(70vh,820px)] w-full bg-white" />
    </div>
  );
}

function CertIdBadge({ certId }: { certId: string }) {
  const { prefix, type, date, suffix } = formatCertIdParts(certId);
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px]">
      <span className="text-slate-600 dark:text-slate-300">{prefix}-</span>
      <span className="text-blue-600 font-bold">{type}-</span>
      <span className="text-slate-400">{date}-</span>
      <span className="text-green-600 font-bold">{suffix}</span>
    </span>
  );
}

function IssuedCertificatesTable({
  issuedCerts,
  templates,
  onRevoke,
}: {
  issuedCerts: IssuedCertificate[];
  templates: CertTemplate[];
  onRevoke: (id: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [previewCertId, setPreviewCertId] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmRevokeId) return;
    const t = window.setTimeout(() => setConfirmRevokeId(null), 2500);
    return () => window.clearTimeout(t);
  }, [confirmRevokeId]);

  const previewCert = useMemo(() => issuedCerts.find((c) => c.id === previewCertId) || null, [issuedCerts, previewCertId]);

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cert ID</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Cert Type</TableHead>
                  <TableHead>Issue Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issuedCerts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <CertIdBadge certId={c.id} />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={async () => {
                            await navigator.clipboard.writeText(c.id);
                            toast({ title: "Copied", description: "Certificate ID copied." });
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>{c.recipientName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.courseName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-[10px]", certTypeBadgeClass(c.certType))}>
                        {c.certType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.issueDate}</TableCell>
                    <TableCell>
                      <Badge variant={issuedStatusBadgeVariant(c.status)} className="text-[10px]">
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setPreviewCertId(c.id)}>
                          Preview
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn("h-7 text-xs", confirmRevokeId === c.id ? "text-destructive hover:text-destructive" : "text-muted-foreground")}
                          onClick={() => {
                            if (c.status !== "issued") return;
                            if (confirmRevokeId === c.id) {
                              onRevoke(c.id)
                                .then(() => {
                                  setConfirmRevokeId(null);
                                  toast({ title: "Revoked", description: "Certificate marked revoked." });
                                })
                                .catch((e: any) => {
                                  toast({ variant: "destructive", title: "Revoke failed", description: e?.message || "Unable to revoke certificate." });
                                });
                              return;
                            }
                            setConfirmRevokeId(c.id);
                          }}
                          disabled={c.status !== "issued"}
                        >
                          {confirmRevokeId === c.id ? "Confirm revoke" : "Revoke"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!previewCertId} onOpenChange={(o) => !o && setPreviewCertId(null)}>
        <DialogContent className="max-w-4xl max-h-[min(90dvh,100%)]">
          <DialogHeader>
            <DialogTitle>Certificate Preview</DialogTitle>
            <DialogDescription className="text-xs">
              Shows the same PDF that was generated at issue time (matches the email attachment).
            </DialogDescription>
          </DialogHeader>
          {previewCert ? (
            <IssuedCertificatePdfViewer certificateId={previewCert.id} />
          ) : (
            <div className="text-sm text-muted-foreground">Unable to load preview.</div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewCertId(null)}>
              Close
            </Button>
            <Button
              className="gap-1.5"
              onClick={() => {
                void (async () => {
                  try {
                    const blob = await api.certificates.pdf(previewCert!.id);
                    const url = URL.createObjectURL(blob);
                    const w = window.open(url, "_blank");
                    if (!w) {
                      toast({
                        variant: "destructive",
                        title: "Popup blocked",
                        description: "Allow popups to print or save the PDF.",
                      });
                    } else {
                      w.addEventListener("load", () => {
                        try {
                          w.print();
                        } catch {
                          /* user can print from the tab */
                        }
                      });
                    }
                    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
                  } catch (e: unknown) {
                    toast({
                      variant: "destructive",
                      title: "PDF unavailable",
                      description: e instanceof Error ? e.message : "Could not open certificate PDF.",
                    });
                  }
                })();
              }}
              disabled={!previewCert}
            >
              <Printer className="h-3.5 w-3.5" /> Print / Save as PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ImportModal({
  open,
  onOpenChange,
  onImport,
  certOrgContext,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (template: CertTemplate) => void;
  certOrgContext: CertOrgContext;
}) {
  const { toast } = useToast();
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setDragOver(false);
      setProgress(0);
      setImporting(false);
    }
  }, [open]);

  const runProgressSimulation = () => {
    setImporting(true);
    setProgress(0);
    const start = Date.now();
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - start;
      const next = Math.min(95, Math.round((elapsed / 900) * 100));
      setProgress(next);
      if (next >= 95) {
        window.clearInterval(interval);
      }
    }, 60);
    return () => window.clearInterval(interval);
  };

  const handleFile = async (file: File) => {
    const lower = file.name.toLowerCase();
    const isJson = lower.endsWith(".json");
    const isPdf = lower.endsWith(".pdf");
    const isJpeg = lower.endsWith(".jpeg") || lower.endsWith(".jpg") || lower.endsWith(".png");

    if (!isJson && !isPdf && !isJpeg) {
      toast({ variant: "destructive", title: "Invalid file", description: "Only .json, .pdf, .png, .jpeg, .jpg files are supported." });
      return;
    }
    if (isJpeg && file.size > MAX_TEMPLATE_IMAGE_UPLOAD_BYTES) {
      toast({
        variant: "destructive",
        title: "Image too large",
        description: "Template image files must be 200 MB or smaller.",
      });
      return;
    }

    const stop = runProgressSimulation();
    try {
      if (isPdf || isJpeg) {
        const importedName = file.name.replace(/\.(pdf|png|jpeg|jpg)$/i, "").trim() || "Imported Template";
        const imageData = isJpeg ? await readFileAsDataUrl(file) : undefined;
        const pdfData = isPdf ? await readFileAsDataUrl(file) : undefined;
        const defaultLayers = buildDefaultImportLayers(certOrgContext, "CC");
        const mergedLayers = sanitizeImportLayers(defaultLayers, certOrgContext, "CC");
        const importedTemplate: CertTemplate = {
          id: crypto.randomUUID(),
          name: importedName,
          status: "draft",
          createdAt: stableNowISODate(),
          certType: "CC",
          style: { layout: "classic", pageFormat: "a4-landscape", bgColor: "#ffffff", accentColor: "#1A6B3C", bgImage: imageData, bgPdf: pdfData },
          fields: {
            title: "Certificate of Completion",
            companyName: certOrgContext.orgName,
            recipientName: "",
            domainName: "",
            bodyText: "",
            watermarkText: "",
            signatoryName: "Signatory Name",
            signatoryTitle: "Signatory Title",
          },
          layers: mergedLayers,
        };
        setProgress(100);
        onImport(importedTemplate);
        toast({
          title: "Imported",
          description: "Background imported with editable layers: Company, Name, Domain, Date, Certificate ID, QR, and Logo.",
        });
        onOpenChange(false);
        return;
      }

      const raw = await file.text();
      const parsed: unknown = JSON.parse(raw);
      const parsedTemplate = asCertTemplate(parsed);
      if (!parsedTemplate) {
        throw new Error("JSON does not match CertTemplate shape.");
      }
      const certType = parsedTemplate.certType;
      setProgress(100);
      const normalized: CertTemplate = {
        ...parsedTemplate,
        id: crypto.randomUUID(),
        certType,
        status: "draft" as CertStatus,
        fields: {
          ...parsedTemplate.fields,
          companyName: parsedTemplate.fields.companyName || certOrgContext.orgName,
        },
        layers: sanitizeImportLayers(parsedTemplate.layers || [], certOrgContext, certType),
      };
      onImport(normalized);
      toast({ title: "Imported", description: "Template imported with editable layers (Company, Name, Domain, Date, Certificate ID, QR, Logo)." });
      onOpenChange(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Import failed", description: e?.message || "Invalid JSON." });
    } finally {
      stop();
      setImporting(false);
      setProgress(0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import Template (.json / .pdf / .jpeg)</DialogTitle>
        </DialogHeader>

        <div
          className={cn(
            "rounded-xl border-2 border-dashed p-8 text-center transition-colors",
            dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/10",
          )}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
        >
          <p className="text-sm font-semibold">Drag & drop your file here</p>
          <p className="text-xs text-muted-foreground mt-1">Supports .json, .pdf, .png, .jpeg, .jpg</p>
          <Button variant="outline" className="mt-4" onClick={() => fileInputRef.current?.click()} disabled={importing}>
            Choose file
          </Button>
          <p className="text-[11px] text-muted-foreground mt-2">Template images: max 200 MB</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.pdf,.png,.jpeg,.jpg,application/json,application/pdf,image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />
        </div>

        {importing && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Importing…</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CertificateVerifyPage() {
  const { certId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const verifyToken = searchParams.get("token") || "";
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [displayTemplate, setDisplayTemplate] = useState<CertTemplate | null>(null);
  const [displayId, setDisplayId] = useState(certId);
  const [displayOverrides, setDisplayOverrides] = useState<Partial<CertTemplateFields>>({});
  const [displayDate, setDisplayDate] = useState<string | undefined>(undefined);
  const [pdfUrl, setPdfUrl] = useState("");
  const [recipientLabel, setRecipientLabel] = useState("");

  useEffect(() => {
    let cancelled = false;
    let revoked: string | null = null;
    async function load() {
      const normalizedCertId = decodeURIComponent(certId || "");
      if (!normalizedCertId) {
        setLoading(false);
        return;
      }
      if (!verifyToken) {
        setLoading(false);
        setVerified(false);
        return;
      }

      const embedded = resolveEmbeddedVerify(normalizedCertId, verifyToken);
      if (embedded) {
        if (cancelled) return;
        setVerified(true);
        setDisplayId(embedded.certId);
        setDisplayTemplate(embedded.template);
        setDisplayOverrides(embedded.overrides);
        setDisplayDate(undefined);
        setPdfUrl("");
        setRecipientLabel(String(embedded.overrides.recipientName || ""));
        setLoading(false);
        return;
      }

      try {
        const res = await api.certificates.verifyPublic(normalizedCertId, verifyToken);
        if (cancelled) return;
        if (!res?.verified) {
          setVerified(false);
          return;
        }

        setVerified(true);
        setDisplayId(String(res.certId || normalizedCertId));
        setRecipientLabel(String(res.recipientName || res.overrides?.recipientName || ""));
        setDisplayOverrides({
          recipientName: String(res.recipientName || res.overrides?.recipientName || ""),
          domainName: String(res.courseName || res.overrides?.domainName || ""),
          ...(res.overrides || {}),
        });
        setDisplayDate(typeof res.issueDate === "string" ? res.issueDate : undefined);
        if (res.template) {
          setDisplayTemplate(res.template as CertTemplate);
        }

        // Prefer the stored issued PDF (same bytes as email) so bg + fonts match.
        const tryPdf = res.hasPdf !== false;
        if (tryPdf) {
          try {
            const blob = await api.certificates.verifyPublicPdf(normalizedCertId, verifyToken);
            if (cancelled) return;
            const next = URL.createObjectURL(blob);
            revoked = next;
            setPdfUrl(next);
          } catch {
            // Fall back to live template re-render below.
          }
        }
      } catch {
        if (!cancelled) setVerified(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [certId, verifyToken]);

  const showLiveFallback = verified && !pdfUrl && displayTemplate;

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-4">
        {loading ? (
          <Card><CardContent className="py-10 text-center text-muted-foreground">Verifying certificate…</CardContent></Card>
        ) : !verified || (!pdfUrl && !displayTemplate) ? (
          <Card>
            <CardContent className="py-10 text-center">
              <h1 className="text-xl font-bold">Certificate not found</h1>
              <p className="text-sm text-muted-foreground mt-2">Invalid or expired verification link.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="text-center space-y-1">
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Certificate verified</p>
              {recipientLabel ? (
                <p className="text-sm text-muted-foreground">
                  Issued to <span className="font-medium text-foreground">{recipientLabel}</span>
                  {displayId ? (
                    <>
                      {" · "}
                      <span className="font-mono text-xs">{displayId}</span>
                    </>
                  ) : null}
                </p>
              ) : displayId ? (
                <p className="font-mono text-xs text-muted-foreground">{displayId}</p>
              ) : null}
            </div>
            {pdfUrl ? (
              <div className="overflow-hidden rounded-lg border bg-muted/20 shadow-sm">
                <iframe
                  title={`Certificate ${displayId}`}
                  src={pdfUrl}
                  className="h-[min(80vh,920px)] w-full bg-white"
                />
              </div>
            ) : showLiveFallback ? (
              <CertificatePreviewFit
                pageFormat={displayTemplate.style.pageFormat}
                className={cn(
                  certPageIsPortrait(displayTemplate.style.pageFormat)
                    ? "min-h-[min(80vh,1000px)]"
                    : "min-h-[40vh]",
                )}
              >
                <CertificatePreview
                  template={displayTemplate}
                  certID={displayId}
                  overrides={displayOverrides}
                  recipientName={displayOverrides.recipientName}
                  domainName={displayOverrides.domainName}
                  companyName={displayOverrides.companyName}
                  date={displayDate}
                  showQr={false}
                  renderPdfBackground
                />
              </CertificatePreviewFit>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export default function CertificatesPage() {
  const { toast } = useToast();
  const { organization } = useAuth();

  const [claimedPrefix, setClaimedPrefix] = useState(() => normalizeCertPrefix(organization?.cert_prefix));

  const certOrgContext = useMemo<CertOrgContext>(
    () => ({
      orgName: organization?.name?.trim() || "Organization",
      orgPrefix: claimedPrefix.length === 2 ? claimedPrefix : certOrgPrefix(organization),
      logoUrl: organization?.logo_url?.trim() || undefined,
    }),
    [organization, claimedPrefix],
  );

  const [templates, setTemplates] = useState<CertTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesSyncError, setTemplatesSyncError] = useState<string | null>(null);
  const [certTypeOptions, setCertTypeOptions] = useState<CertTypeOption[]>(BUILTIN_CERT_TYPE_OPTIONS);
  const [issuedCerts, setIssuedCerts] = useState<IssuedCertificate[]>([]);
  const [loadingIssued, setLoadingIssued] = useState(false);
  const [activeTab, setActiveTab] = useState<"templates" | "forms" | "issued" | "form_issued">("templates");
  const [showBuilder, setShowBuilder] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [showSingleIssue, setShowSingleIssue] = useState(false);
  const [singleIssueTemplate, setSingleIssueTemplate] = useState<CertTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<CertTemplate | null>(null);
  const prevWizardOpen = useRef(false);
  const [editingTemplate, setEditingTemplate] = useState<CertTemplate | null>(null);
  const [wizardInitialTemplateId, setWizardInitialTemplateId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const p = normalizeCertPrefix(organization?.cert_prefix);
    if (p.length === 2) setClaimedPrefix(p);
  }, [organization?.cert_prefix]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingTemplates(true);
      try {
        const res = await api.certificates.listTemplates();
        const rows = (res as any)?.data;
        if (!Array.isArray(rows)) return;
        const claimed = normalizeCertPrefix((res as any)?.cert_prefix);
        const valid = rows.map((t: unknown) => asCertTemplate(t)).filter((t): t is CertTemplate => t !== null);
        if (mounted) {
          setTemplates(valid);
          setCertTypeOptions(parseCertTypeOptions((res as any)?.cert_types));
          if (claimed.length === 2) setClaimedPrefix(claimed);
          setTemplatesSyncError(null);
        }
      } catch (e: any) {
        const msg = e?.message || "Could not load templates from database.";
        toast({ variant: "destructive", title: "Template sync failed", description: msg });
        if (mounted) {
          setTemplates([]);
          setTemplatesSyncError(msg);
        }
      } finally {
        if (mounted) setLoadingTemplates(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [toast]);

  const fetchIssuedCertificates = useCallback(async () => {
    setLoadingIssued(true);
    try {
      const res = await api.certificates.listIssued();
      const rows = (res as any)?.data;
      if (!Array.isArray(rows)) {
        setIssuedCerts([]);
        return;
      }
      const normalized: IssuedCertificate[] = rows
        .map((row: any) => ({
          id: String(row?.id || "").trim(),
          templateId: String(row?.template_id || row?.templateId || "").trim(),
          templateName: String(row?.template_name || row?.templateName || "").trim(),
          recipientName: String(row?.recipient_name || row?.recipientName || "").trim(),
          courseName: String(row?.course_name || row?.courseName || "").trim(),
          certType: normalizeCertType(row?.cert_type || row?.certType || "CC"),
          issueDate: String(row?.issue_date || row?.issueDate || "").trim(),
          status: (String(row?.status || "issued").trim() as IssuedStatus),
          verifyToken: row?.verify_token || row?.verifyToken || undefined,
        }))
        .filter((c) => c.id && c.templateId && c.templateName && c.recipientName && c.courseName && c.issueDate && isIssuedCertificate(c));
      setIssuedCerts(normalized);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Issued certificates sync failed", description: e?.message || "Could not load from database." });
    } finally {
      setLoadingIssued(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchIssuedCertificates();
  }, [fetchIssuedCertificates]);

  /** Reload issued list when the issue wizard closes (covers PDF/email step failures after DB insert). */
  useEffect(() => {
    if (prevWizardOpen.current && !showWizard) {
      void fetchIssuedCertificates();
    }
    prevWizardOpen.current = showWizard;
  }, [showWizard, fetchIssuedCertificates]);

  const openNewTemplate = () => {
    const seedLayers = buildDefaultImportLayers(certOrgContext, "CC").map((l) => ({ ...l, locked: false }));
    const seed: CertTemplate = {
      id: crypto.randomUUID(),
      name: "New Template",
      status: "draft",
      createdAt: stableNowISODate(),
      certType: "CC",
      certPrefix: certOrgContext.orgPrefix,
      style: { layout: "classic", pageFormat: "a4-landscape", bgColor: "#ffffff", accentColor: "#1A6B3C" },
      fields: {
        title: "Certificate of Completion",
        companyName: certOrgContext.orgName,
        recipientName: "Recipient Name",
        domainName: "Course / Domain Name",
        bodyText: "Has successfully completed the program with distinction.",
        watermarkText: "",
        signatoryName: "Signatory Name",
        signatoryTitle: "Signatory Title",
      },
      layers: seedLayers,
    };
    setEditingTemplate(seed);
    setShowBuilder(true);
  };

  const upsertTemplate = async (next: CertTemplate) => {
    const prepared = await prepareCertTemplateForSave(next);
    const res = await api.certificates.saveTemplate(prepared) as { cert_prefix?: string };
    const savedPrefix = normalizeCertPrefix(res?.cert_prefix || prepared.certPrefix);
    if (savedPrefix.length === 2) setClaimedPrefix(savedPrefix);
    setTemplates((prev) => {
      const idx = prev.findIndex((t) => t.id === prepared.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = prepared;
        return copy;
      }
      return [prepared, ...prev];
    });
  };

  const editTemplate = (t: CertTemplate) => {
    setEditingTemplate(t);
    setShowBuilder(true);
  };

  const duplicateTemplate = (t: CertTemplate) => {
    const next: CertTemplate = {
      ...t,
      id: crypto.randomUUID(),
      name: `${t.name} (Copy)`,
      status: "draft",
      createdAt: stableNowISODate(),
    };
    setEditingTemplate(next);
    setShowBuilder(true);
    toast({ title: "Duplicated", description: "Opened a draft copy in the builder." });
  };

  const archiveTemplate = async (t: CertTemplate) => {
    try {
      await upsertTemplate({ ...t, status: "archived" });
      toast({ title: "Archived", description: `${t.name} moved to archived.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Archive failed", description: e?.message || "Unable to archive template." });
    }
  };

  const deleteTemplate = async (t: CertTemplate) => {
    try {
      await api.certificates.deleteTemplate(t.id);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
      toast({ title: "Deleted", description: `${t.name} removed.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Delete failed", description: e?.message || "Unable to delete template." });
    }
  };

  const issueFromTemplate = (t: CertTemplate) => {
    setSingleIssueTemplate(t);
    setShowSingleIssue(true);
  };

  const bulkFromTemplate = (t: CertTemplate) => {
    setWizardInitialTemplateId(t.id);
    setShowWizard(true);
  };

  const previewFromTemplate = (t: CertTemplate) => {
    setPreviewTemplate(t);
  };

  const addIssuedBatch = async (list: IssuedCertificate[]) => {
    await api.certificates.createIssuedBulk(list);
    await fetchIssuedCertificates();
    setActiveTab("issued");
  };

  const revokeIssued = async (id: string) => {
    await api.certificates.updateIssuedStatus(id, "revoked");
    await fetchIssuedCertificates();
  };

  const activeTemplates = useMemo(() => templates.filter((t) => t.status !== "archived"), [templates]);
  const archivedTemplates = useMemo(() => templates.filter((t) => t.status === "archived"), [templates]);

  const exportAllZip = async () => {
    try {
      const zip = new JSZip();
      for (const t of templates) {
        const safeName = (t.name || "template").replace(/[^\w.-]+/g, "_").slice(0, 64);
        zip.file(`${safeName}-${t.id}.json`, JSON.stringify(t, null, 2));
        zip.file(`${safeName}-${t.id}.svg`, templateToSvg(t));
      }
      const blob = await zip.generateAsync({ type: "blob" });
      saveAs(blob, "certificates-export.zip");
      toast({ title: "Exported", description: "Downloaded certificates-export.zip" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Export failed", description: e?.message || "Unable to export zip." });
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">Home / Certificates</div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Certificates</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Templates, issuance, and verification QR</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="gap-1.5" onClick={openNewTemplate}>
            <Plus className="h-3.5 w-3.5" /> New Template
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowImport(true)}>
            <Download className="h-3.5 w-3.5" /> Import
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={exportAllZip}>
            <FileDown className="h-3.5 w-3.5" /> Export All
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="mb-4">
          <TabsTrigger value="templates" className="gap-1.5">
            <Award className="h-3.5 w-3.5" /> Templates
          </TabsTrigger>
          <TabsTrigger value="forms" className="gap-1.5">
            <Users className="h-3.5 w-3.5" /> Forms
          </TabsTrigger>
          <TabsTrigger value="issued" className="gap-1.5">
            <Send className="h-3.5 w-3.5" /> Issued
          </TabsTrigger>
          <TabsTrigger value="form_issued" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Form Issued
          </TabsTrigger>
        </TabsList>

        <TabsContent value="forms" className="space-y-4">
          <DocFormsWorkspace formType="certificate" />
        </TabsContent>

        <TabsContent value="form_issued" className="space-y-4">
          <DocIssuedPanel docKind="certificate" />
        </TabsContent>

        <TabsContent value="templates" className="space-y-4">
          {templatesSyncError ? (
            <Card>
              <CardContent className="py-4">
                <p className="text-sm text-destructive font-medium">Database sync error: {templatesSyncError}</p>
                <p className="text-xs text-muted-foreground mt-1">Templates shown here are only from successful API responses. Check backend deployment for `certificate-templates.php` and auth token/session.</p>
              </CardContent>
            </Card>
          ) : null}
          {activeTemplates.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Award className="h-12 w-12 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">{loadingTemplates ? "Loading templates from database..." : "No templates yet. Create your first certificate template."}</p>
                <Button className="mt-4 gap-1.5" onClick={openNewTemplate}>
                  <Plus className="h-4 w-4" /> Create Template
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activeTemplates.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  typeOptions={certTypeOptions}
                  onEdit={() => editTemplate(t)}
                  onDuplicate={() => duplicateTemplate(t)}
                  onArchive={() => archiveTemplate(t)}
                  onDelete={() => deleteTemplate(t)}
                  onIssue={() => issueFromTemplate(t)}
                  onPreview={() => previewFromTemplate(t)}
                  onBulk={() => bulkFromTemplate(t)}
                />
              ))}
            </div>
          )}

          {archivedTemplates.length > 0 && (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">Archived</CardTitle>
                <CardDescription className="text-xs">Hidden from normal selection</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {archivedTemplates.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border p-3 bg-muted/10">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate">{t.name}</span>
                        <Badge variant="outline" className={cn("text-[10px]", certTypeBadgeClass(t.certType))}>
                          {t.certType}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono truncate">{t.id}</div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={async () => {
                        try {
                          await upsertTemplate({ ...t, status: "draft" });
                          toast({ title: "Restored", description: `${t.name} moved to draft.` });
                        } catch (e: any) {
                          toast({ variant: "destructive", title: "Restore failed", description: e?.message || "Unable to restore template." });
                        }
                      }}>
                        Restore
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive hover:text-destructive" onClick={() => void deleteTemplate(t)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="issued" className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" className="gap-1.5" onClick={() => { setWizardInitialTemplateId(undefined); setShowWizard(true); }}>
              <Award className="h-3.5 w-3.5" /> Issue Wizard
            </Button>
          </div>

          {issuedCerts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Send className="h-12 w-12 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">{loadingIssued ? "Loading issued certificates..." : "No certificates issued yet."}</p>
              </CardContent>
            </Card>
          ) : (
            <IssuedCertificatesTable issuedCerts={issuedCerts} templates={templates} onRevoke={revokeIssued} />
          )}
        </TabsContent>
      </Tabs>

      <TemplateBuilderModal
        open={showBuilder}
        onOpenChange={setShowBuilder}
        initial={editingTemplate || templateSeeds[0]}
        orgPrefix={certOrgContext.orgPrefix}
        defaultCompanyName={certOrgContext.orgName}
        typeOptions={certTypeOptions}
        onCreateType={async (code, label) => {
          const res = await api.certificates.createType({ code, label }) as { data?: CertTypeOption; types?: unknown };
          const next = parseCertTypeOptions(res?.types);
          setCertTypeOptions(next);
          const created = next.find((t) => t.code === code) || { code, label, builtin: false };
          return created;
        }}
        onSave={async (t) => {
          await upsertTemplate(t);
          setEditingTemplate(null);
        }}
      />
      <ImportModal
        open={showImport}
        onOpenChange={setShowImport}
        certOrgContext={certOrgContext}
        onImport={(t) => {
          void upsertTemplate(t).catch((e: any) => {
            toast({ variant: "destructive", title: "Import save failed", description: e?.message || "Unable to save imported template." });
          });
        }}
      />
      <IssueCertWizard
        open={showWizard}
        onOpenChange={setShowWizard}
        templates={templates}
        initialTemplateId={wizardInitialTemplateId}
        orgPrefix={certOrgContext.orgPrefix}
        onConfirm={addIssuedBatch}
      />
      <SingleIssueCertDialog
        open={showSingleIssue}
        onOpenChange={(o) => {
          setShowSingleIssue(o);
          if (!o) setSingleIssueTemplate(null);
        }}
        template={singleIssueTemplate}
        orgPrefix={certOrgContext.orgPrefix}
        onConfirm={addIssuedBatch}
      />
      <Dialog open={!!previewTemplate} onOpenChange={(o) => !o && setPreviewTemplate(null)}>
        <DialogContent className="max-w-4xl max-h-[min(92dvh,100%)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              Preview — {previewTemplate?.name || "Template"}
            </DialogTitle>
          </DialogHeader>
          {previewTemplate ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusBadgeVariant(previewTemplate.status)} className="text-[10px]">
                  {previewTemplate.status}
                </Badge>
                <Badge variant="outline" className={cn("text-[10px]", certTypeBadgeClass(previewTemplate.certType))}>
                  {previewTemplate.certType} · {certTypeLabel(previewTemplate.certType, certTypeOptions)}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {getCertPageSpec(previewTemplate.style.pageFormat).label}
                </Badge>
              </div>
              <CertificatePreviewFit
                pageFormat={previewTemplate.style.pageFormat}
                className={cn(
                  "rounded-lg border bg-muted/20 p-3",
                  certPageIsPortrait(previewTemplate.style.pageFormat)
                    ? "max-h-[min(72vh,920px)] min-h-[320px]"
                    : "max-h-[60vh] min-h-[240px]",
                )}
              >
                <CertificatePreview
                  template={previewTemplate}
                  certID={sampleCertIdPattern(
                    previewTemplate.certType,
                    previewTemplate.certPrefix || certOrgContext.orgPrefix,
                  )}
                  recipientName={previewTemplate.fields.recipientName}
                  domainName={previewTemplate.fields.domainName}
                  companyName={previewTemplate.fields.companyName || certOrgContext.orgName}
                  date={stableNowISODate()}
                  renderPdfBackground
                />
              </CertificatePreviewFit>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setPreviewTemplate(null)}>
              Close
            </Button>
            {previewTemplate?.status === "active" ? (
              <>
                <Button
                  variant="secondary"
                  className="gap-1.5"
                  onClick={() => {
                    const t = previewTemplate;
                    setPreviewTemplate(null);
                    if (t) bulkFromTemplate(t);
                  }}
                >
                  <Users className="h-3.5 w-3.5" />
                  Bulk issue
                </Button>
                <Button
                  className="gap-1.5"
                  onClick={() => {
                    const t = previewTemplate;
                    setPreviewTemplate(null);
                    if (t) issueFromTemplate(t);
                  }}
                >
                  <Award className="h-3.5 w-3.5" />
                  Issue
                </Button>
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

