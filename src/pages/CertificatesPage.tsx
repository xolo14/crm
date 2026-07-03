import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import {
  Award,
  Copy,
  Download,
  FileDown,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Trash2,
  Archive,
  Send,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { createWorker } from "tesseract.js";

type CertStatus = "active" | "draft" | "archived";
type IssuedStatus = "issued" | "revoked" | "expired";
type CertType = "CC" | "ACH" | "PRO" | "INT" | "WS";
type LayoutStyle = "classic" | "dark-pro" | "elegant";

const CERT_TYPE_LABELS: Record<CertType, string> = {
  CC: "Course Certificate",
  ACH: "Industrial",
  PRO: "Letter of Recommendation",
  INT: "Internship",
  WS: "Soft Skills",
};

const CERT_TYPE_COLORS: Record<CertType, string> = {
  CC: "bg-teal-100 text-teal-800",
  ACH: "bg-amber-100 text-amber-800",
  PRO: "bg-purple-100 text-purple-800",
  INT: "bg-blue-100 text-blue-800",
  WS: "bg-red-100 text-red-800",
};

interface CertTemplateStyle {
  layout: LayoutStyle;
  bgColor: string;
  accentColor: string;
  bgImage?: string;
  bgPdf?: string;
  bgOverlayOpacity?: number;
}

interface CertTemplateFields {
  title: string;
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

type CertLayerType = "text" | "name" | "domain" | "date" | "certID" | "qr" | "logo" | "signature" | "image";

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
  fontWeight?: "normal" | "bold";
  fontStyle?: "normal" | "italic";
  align?: "left" | "center" | "right";
  opacity?: number;
  zIndex?: number;
  locked?: boolean;
}

interface CertTemplate {
  id: string;
  name: string;
  status: CertStatus;
  createdAt: string;
  certType: CertType;
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

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ALPHA = "abcdefghijklmnopqrstuvwxyz";
const CERT_SEQ_KEY = "cert_alpha_seq_v1";
const CERT_USED_IDS_KEY = "cert_used_ids_v1";
const MAX_SIGNATURE_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_TEMPLATE_IMAGE_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB
const MAX_BG_IMAGE_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB — uploaded via multipart, not JSON
const A4_WIDTH_CM = 29.7;
const A4_HEIGHT_CM = 21;
const A4_ASPECT = A4_WIDTH_CM / A4_HEIGHT_CM;
const IMPORT_EDITABLE_LAYER_TYPES: CertLayerType[] = ["name", "date", "certID", "qr", "logo"];

function sanitizeImportLayers(layers: CertLayer[]): CertLayer[] {
  const filtered = (layers || []).filter((l) => IMPORT_EDITABLE_LAYER_TYPES.includes(l.type));
  const hasQr = filtered.some((l) => l.type === "qr");
  const hasCertId = filtered.some((l) => l.type === "certID");
  const hasName = filtered.some((l) => l.type === "name");
  const hasDate = filtered.some((l) => l.type === "date");
  const hasLogo = filtered.some((l) => l.type === "logo");
  const next = [...filtered];
  if (!hasName) {
    next.push({ id: crypto.randomUUID(), type: "name", label: "Recipient Name", content: "<<Name>>", x: 50, y: 42, width: 60, height: 10, fontSize: 28, fontWeight: "bold", color: "#1A6B3C", align: "center", opacity: 1, zIndex: 10 });
  }
  if (!hasDate) {
    next.push({ id: crypto.randomUUID(), type: "date", label: "Issue Date", content: "<<Date>>", x: 20, y: 88, width: 20, height: 5, fontSize: 11, fontWeight: "normal", color: "#555555", align: "left", opacity: 1, zIndex: 11 });
  }
  if (!hasCertId) {
    next.push({ id: crypto.randomUUID(), type: "certID", label: "Certificate ID", content: "SYNC-CC-YYYYMMDD-XXXXX", x: 11, y: 93, width: 20, height: 5, fontSize: 9, fontWeight: "normal", color: "#333333", align: "left", opacity: 1, zIndex: 12, locked: true });
  }
  if (!hasQr) {
    next.push({ id: crypto.randomUUID(), type: "qr", label: "QR Code", content: "", x: 11, y: 84, width: 11, height: 11, opacity: 1, zIndex: 13, locked: true });
  }
  if (!hasLogo) {
    next.push({ id: crypto.randomUUID(), type: "logo", label: "Logo", content: "", x: 12, y: 9, width: 14, height: 14, opacity: 1, zIndex: 14, align: "left" });
  }
  return next.map((l, idx) => ({ ...l, zIndex: idx + 10 }));
}

function nextAlphaPair(): string {
  let seq = 0;
  try {
    const raw = localStorage.getItem(CERT_SEQ_KEY);
    seq = raw ? Number(raw) || 0 : 0;
  } catch {
    seq = 0;
  }

  const first = ALPHA[Math.floor(seq / 26) % 26];
  const second = ALPHA[seq % 26];

  try {
    localStorage.setItem(CERT_SEQ_KEY, String(seq + 1));
  } catch {
    // no-op when storage is unavailable
  }

  return `${first}${second}`;
}

function getUsedCertIds(): Set<string> {
  try {
    const raw = localStorage.getItem(CERT_USED_IDS_KEY);
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
    // Keep only recent entries to avoid unbounded growth.
    const deduped = Array.from(new Set(used)).slice(-2000);
    localStorage.setItem(CERT_USED_IDS_KEY, JSON.stringify(deduped));
  } catch {
    // no-op when storage is unavailable
  }
}

function generateSyncID(type: CertType = "CC"): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const used = getUsedCertIds();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const alphaHead = nextAlphaPair();
    const randomTail = Array.from({ length: 3 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join("");
    const suffix = `${alphaHead}${randomTail}`;
    const candidate = `SYNC-${type}-${date}-${suffix}`;
    if (!used.has(candidate)) {
      reserveCertId(candidate);
      return candidate;
    }
  }

  // Hard fallback with extra entropy in the extremely unlikely case of repeated collisions.
  const fallback = `SYNC-${type}-${date}-${Date.now().toString(36).slice(-6)}`;
  reserveCertId(fallback);
  return fallback;
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
    },
  };
}

function getVerifyURL(certID: string, token?: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://app.syncpedia.com";
  const qs = token ? `?data=${encodeURIComponent(token)}` : "";
  return `${origin}/verify/${certID}${qs}`;
}

const templateSeeds: CertTemplate[] = [
  {
    id: generateSyncID("CC"),
    name: "SYNCPedia Classic",
    status: "active",
    createdAt: "2024-01-15",
    certType: "CC",
    style: { layout: "classic", bgColor: "#ffffff", accentColor: "#1A6B3C" },
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
    id: generateSyncID("PRO"),
    name: "Dark Pro",
    status: "active",
    createdAt: "2024-02-10",
    certType: "PRO",
    style: { layout: "dark-pro", bgColor: "#0f172a", accentColor: "#f59e0b" },
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
    id: generateSyncID("INT"),
    name: "Classic Elegant",
    status: "draft",
    createdAt: "2024-03-05",
    certType: "INT",
    style: { layout: "elegant", bgColor: "#fefce8", accentColor: "#1e3a5f" },
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

function copyToClipboard(text: string) {
  return navigator.clipboard.writeText(text);
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
  const width = 2970;
  const height = 2100;
  const f = template.fields;
  const bg = template.style.bgColor || "#ffffff";
  const accent = template.style.accentColor || "#1A6B3C";
  const text = template.style.layout === "dark-pro" ? "#ffffff" : "#0f172a";
  const subtle = template.style.layout === "dark-pro" ? "#cbd5e1" : "#475569";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${escapeXml(bg)}"/>
  <rect x="0" y="0" width="${width}" height="16" fill="${escapeXml(accent)}"/>
  <text x="90" y="90" fill="${escapeXml(subtle)}" font-size="28" font-family="Arial" letter-spacing="4">SYNCPEDIA</text>
  <text x="800" y="260" text-anchor="middle" fill="${escapeXml(text)}" font-size="74" font-weight="700" font-family="Arial">${escapeXml(f.title)}</text>
  <text x="800" y="360" text-anchor="middle" fill="${escapeXml(subtle)}" font-size="34" font-family="Arial">This is to certify that</text>
  <text x="800" y="460" text-anchor="middle" fill="${escapeXml(accent)}" font-size="72" font-weight="700" font-family="Arial">${escapeXml(f.recipientName)}</text>
  <text x="800" y="560" text-anchor="middle" fill="${escapeXml(subtle)}" font-size="34" font-family="Arial">in recognition of successful completion of</text>
  <text x="800" y="640" text-anchor="middle" fill="${escapeXml(text)}" font-size="56" font-weight="600" font-family="Arial">${escapeXml(f.domainName)}</text>
  <text x="800" y="730" text-anchor="middle" fill="${escapeXml(subtle)}" font-size="34" font-family="Arial">${escapeXml(f.bodyText)}</text>
  <line x1="90" y1="930" x2="640" y2="930" stroke="${escapeXml(text)}" stroke-opacity="0.35" stroke-width="2"/>
  <text x="90" y="980" fill="${escapeXml(text)}" font-size="34" font-weight="700" font-family="Arial">${escapeXml(f.signatoryName)}</text>
  <text x="90" y="1020" fill="${escapeXml(subtle)}" font-size="26" font-family="Arial">${escapeXml(f.signatoryTitle)}</text>
  <rect x="1320" y="840" width="180" height="180" fill="none" stroke="${escapeXml(accent)}" stroke-width="6"/>
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
  return value === "CC" || value === "ACH" || value === "PRO" || value === "INT" || value === "WS";
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
  if (!isCertType(value.certType)) return false;
  if (!isRecord(value.style)) return false;
  if (!isLayoutStyle(value.style.layout)) return false;
  if (typeof value.style.bgColor !== "string") return false;
  if (typeof value.style.accentColor !== "string") return false;
  if (value.style.bgImage !== undefined && typeof value.style.bgImage !== "string") return false;
  if (value.style.bgPdf !== undefined && typeof value.style.bgPdf !== "string") return false;
  if (value.style.bgOverlayOpacity !== undefined && typeof value.style.bgOverlayOpacity !== "number") return false;
  if (!isRecord(value.fields)) return false;
  if (typeof value.fields.title !== "string") return false;
  if (typeof value.fields.recipientName !== "string") return false;
  if (typeof value.fields.domainName !== "string") return false;
  if (typeof value.fields.bodyText !== "string") return false;
  if (value.fields.logoLeftImage !== undefined && typeof value.fields.logoLeftImage !== "string") return false;
  if (value.fields.logoRightImage !== undefined && typeof value.fields.logoRightImage !== "string") return false;
  if (value.fields.watermarkText !== undefined && typeof value.fields.watermarkText !== "string") return false;
  if (value.fields.watermarkImage !== undefined && typeof value.fields.watermarkImage !== "string") return false;
  if (value.fields.signatureImage !== undefined && typeof value.fields.signatureImage !== "string") return false;
  if (typeof value.fields.signatoryName !== "string") return false;
  if (typeof value.fields.signatoryTitle !== "string") return false;
  const layers = Array.isArray(value.layers) ? value.layers : [];
  for (const layer of layers) {
    if (!isRecord(layer)) return false;
    if (typeof layer.id !== "string") return false;
    if (!["text", "name", "domain", "date", "certID", "qr", "logo", "signature", "image"].includes(String(layer.type))) return false;
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
  }
  return true;
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
  if (!isCertType(value.certType)) return false;
  if (typeof value.issueDate !== "string") return false;
  if (!isIssuedStatus(value.status)) return false;
  if (value.verifyToken !== undefined && typeof value.verifyToken !== "string") return false;
  return true;
}

function QRCodeWidget({
  certID,
  size = 64,
  fgColor = "#1A6B3C",
  showUrlText = false,
  verifyUrl,
}: {
  certID: string;
  size?: number;
  fgColor?: string;
  showUrlText?: boolean;
  verifyUrl?: string;
}) {
  const url = verifyUrl || getVerifyURL(certID);
  return (
    <div className="flex flex-col items-center gap-1">
      <QRCodeSVG value={url} size={size} fgColor={fgColor} bgColor="transparent" />
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
  recipientName,
  domainName,
  date,
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
  recipientName?: string;
  domainName?: string;
  date?: string;
}) {
  const fields: CertTemplateFields = { ...template.fields, ...(overrides || {}) };
  const idForQr = certID || template.id;
  const layers = template.layers || [];
  const certIdLayer = layers.find((l) => l.type === "certID");
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const resolveLayerContent = (layer: CertLayer) => {
    if (layer.type === "name") return recipientName || layer.content;
    if (layer.type === "domain") return domainName || layer.content;
    if (layer.type === "date") return date || layer.content;
    if (layer.type === "certID") return idForQr || layer.content;
    return layer.content;
  };

  useEffect(() => {
    if (!onLayerMove) return;
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const xPct = ((e.clientX - rect.left - dragRef.current.dx) / rect.width) * 100;
      const yPct = ((e.clientY - rect.top - dragRef.current.dy) / rect.height) * 100;
      onLayerMove(dragRef.current.id, Math.max(0, Math.min(100, xPct)), Math.max(0, Math.min(100, yPct)));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onLayerMove]);

  const base = (
    <div
      ref={canvasRef}
      className={cn(
        "relative w-full overflow-hidden rounded-xl border",
        template.style.layout === "classic" && "bg-white text-slate-900 border-slate-200",
        template.style.layout === "dark-pro" && "bg-slate-900 text-white border-slate-800",
        template.style.layout === "elegant" && "bg-amber-50 text-slate-900 border-amber-200",
      )}
      style={{
        aspectRatio: String(A4_ASPECT),
        width: "100%",
        background: template.style.bgColor,
        backgroundImage: template.style.bgImage ? `url(${template.style.bgImage})` : undefined,
        backgroundSize: template.style.bgImage ? "cover" : undefined,
        backgroundPosition: template.style.bgImage ? "center" : undefined,
      }}
      onClick={() => onLayerSelect?.(null)}
    >
      {template.style.bgPdf && renderPdfBackground && (
        <object
          data={`${template.style.bgPdf}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
          type="application/pdf"
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ border: "none" }}
        >
          <img
            src={template.style.bgPdf}
            alt="Certificate background"
            className="absolute inset-0 w-full h-full object-fill pointer-events-none"
          />
        </object>
      )}
      {template.style.bgImage && (
        <div
          className="absolute inset-0 bg-white dark:bg-slate-900"
          style={{ opacity: typeof template.style.bgOverlayOpacity === "number" ? template.style.bgOverlayOpacity : 0.55 }}
        />
      )}
      {template.style.bgPdf && renderPdfBackground && (
        <div
          className="absolute inset-0 bg-white dark:bg-slate-900"
          style={{ opacity: typeof template.style.bgOverlayOpacity === "number" ? template.style.bgOverlayOpacity : 0 }}
        />
      )}
      {fields.watermarkImage ? (
        <img
          src={fields.watermarkImage}
          alt="Watermark"
          className="absolute inset-0 m-auto max-h-[70%] max-w-[70%] object-contain pointer-events-none opacity-20"
        />
      ) : null}
      {fields.watermarkText ? (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <p
            className="text-4xl sm:text-6xl font-black uppercase tracking-[0.2em] text-slate-900/10 dark:text-white/10 select-none"
            style={{ transform: "rotate(-20deg)" }}
          >
            {fields.watermarkText}
          </p>
        </div>
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
            {fields.logoLeftImage ? (
              <img src={fields.logoLeftImage} alt="Left logo" className="h-10 max-w-[160px] object-contain" />
            ) : (
              <div className={cn("text-xs font-extrabold tracking-widest uppercase")} style={{ color: template.style.accentColor }}>
                SYNCPedia
              </div>
            )}
            {fields.logoRightImage ? <img src={fields.logoRightImage} alt="Right logo" className="h-10 max-w-[160px] object-contain" /> : <div />}
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
            <div className="shrink-0 self-end">
              <div className="flex flex-col items-center gap-1">
                <QRCodeWidget
                  certID={idForQr}
                  size={64}
                  fgColor={template.style.layout === "dark-pro" ? template.style.accentColor : "#1A6B3C"}
                  verifyUrl={verifyUrl}
                />
                <div className="text-[10px] font-extrabold font-mono px-2 py-1 rounded-md border" style={{ borderColor: template.style.accentColor }}>
                  {idForQr}
                </div>
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
            <div
              key={layer.id}
              className="absolute"
              style={{
                left: "11%",
                top: "84%",
                width: `${layer.width}%`,
                height: `${layer.height}%`,
                opacity: layer.opacity ?? 1,
                transform: "translate(-50%, -50%)",
                outline: selectedLayerID === layer.id ? "2px dashed #2ed573" : "none",
                cursor: layer.locked ? "default" : "move",
                zIndex: layer.zIndex ?? 10,
              }}
              onMouseDown={(e) => {
                if (layer.locked || !onLayerMove || !canvasRef.current) return;
                e.stopPropagation();
                const rect = canvasRef.current.getBoundingClientRect();
                dragRef.current = { id: layer.id, dx: e.clientX - rect.left - (layer.x / 100) * rect.width, dy: e.clientY - rect.top - (layer.y / 100) * rect.height };
              }}
              onClick={(e) => {
                e.stopPropagation();
                onLayerSelect?.(layer.id);
              }}
            >
              <div className="flex flex-col items-start gap-1">
                <QRCodeWidget certID={idForQr} size={96} verifyUrl={verifyUrl} />
                <div
                  className="font-mono"
                  style={{
                    color: certIdLayer?.color || "#333333",
                    fontSize: `${certIdLayer?.fontSize ?? 10}px`,
                    fontWeight: certIdLayer?.fontWeight ?? "normal",
                    fontStyle: certIdLayer?.fontStyle ?? "normal",
                    textAlign: certIdLayer?.align ?? "left",
                    opacity: certIdLayer?.opacity ?? 1,
                    width: `${certIdLayer?.width ?? 20}%`,
                  }}
                >
                  {idForQr}
                </div>
              </div>
            </div>
          );
        }
        if (layer.type === "certID") return null;
        if (layer.type === "logo" || layer.type === "image" || (layer.type === "signature" && layer.content.startsWith("data:image"))) {
          const isLogo = layer.type === "logo";
          const logoAlign = layer.align === "right" ? "right" : "left";
          return (
            <div
              key={layer.id}
              className="absolute"
              style={{
                left: isLogo ? (logoAlign === "right" ? "88%" : "12%") : `${layer.x}%`,
                top: isLogo ? "9%" : `${layer.y}%`,
                width: `${layer.width}%`,
                height: `${layer.height}%`,
                opacity: layer.opacity ?? 1,
                transform: "translate(-50%, -50%)",
                outline: selectedLayerID === layer.id ? "2px dashed #2ed573" : "none",
                cursor: "move",
                zIndex: layer.zIndex ?? 10,
              }}
              onMouseDown={(e) => {
                if (layer.locked || !onLayerMove || !canvasRef.current) return;
                e.stopPropagation();
                const rect = canvasRef.current.getBoundingClientRect();
                dragRef.current = { id: layer.id, dx: e.clientX - rect.left - (layer.x / 100) * rect.width, dy: e.clientY - rect.top - (layer.y / 100) * rect.height };
              }}
              onClick={(e) => {
                e.stopPropagation();
                onLayerSelect?.(layer.id);
              }}
            >
              {layer.content ? <img src={layer.content} alt={layer.label} className="w-full h-full object-contain pointer-events-none" /> : null}
            </div>
          );
        }
        return (
          <div
            key={layer.id}
            className="absolute whitespace-pre-wrap select-none"
            style={{
              left: `${layer.x}%`,
              top: `${layer.y}%`,
              width: `${layer.width}%`,
              minHeight: `${layer.height}%`,
              color: layer.color || "#111827",
              fontSize: `${layer.fontSize ?? 20}px`,
              fontWeight: layer.fontWeight ?? "normal",
              fontStyle: layer.fontStyle ?? "normal",
              opacity: layer.opacity ?? 1,
              transform: "translate(-50%, -50%)",
              textAlign: layer.align ?? "center",
              outline: selectedLayerID === layer.id ? "2px dashed #2ed573" : "none",
              cursor: "move",
              zIndex: layer.zIndex ?? 10,
            }}
            onMouseDown={(e) => {
              if (layer.locked || !onLayerMove || !canvasRef.current) return;
              e.stopPropagation();
              const rect = canvasRef.current.getBoundingClientRect();
              dragRef.current = { id: layer.id, dx: e.clientX - rect.left - (layer.x / 100) * rect.width, dy: e.clientY - rect.top - (layer.y / 100) * rect.height };
            }}
            onClick={(e) => {
              e.stopPropagation();
              onLayerSelect?.(layer.id);
            }}
          >
            {resolveLayerContent(layer)}
          </div>
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

function TemplateBuilderModal({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: CertTemplate;
  onSave: (next: CertTemplate) => Promise<void>;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<CertTemplate>(initial);
  const [previewOverrides, setPreviewOverrides] = useState<Partial<CertTemplateFields>>({});
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [selectedLayerID, setSelectedLayerID] = useState<string | null>(null);
  const [bgUploadError, setBgUploadError] = useState("");
  const [bgUploading, setBgUploading] = useState(false);
  const bgFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(initial);
    setPreviewOverrides({});
    setSelectedLayerID(null);
    setBgUploadError("");
    setBgUploading(false);
  }, [initial, open]);

  const verifyUrl = useMemo(() => getVerifyURL(draft.id), [draft.id]);
  const generatedVerifyLink = useMemo(() => {
    const payload: VerifyPayload = { certId: draft.id, template: compactTemplateForVerify(draft), overrides: {} };
    return getVerifyURL(draft.id, encodeVerifyPayload(payload));
  }, [draft]);

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
      setStyle("bgImage", url);
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
  const editableLayers = useMemo(
    () => (draft.layers || []).filter((layer) => IMPORT_EDITABLE_LAYER_TYPES.includes(layer.type)),
    [draft.layers],
  );
  const removeLayer = (layerId: string) => {
    setDraft((p) => ({ ...p, layers: (p.layers || []).filter((layer) => layer.id !== layerId) }));
  };
  const addTextLayer = () => {
    const layer: CertLayer = {
      id: crypto.randomUUID(),
      type: "text",
      label: "Custom Text",
      content: "Edit this text",
      x: 10,
      y: 10,
      width: 30,
      height: 8,
      color: "#111827",
      fontSize: 14,
      fontWeight: "normal",
      fontStyle: "normal",
      align: "left",
      opacity: 1,
      zIndex: (draft.layers || []).length + 10,
    };
    setDraft((p) => ({ ...p, layers: [...(p.layers || []), layer] }));
    setSelectedLayerID(layer.id);
  };
  const addImageLayer = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/jpg,image/webp";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const data = await readFileAsDataUrl(f);
      const layer: CertLayer = {
        id: crypto.randomUUID(),
        type: "image",
        label: "Custom Image",
        content: data,
        x: 10,
        y: 10,
        width: 20,
        height: 20,
        opacity: 1,
        zIndex: (draft.layers || []).length + 10,
      };
      setDraft((p) => ({ ...p, layers: [...(p.layers || []), layer] }));
      setSelectedLayerID(layer.id);
    };
    input.click();
  };

  const exportJson = () => {
    setSelectedLayerID(null);
    downloadTextFile(`${draft.name || "certificate-template"}.json`, JSON.stringify(draft, null, 2));
    toast({ title: "Exported JSON", description: "Template JSON downloaded." });
  };

  const exportPdfViaPrint = async () => {
    setSelectedLayerID(null);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const target = previewRef.current;
    if (!target) return;

    const printStyle = document.createElement("style");
    const styleId = `cert-print-${crypto.randomUUID()}`;
    printStyle.id = styleId;

    // Hide everything except previewRef container during print.
    // We also ensure the preview fills the page width.
    printStyle.textContent = `
@media print {
  @page {
    size: A4 landscape;
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
}`;
    document.head.appendChild(printStyle);

    const wrapper = document.createElement("div");
    wrapper.id = `${styleId}-scope`;
    wrapper.style.background = "white";
    wrapper.style.padding = "24px";
    wrapper.appendChild(target.cloneNode(true));
    document.body.appendChild(wrapper);

    try {
      window.print();
      toast({ title: "Print dialog opened", description: "Choose “Save as PDF” to export." });
    } finally {
      wrapper.remove();
      printStyle.remove();
    }
  };

  const copyId = async () => {
    await copyToClipboard(draft.id);
    toast({ title: "Copied", description: "SYNC ID copied to clipboard." });
  };

  const copyVerifyUrl = async () => {
    await copyToClipboard(verifyUrl);
    toast({ title: "Copied", description: "Verify URL copied to clipboard." });
  };

  const generateCertificate = () => {
    window.open(generatedVerifyLink, "_blank", "noopener,noreferrer");
    toast({ title: "Generated", description: "Opened clean certificate view." });
  };

  const saveDraft = async () => {
    try {
      await onSave({ ...draft, status: "draft" });
      onOpenChange(false);
      toast({ title: "Saved", description: "Template saved as draft." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save failed", description: e?.message || "Unable to save template." });
    }
  };

  const saveAndActivate = async () => {
    try {
      await onSave({ ...draft, status: "active" });
      onOpenChange(false);
      toast({ title: "Saved", description: "Template saved and activated." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save failed", description: e?.message || "Unable to save template." });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <div>
            <DialogTitle className="text-base">Template Builder</DialogTitle>
            <p className="text-xs text-muted-foreground">Live preview + export</p>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
          {/* LEFT: Preview */}
          <div className="p-6 bg-muted/15 border-b lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Badge variant={statusBadgeVariant(draft.status)} className="text-[10px]">{draft.status}</Badge>
                <Badge variant="outline" className={cn("text-[10px]", CERT_TYPE_COLORS[draft.certType])}>
                  {draft.certType} · {CERT_TYPE_LABELS[draft.certType]}
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

            <div ref={previewRef} className="max-w-[720px] mx-auto">
              <CertificatePreview
                template={draft}
                overrides={previewOverrides}
                renderPdfBackground
                selectedLayerID={selectedLayerID}
                onLayerSelect={setSelectedLayerID}
                onLayerMove={(id, x, y) => setLayer(id, { x, y })}
                recipientName={draft.fields.recipientName}
                domainName={draft.fields.domainName}
                date={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>

          {/* RIGHT: Form */}
          <div className="p-6">
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <Label className="text-xs">Template Name</Label>
                  <Input value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} placeholder="Template Name" />
                </div>

                <div>
                  <Label className="text-xs">Certificate Type</Label>
                  <Select
                    value={draft.certType}
                    onValueChange={(v) => {
                      const nextType = v as CertType;
                      setDraft((p) => ({
                        ...p,
                        certType: nextType,
                        id: p.id.startsWith("SYNC-") ? generateSyncID(nextType) : p.id,
                      }));
                    }}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {(["CC", "ACH", "PRO", "INT", "WS"] as CertType[]).map((t) => (
                        <SelectItem key={t} value={t}>
                          {t} — {CERT_TYPE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[11px] text-muted-foreground">Fixed output size: {A4_WIDTH_CM}cm x {A4_HEIGHT_CM}cm (A4 Landscape)</p>
                </div>

                <div>
                  <Label className="text-xs">Layout</Label>
                  <Select value={draft.style.layout} onValueChange={(v) => setStyle("layout", v as LayoutStyle)}>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select layout" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="classic">classic</SelectItem>
                      <SelectItem value="dark-pro">dark-pro</SelectItem>
                      <SelectItem value="elegant">elegant</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">Style</CardTitle>
                  <CardDescription className="text-xs">Background and accent colors</CardDescription>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
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
                          value={draft.style.bgOverlayOpacity ?? 0.55}
                          onChange={(e) => setStyle("bgOverlayOpacity", Number(e.target.value))}
                        />
                      </div>
                      <div className="mt-3">
                        <Label className="text-xs">Background image</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Optional. Upload a JPG/PNG to use as the certificate background (covers the canvas). Max 50 MB.
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <input
                            ref={bgFileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/jpg,image/webp"
                            className="text-xs file:mr-2 file:rounded file:border file:border-input file:bg-background file:px-2 file:py-1"
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
                              onClick={() => setStyle("bgImage", undefined)}
                            >
                              Remove
                            </Button>
                          ) : null}
                        </div>
                        {bgUploadError ? <p className="text-xs text-destructive mt-1.5">{bgUploadError}</p> : null}
                        {draft.style.bgImage ? (
                          <img
                            src={draft.style.bgImage}
                            alt="Background preview"
                            className="mt-2 max-h-24 rounded border object-contain bg-muted/20"
                          />
                        ) : null}
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
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">Editable Layers</CardTitle>
                  <CardDescription className="text-xs">Only Name, Date, QR, Certificate ID, and optional Logo are editable.</CardDescription>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  {editableLayers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No editable import layers found.</p>
                  ) : (
                    <div className="space-y-3">
                      {editableLayers.map((layer) => (
                        <div
                          key={layer.id}
                          className={cn("rounded-lg border p-3 space-y-2 cursor-pointer", selectedLayerID === layer.id && "border-green-500 ring-1 ring-green-500")}
                          onClick={() => setSelectedLayerID(layer.id)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <Input
                              value={layer.label}
                              onChange={(e) => setLayer(layer.id, { label: e.target.value })}
                              className="h-8 text-xs"
                            />
                          </div>
                          {selectedLayerID === layer.id && layer.type !== "qr" && layer.type !== "certID" ? <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div>
                              <Label className="text-[11px]">X (%)</Label>
                              <Input type="number" value={layer.x} onChange={(e) => setLayer(layer.id, { x: Number(e.target.value) })} />
                            </div>
                            <div>
                              <Label className="text-[11px]">Y (%)</Label>
                              <Input type="number" value={layer.y} onChange={(e) => setLayer(layer.id, { y: Number(e.target.value) })} />
                            </div>
                            <div>
                              <Label className="text-[11px]">Width (%)</Label>
                              <Input type="number" value={layer.width} onChange={(e) => setLayer(layer.id, { width: Number(e.target.value) })} />
                            </div>
                            <div>
                              <Label className="text-[11px]">Height (%)</Label>
                              <Input type="number" value={layer.height} onChange={(e) => setLayer(layer.id, { height: Number(e.target.value) })} />
                            </div>
                            <div>
                              <Label className="text-[11px]">Opacity</Label>
                              <Input type="number" min={0} max={1} step={0.05} value={layer.opacity ?? 1} onChange={(e) => setLayer(layer.id, { opacity: Number(e.target.value) })} />
                            </div>
                          </div> : null}
                          {selectedLayerID === layer.id && (layer.type === "name" || layer.type === "date" || layer.type === "certID") ? (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <div className="sm:col-span-3">
                                <Label className="text-[11px]">Content</Label>
                                <Textarea rows={2} value={layer.content || ""} onChange={(e) => setLayer(layer.id, { content: e.target.value })} />
                              </div>
                              <div>
                                <Label className="text-[11px]">Color</Label>
                                <Input value={layer.color || "#111827"} onChange={(e) => setLayer(layer.id, { color: e.target.value })} />
                              </div>
                              <div>
                                <Label className="text-[11px]">Font Size</Label>
                                <Input type="number" value={layer.fontSize ?? 20} onChange={(e) => setLayer(layer.id, { fontSize: Number(e.target.value) })} />
                              </div>
                              <div>
                                <Label className="text-[11px]">Font Weight</Label>
                                <Select value={layer.fontWeight ?? "normal"} onValueChange={(v) => setLayer(layer.id, { fontWeight: v as "normal" | "bold" })}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="normal">Normal</SelectItem>
                                    <SelectItem value="bold">Bold</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <Label className="text-[11px]">Font Style</Label>
                                <Select value={layer.fontStyle ?? "normal"} onValueChange={(v) => setLayer(layer.id, { fontStyle: v as "normal" | "italic" })}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="normal">Normal</SelectItem>
                                    <SelectItem value="italic">Italic</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <Label className="text-[11px]">Align</Label>
                                <Select value={layer.align ?? "center"} onValueChange={(v) => setLayer(layer.id, { align: v as "left" | "center" | "right" })}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="left">Left</SelectItem>
                                    <SelectItem value="center">Center</SelectItem>
                                    <SelectItem value="right">Right</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          ) : selectedLayerID === layer.id && layer.type === "qr" ? (
                            <p className="text-xs text-muted-foreground">QR is fixed at bottom-left. Certificate ID is fixed directly below the QR.</p>
                          ) : selectedLayerID === layer.id && layer.type === "logo" ? (
                            <div className="space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <Label className="text-[11px]">Width (%)</Label>
                                  <Input type="number" value={layer.width} onChange={(e) => setLayer(layer.id, { width: Number(e.target.value) })} />
                                </div>
                                <div>
                                  <Label className="text-[11px]">Height (%)</Label>
                                  <Input type="number" value={layer.height} onChange={(e) => setLayer(layer.id, { height: Number(e.target.value) })} />
                                </div>
                              </div>
                              <div>
                                <Label className="text-[11px]">Logo Position</Label>
                                <Select value={layer.align === "right" ? "right" : "left"} onValueChange={(v) => setLayer(layer.id, { align: v as "left" | "right" })}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="left">Top Left</SelectItem>
                                    <SelectItem value="right">Top Right</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex gap-2">
                                <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => {
                                  const input = document.createElement("input");
                                  input.type = "file";
                                  input.accept = "image/png,image/jpeg,image/jpg,image/webp";
                                  input.onchange = async () => {
                                    const f = input.files?.[0];
                                    if (!f) return;
                                    const data = await readFileAsDataUrl(f);
                                    setLayer(layer.id, { content: data });
                                  };
                                  input.click();
                                }}>
                                  Upload/Replace Logo
                                </Button>
                                <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={() => setLayer(layer.id, { content: "" })}>
                                  Clear Logo
                                </Button>
                              </div>
                              {layer.content ? <img src={layer.content} alt={layer.label} className="h-16 object-contain rounded border bg-muted/10 p-1" /> : null}
                            </div>
                          ) : selectedLayerID === layer.id ? (
                            <div className="space-y-2">
                              <div className="flex gap-2">
                                <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => {
                                  const input = document.createElement("input");
                                  input.type = "file";
                                  input.accept = "image/png,image/jpeg,image/jpg,image/webp";
                                  input.onchange = async () => {
                                    const f = input.files?.[0];
                                    if (!f) return;
                                    const data = await readFileAsDataUrl(f);
                                    setLayer(layer.id, { content: data });
                                  };
                                  input.click();
                                }}>
                                  Replace Image
                                </Button>
                                <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={() => setLayer(layer.id, { content: "" })}>
                                  Clear Image
                                </Button>
                              </div>
                              {layer.content ? <img src={layer.content} alt={layer.label} className="h-16 object-contain rounded border bg-muted/10 p-1" /> : null}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">Fields</CardTitle>
                  <CardDescription className="text-xs">
                    {(draft.layers || []).length > 0
                      ? "This template uses editable layers. Edit field content in the Layers panel above."
                      : "These populate the certificate preview"}
                  </CardDescription>
                </CardHeader>
                {(draft.layers || []).length > 0 ? (
                  <CardContent className="px-4 pb-4">
                    <p className="text-xs text-muted-foreground">
                      This template uses editable layers. Edit field content in the Layers panel above.
                    </p>
                  </CardContent>
                ) : (
                <CardContent className="px-4 pb-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Title</Label>
                      <Input value={draft.fields.title} onChange={(e) => setField("title", e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Recipient Name</Label>
                      <Input value={draft.fields.recipientName} onChange={(e) => setField("recipientName", e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Domain / Course</Label>
                      <Input value={draft.fields.domainName} onChange={(e) => setField("domainName", e.target.value)} />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Body Text</Label>
                      <Textarea value={draft.fields.bodyText} onChange={(e) => setField("bodyText", e.target.value)} rows={3} />
                    </div>
                    <div>
                      <Label className="text-xs">Signatory Name</Label>
                      <Input value={draft.fields.signatoryName} onChange={(e) => setField("signatoryName", e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Signatory Title</Label>
                      <Input value={draft.fields.signatoryTitle} onChange={(e) => setField("signatoryTitle", e.target.value)} />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Signature Image (optional)</Label>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => {
                            const input = document.createElement("input");
                            input.type = "file";
                            input.accept = "image/png,image/jpeg,image/jpg,image/webp";
                            input.onchange = async () => {
                              const f = input.files?.[0];
                              if (!f) return;
                              if (f.size > MAX_SIGNATURE_UPLOAD_BYTES) {
                                toast({
                                  variant: "destructive",
                                  title: "Image too large",
                                  description: "Signature image must be 50 MB or smaller.",
                                });
                                return;
                              }
                              const data = await readFileAsDataUrl(f);
                              setField("signatureImage", data);
                            };
                            input.click();
                          }}
                        >
                          Import Signature
                        </Button>
                        {draft.fields.signatureImage ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 text-destructive hover:text-destructive"
                            onClick={() => setField("signatureImage", "")}
                          >
                            Clear
                          </Button>
                        ) : null}
                      </div>
                      {draft.fields.signatureImage ? (
                        <div className="mt-2 rounded-md border bg-muted/20 p-2">
                          <img src={draft.fields.signatureImage} alt="Signature preview" className="h-10 max-w-[180px] object-contain" />
                        </div>
                      ) : null}
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Watermark Text (optional)</Label>
                      <Input
                        value={draft.fields.watermarkText || ""}
                        onChange={(e) => setField("watermarkText", e.target.value)}
                        placeholder="e.g. ORIGINAL / VERIFIED"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Watermark Image (optional)</Label>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => {
                          const input = document.createElement("input");
                          input.type = "file";
                          input.accept = "image/png,image/jpeg,image/jpg,image/webp";
                          input.onchange = async () => {
                            const f = input.files?.[0];
                            if (!f) return;
                            const data = await readFileAsDataUrl(f);
                            setField("watermarkImage", data);
                          };
                          input.click();
                        }}>
                          Upload Watermark
                        </Button>
                        {draft.fields.watermarkImage ? <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={() => setField("watermarkImage", "")}>Clear</Button> : null}
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Left Logo (optional)</Label>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => {
                          const input = document.createElement("input");
                          input.type = "file";
                          input.accept = "image/png,image/jpeg,image/jpg,image/webp";
                          input.onchange = async () => {
                            const f = input.files?.[0];
                            if (!f) return;
                            const data = await readFileAsDataUrl(f);
                            setField("logoLeftImage", data);
                          };
                          input.click();
                        }}>
                          Upload Left Logo
                        </Button>
                        {draft.fields.logoLeftImage ? <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={() => setField("logoLeftImage", "")}>Clear</Button> : null}
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Right Logo (optional)</Label>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => {
                          const input = document.createElement("input");
                          input.type = "file";
                          input.accept = "image/png,image/jpeg,image/jpg,image/webp";
                          input.onchange = async () => {
                            const f = input.files?.[0];
                            if (!f) return;
                            const data = await readFileAsDataUrl(f);
                            setField("logoRightImage", data);
                          };
                          input.click();
                        }}>
                          Upload Right Logo
                        </Button>
                        {draft.fields.logoRightImage ? <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={() => setField("logoRightImage", "")}>Clear</Button> : null}
                      </div>
                    </div>
                  </div>
                </CardContent>
                )}
              </Card>

              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">SYNC ID</CardTitle>
                  <CardDescription className="text-xs">Used for QR verification</CardDescription>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input value={draft.id} onChange={(e) => setDraft((p) => ({ ...p, id: e.target.value }))} className="font-mono text-xs" />
                    <Button variant="outline" size="sm" className="h-9 gap-1" onClick={copyId}>
                      <Copy className="h-4 w-4" />
                      Copy
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground break-all">{verifyUrl}</div>
                    <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={copyVerifyUrl}>
                      <Copy className="h-3.5 w-3.5" />
                      Copy URL
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t flex flex-col sm:flex-row gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            <Button variant="outline" onClick={saveDraft}>
              Save Draft
            </Button>
            <Button variant="outline" onClick={generateCertificate} className="gap-1.5">
              <Award className="h-4 w-4" />
              Generate
            </Button>
            <Button onClick={saveAndActivate} className="gap-1.5">
              <Send className="h-4 w-4" />
              Save & Activate
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateCard({
  template,
  onEdit,
  onDuplicate,
  onArchive,
  onDelete,
  onIssue,
}: {
  template: CertTemplate;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onIssue: () => void;
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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={onEdit} className="gap-2">
                <Pencil className="h-4 w-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate} className="gap-2">
                <Copy className="h-4 w-4" /> Duplicate
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

        <div className="mt-2 flex items-center gap-2">
          <Badge variant={statusBadgeVariant(template.status)} className="text-[10px]">
            {template.status}
          </Badge>
          <Badge variant="outline" className={cn("text-[10px]", CERT_TYPE_COLORS[template.certType])}>
            {template.certType} · {CERT_TYPE_LABELS[template.certType]}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 flex-1 flex flex-col">
        <div
          className="overflow-hidden rounded-md w-full bg-gray-100"
          style={{ height: 140, position: "relative" }}
        >
          <div
            style={{
              transform: "scale(0.28)",
              transformOrigin: "top left",
              width: "357%",
              pointerEvents: "none",
              position: "absolute",
              top: 0,
              left: 0,
            }}
          >
            <CertificatePreview template={template} renderPdfBackground />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-auto">
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={onIssue} disabled={template.status !== "active"}>
            <Award className="h-3.5 w-3.5" />
            Issue Certificate
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

async function createImageBitmapFromDataUrl(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => reject(new Error("Unable to read imported image dimensions."));
    img.src = dataUrl;
  });
}

async function extractTextLayersFromImage(dataUrl: string): Promise<CertLayer[]> {
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(dataUrl);
    const dims = await createImageBitmapFromDataUrl(dataUrl);
    const words = (
      (data as { words?: Array<{ text?: string; bbox?: { x0: number; x1: number; y0: number; y1: number } }> }).words || []
    ).filter((w) => String(w?.text || "").trim().length >= 2);
    const lines: CertLayer[] = [];
    for (const w of words.slice(0, 120)) {
      const text = String(w.text || "").trim();
      if (!text) continue;
      const x = ((w.bbox.x0 + w.bbox.x1) / 2 / dims.width) * 100;
      const y = ((w.bbox.y0 + w.bbox.y1) / 2 / dims.height) * 100;
      const width = Math.max(6, Math.min(80, ((w.bbox.x1 - w.bbox.x0) / dims.width) * 100));
      const height = Math.max(3, Math.min(20, ((w.bbox.y1 - w.bbox.y0) / dims.height) * 100));
      lines.push({
        id: crypto.randomUUID(),
        type: "text",
        label: `OCR: ${text.slice(0, 24)}`,
        content: text,
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        width: Number(width.toFixed(2)),
        height: Number(height.toFixed(2)),
        fontSize: 14,
        fontWeight: "normal",
        fontStyle: "normal",
        color: "#222222",
        align: "left",
        opacity: 1,
      });
    }
    return lines;
  } finally {
    await worker.terminate();
  }
}

type StudentRecipient = {
  id: string;
  name: string;
  email: string;
};

const fallbackStudents: StudentRecipient[] = [
  { id: "s1", name: "Ananya Rao", email: "ananya.rao@example.com" },
  { id: "s2", name: "Rahul Verma", email: "rahul.verma@example.com" },
  { id: "s3", name: "Meera Nair", email: "meera.nair@example.com" },
  { id: "s4", name: "Vikram Singh", email: "vikram.singh@example.com" },
  { id: "s5", name: "Sara Khan", email: "sara.khan@example.com" },
  { id: "s6", name: "Arjun Iyer", email: "arjun.iyer@example.com" },
];

function IssueCertWizard({
  open,
  onOpenChange,
  templates,
  initialTemplateId,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: CertTemplate[];
  initialTemplateId?: string;
  onConfirm: (issued: IssuedCertificate[]) => Promise<void>;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(initialTemplateId || null);
  const [courseName, setCourseName] = useState("");
  const [issueDate, setIssueDate] = useState(stableNowISODate());
  const [certIdsByRecipientId, setCertIdsByRecipientId] = useState<Record<string, string>>({});
  const [students, setStudents] = useState<StudentRecipient[]>(fallbackStudents);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [isIssuing, setIsIssuing] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailLogRows, setEmailLogRows] = useState<any[]>([]);
  const [issuePayload, setIssuePayload] = useState<{
    studentName: string;
    studentEmail: string;
    syncId: string;
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
    setIsIssuing(false);
    setSendingEmail(false);
    setEmailSent(false);
    setIssuePayload(null);
    setEmailDraft({ to: "", cc: "", bcc: "", subject: "", body: "", attachmentUrl: "", attachmentName: "" });
    setEmailLogRows([]);
  }, [open, initialTemplateId]);

  useEffect(() => {
    if (!open) return;
    let mounted = true;

    (async () => {
      setLoadingStudents(true);
      try {
        const res = await api.students.list();
        const rows = (res as any)?.data;
        if (!Array.isArray(rows)) return;

        const normalized: StudentRecipient[] = rows
          .map((row: any) => ({
            id: String(row?.id || "").trim(),
            name: String(row?.name || "").trim(),
            email: String(row?.email || "").trim(),
          }))
          .filter((s) => s.id && s.name);

        if (mounted && normalized.length > 0) {
          setStudents(normalized);
        }
      } catch {
        // keep fallback list when API is unavailable
      } finally {
        if (mounted) setLoadingStudents(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [open]);

  const activeTemplates = useMemo(() => templates.filter((t) => t.status !== "archived"), [templates]);
  const selectedTemplate = useMemo(
    () => (selectedTemplateId ? templates.find((t) => t.id === selectedTemplateId) || null : null),
    [templates, selectedTemplateId],
  );

  const selectedRecipients = useMemo(
    () => students.filter((r) => selectedRecipientIds.includes(r.id)),
    [selectedRecipientIds, students],
  );

  const toggleRecipient = (id: string) => {
    setSelectedRecipientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const goNext = () => {
    if (step === 1) {
      if (selectedRecipientIds.length === 0) {
        toast({ variant: "destructive", title: "Select recipients", description: "Pick at least one recipient to continue." });
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!selectedTemplate) {
        toast({ variant: "destructive", title: "Select template", description: "Choose a certificate template." });
        return;
      }
      if (!issueDate.trim()) {
        toast({ variant: "destructive", title: "Issue date required", description: "Select an issue date." });
        return;
      }
      const next: Record<string, string> = {};
      for (const r of selectedRecipients) {
        next[r.id] = generateSyncID(selectedTemplate.certType);
      }
      setCertIdsByRecipientId(next);
      setStep(3);
      return;
    }
  };

  const goBack = () => setStep((s) => (s === 4 ? 3 : s === 3 ? 2 : 1));

  const confirm = async () => {
    if (!selectedTemplate) return;
    if (selectedRecipients.length === 0) return;
    const issuedList: IssuedCertificate[] = selectedRecipients.map((r) => {
      const certId = certIdsByRecipientId[r.id] || generateSyncID(selectedTemplate.certType);
      const verifyToken = encodeVerifyPayload({
        certId,
        template: compactTemplateForVerify(selectedTemplate),
        overrides: {
          recipientName: r.name,
          domainName: courseName.trim() || selectedTemplate.fields.domainName,
        },
      });
      return {
        id: certId,
        templateId: selectedTemplate.id,
        templateName: selectedTemplate.name,
        recipientName: r.name,
        courseName: courseName.trim() || selectedTemplate.fields.domainName || "Certificate",
        certType: selectedTemplate.certType,
        issueDate,
        status: "issued",
        verifyToken,
      };
    });
    try {
      setIsIssuing(true);
      await onConfirm(issuedList);
      const primary = selectedRecipients[0];
      const primaryIssued = issuedList.find((i) => i.recipientName === primary.name) || issuedList[0];
      const issueRes = await api.certificates.issue({
        recipientId: primary.id,
        templateId: selectedTemplate.id,
        syncId: primaryIssued.id,
        recipientName: primary.name,
        recipientEmail: primary.email,
        courseName: courseName.trim(),
        issueDate,
        verifyToken: primaryIssued.verifyToken,
      });
      const payload = {
        studentName: String(issueRes?.studentName || primary.name || "").trim(),
        studentEmail: String(issueRes?.studentEmail || primary.email || "").trim(),
        syncId: String(issueRes?.syncId || primaryIssued.id || "").trim(),
        certificateId: String(issueRes?.certificateId || primaryIssued.id || "").trim(),
        pdfUrl: String(issueRes?.pdfUrl || "").trim(),
        templateId: selectedTemplate.id,
      };
      const defaultSubject = `Your Certificate is Ready — ${payload.syncId}`;
      const defaultBody = `Dear ${payload.studentName},

We are pleased to inform you that your certificate has been successfully issued.

Please find the attached certificate (PDF) for your reference. You can also
verify your certificate anytime using your unique SYNC ID: ${payload.syncId}

If you have any questions or need assistance, please do not hesitate to reach out.

Warm regards,
The Certifications Team`;
      setIssuePayload(payload);
      setEmailDraft({
        to: payload.studentEmail,
        cc: "",
        bcc: "",
        subject: defaultSubject,
        body: defaultBody,
        attachmentUrl: payload.pdfUrl,
        attachmentName: `Certificate_${payload.studentName.replace(/\s+/g, "_")}_${payload.syncId}.pdf`,
      });
      setStep(4);
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
    setIssuePayload(null);
    setEmailSent(false);
    setEmailDraft({ to: "", cc: "", bcc: "", subject: "", body: "", attachmentUrl: "", attachmentName: "" });
    setEmailLogRows([]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Issue Certificates</DialogTitle>
        </DialogHeader>

        <div className="mb-4 flex items-center gap-2 text-xs">
          <Badge variant={step === 1 ? "default" : "secondary"} className="text-[10px]">1. Recipients</Badge>
          <Badge variant={step === 2 ? "default" : "secondary"} className="text-[10px]">2. Template</Badge>
          <Badge variant={step === 3 ? "default" : "secondary"} className="text-[10px]">3. Review</Badge>
          <Badge variant={step === 4 ? "default" : "secondary"} className="text-[10px]">4. Send Email</Badge>
        </div>

        {step === 1 && (
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">Select students</CardTitle>
              <CardDescription className="text-xs">Multi-select students for bulk issuing</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ScrollArea className="h-[320px] pr-3">
                <div className="space-y-2">
                  {loadingStudents && (
                    <div className="text-xs text-muted-foreground px-1 py-2">Loading students...</div>
                  )}
                  {!loadingStudents && students.map((r) => {
                    const checked = selectedRecipientIds.includes(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className={cn(
                          "w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                          checked ? "bg-primary/5 border-primary/30" : "bg-background hover:bg-muted/20",
                        )}
                        onClick={() => toggleRecipient(r.id)}
                      >
                        <Checkbox checked={checked} onCheckedChange={() => toggleRecipient(r.id)} />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">{r.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{r.email}</div>
                        </div>
                        <span className="ml-auto text-[10px] text-muted-foreground">{checked ? "Selected" : ""}</span>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">Pick a template</CardTitle>
                <CardDescription className="text-xs">Choose from existing templates</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <ScrollArea className="h-[420px] pr-3">
                  <div className="grid gap-3">
                    {activeTemplates.map((t) => {
                      const selected = selectedTemplateId === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          className={cn(
                            "rounded-xl border p-3 text-left transition-colors",
                            selected ? "border-primary ring-2 ring-primary/20 bg-primary/5" : "hover:bg-muted/20",
                          )}
                          onClick={() => setSelectedTemplateId(t.id)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold truncate">{t.name}</div>
                              <div className="text-[11px] text-muted-foreground font-mono truncate">{t.id}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={statusBadgeVariant(t.status)} className="text-[10px]">{t.status}</Badge>
                              <Badge variant="outline" className={cn("text-[10px]", CERT_TYPE_COLORS[t.certType])}>{t.certType}</Badge>
                            </div>
                          </div>
                          <div className="mt-2 overflow-hidden rounded-lg border bg-muted/10">
                            <div className="p-2">
                              <CertificatePreview template={t} scale={0.36} renderPdfBackground />
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">Issue details</CardTitle>
                <CardDescription className="text-xs">Course and issue date</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div>
                  <Label className="text-xs">Course name (optional)</Label>
                  <Input value={courseName} onChange={(e) => setCourseName(e.target.value)} placeholder="Leave empty for template default" />
                </div>
                <div>
                  <Label className="text-xs">Issue date</Label>
                  <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                </div>

                <div className="pt-2">
                  <Label className="text-xs">Preview (selected template)</Label>
                  <div className="mt-2">
                    {selectedTemplate ? (
                      <CertificatePreview
                        template={selectedTemplate}
                        recipientName={selectedRecipients[0]?.name || selectedTemplate.fields.recipientName}
                        domainName={courseName || selectedTemplate.fields.domainName}
                        date={issueDate}
                        overrides={{ domainName: courseName || selectedTemplate.fields.domainName }}
                        renderPdfBackground
                      />
                    ) : (
                      <div className="text-sm text-muted-foreground">Select a template to preview.</div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {step === 3 && (
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">Review</CardTitle>
              <CardDescription className="text-xs">Each recipient gets a unique SYNC ID + QR</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {!selectedTemplate ? (
                <div className="text-sm text-muted-foreground">No template selected.</div>
              ) : (
                <ScrollArea className="h-[420px] pr-3">
                  <div className="space-y-3">
                    {selectedRecipients.map((r) => {
                      const id = certIdsByRecipientId[r.id] || generateSyncID(selectedTemplate.certType);
                      const payload: VerifyPayload = {
                        certId: id,
                        template: compactTemplateForVerify(selectedTemplate),
                        overrides: {
                          recipientName: r.name,
                          domainName: courseName.trim() || selectedTemplate.fields.domainName,
                        },
                      };
                      const verifyUrl = getVerifyURL(id, encodeVerifyPayload(payload));
                      return (
                        <div key={r.id} className="rounded-xl border p-4 bg-background">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold truncate">{r.name}</div>
                              <div className="text-xs text-muted-foreground truncate">{r.email}</div>
                              <div className="mt-2 text-xs font-mono break-all">{id}</div>
                            </div>
                            <div className="shrink-0">
                              <QRCodeWidget certID={id} size={72} fgColor={selectedTemplate.style.layout === "dark-pro" ? selectedTemplate.style.accentColor : "#1A6B3C"} verifyUrl={verifyUrl} />
                            </div>
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

        {step === 4 && issuePayload && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
            <div className="space-y-3">
              <div className="rounded-md border border-emerald-300 bg-emerald-50 text-emerald-900 px-3 py-2 text-sm">
                Certificate issued successfully for {issuePayload.studentName} — {issuePayload.syncId}
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
                    <div className="text-xs font-mono">{issuePayload.syncId}</div>
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
                    <CardDescription className="text-xs">Edit before sending the certificate email.</CardDescription>
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
                      <Textarea rows={10} value={emailDraft.body} onChange={(e) => setEmailDraft((p) => ({ ...p, body: e.target.value }))} />
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
            {step < 3 ? (
              <Button onClick={goNext} className="gap-1.5">
                Next
              </Button>
            ) : step === 3 ? (
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
  const previewTemplate = useMemo(() => (previewCert ? templates.find((t) => t.id === previewCert.templateId) || null : null), [templates, previewCert]);
  const previewVerifyUrl = useMemo(() => {
    if (!previewCert) return "";
    if (previewCert.verifyToken) return getVerifyURL(previewCert.id, previewCert.verifyToken);
    if (!previewTemplate) return getVerifyURL(previewCert.id);
    const token = encodeVerifyPayload({
      certId: previewCert.id,
      template: compactTemplateForVerify(previewTemplate),
      overrides: {
        recipientName: previewCert.recipientName,
        domainName: previewCert.courseName,
      },
    });
    return getVerifyURL(previewCert.id, token);
  }, [previewCert, previewTemplate]);

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
                      <Badge variant="outline" className={cn("text-[10px]", CERT_TYPE_COLORS[c.certType])}>
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
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Certificate Preview</DialogTitle>
          </DialogHeader>
          {previewCert && previewTemplate ? (
            <div className="overflow-auto max-h-[70vh] flex flex-col items-center gap-4 p-4 bg-muted/30 rounded-lg">
              <CertificatePreview
                template={previewTemplate}
                certID={previewCert.id}
                verifyUrl={previewVerifyUrl}
                recipientName={previewCert.recipientName}
                domainName={previewCert.courseName}
                date={previewCert.issueDate}
                overrides={{
                  recipientName: previewCert.recipientName,
                  domainName: previewCert.courseName,
                }}
              />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Unable to load preview.</div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewCertId(null)}>
              Close
            </Button>
            <Button onClick={() => window.print()} className="gap-1.5">
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (template: CertTemplate) => void;
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
        const defaultLayers: CertLayer[] = [
          { id: crypto.randomUUID(), type: "name", label: "Recipient Name", content: "<<Name>>", x: 50, y: 42, width: 60, height: 10, fontSize: 28, fontWeight: "bold", color: "#1A6B3C", align: "center", opacity: 1, zIndex: 10 },
          { id: crypto.randomUUID(), type: "date", label: "Issue Date", content: "<<Date>>", x: 20, y: 88, width: 20, height: 5, fontSize: 11, fontWeight: "normal", color: "#555555", align: "left", opacity: 1, zIndex: 11 },
          { id: crypto.randomUUID(), type: "certID", label: "Certificate ID", content: "SYNC-CC-YYYYMMDD-XXXXX", x: 11, y: 93, width: 20, height: 5, fontSize: 9, fontWeight: "normal", color: "#333333", align: "left", opacity: 1, zIndex: 12, locked: true },
          { id: crypto.randomUUID(), type: "qr", label: "QR Code", content: "", x: 11, y: 84, width: 11, height: 11, opacity: 1, zIndex: 13, locked: true },
          { id: crypto.randomUUID(), type: "logo", label: "Logo", content: "", x: 12, y: 9, width: 14, height: 14, opacity: 1, zIndex: 14, align: "left" },
        ];
        const mergedLayers = sanitizeImportLayers(defaultLayers);
        const importedTemplate: CertTemplate = {
          id: generateSyncID("CC"),
          name: importedName,
          status: "draft",
          createdAt: stableNowISODate(),
          certType: "CC",
          style: { layout: "classic", bgColor: "#ffffff", accentColor: "#1A6B3C", bgImage: imageData, bgPdf: pdfData },
          fields: {
            title: "",
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
          description: "Background imported — editable fields: Name, Date, Certificate ID, QR (fixed), and optional Logo.",
        });
        onOpenChange(false);
        return;
      }

      const raw = await file.text();
      const parsed: unknown = JSON.parse(raw);
      if (!isCertTemplate(parsed)) {
        throw new Error("JSON does not match CertTemplate shape.");
      }
      // Simulate completion
      setProgress(100);
      const parsedTemplate = {
        ...(parsed as CertTemplate),
        status: "draft" as CertStatus,
        layers: sanitizeImportLayers((parsed as CertTemplate).layers || []),
      };
      onImport(parsedTemplate);
      toast({ title: "Imported", description: "Template imported with limited editable fields (Name, Date, Certificate ID, QR, Logo)." });
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
  const encoded = searchParams.get("data") || "";
  const payload = useMemo(() => (encoded ? decodeVerifyPayload(encoded) : null), [encoded]);

  const displayTemplate = payload?.template || null;
  const displayId = payload?.certId || certId;
  const displayOverrides = payload?.overrides || {};

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        {!displayTemplate ? (
          <Card>
            <CardContent className="py-10 text-center">
              <h1 className="text-xl font-bold">Certificate not found</h1>
              <p className="text-sm text-muted-foreground mt-2">Invalid or expired verification link.</p>
            </CardContent>
          </Card>
        ) : (
          <CertificatePreview template={displayTemplate} certID={displayId} overrides={displayOverrides} showQr={false} />
        )}
      </div>
    </div>
  );
}

export default function CertificatesPage() {
  const { toast } = useToast();

  const [templates, setTemplates] = useState<CertTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesSyncError, setTemplatesSyncError] = useState<string | null>(null);
  const [issuedCerts, setIssuedCerts] = useState<IssuedCertificate[]>([]);
  const [loadingIssued, setLoadingIssued] = useState(false);
  const [activeTab, setActiveTab] = useState<"templates" | "issued">("templates");
  const [showBuilder, setShowBuilder] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const prevWizardOpen = useRef(false);
  const [editingTemplate, setEditingTemplate] = useState<CertTemplate | null>(null);
  const [wizardInitialTemplateId, setWizardInitialTemplateId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingTemplates(true);
      try {
        const res = await api.certificates.listTemplates();
        const rows = (res as any)?.data;
        if (!Array.isArray(rows)) return;
        const valid = rows.filter((t: unknown) => isCertTemplate(t));
        if (mounted) {
          setTemplates(valid);
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
          certType: (String(row?.cert_type || row?.certType || "CC").trim() as CertType),
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
    const seed: CertTemplate = {
      id: generateSyncID("CC"),
      name: "New Template",
      status: "draft",
      createdAt: stableNowISODate(),
      certType: "CC",
      style: { layout: "classic", bgColor: "#ffffff", accentColor: "#1A6B3C" },
      fields: {
        title: "Certificate of Completion",
        recipientName: "Recipient Name",
        domainName: "Course / Domain Name",
        bodyText: "Has successfully completed the program with distinction.",
        watermarkText: "",
        signatoryName: "Signatory Name",
        signatoryTitle: "Signatory Title",
      },
      layers: [],
    };
    setEditingTemplate(null);
    setEditingTemplate(seed);
    setShowBuilder(true);
  };

  const upsertTemplate = async (next: CertTemplate) => {
    const prepared = await prepareCertTemplateForSave(next);
    await api.certificates.saveTemplate(prepared);
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
      id: generateSyncID(t.certType),
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
    setWizardInitialTemplateId(t.id);
    setShowWizard(true);
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
          <TabsTrigger value="issued" className="gap-1.5">
            <Send className="h-3.5 w-3.5" /> Issued
          </TabsTrigger>
        </TabsList>

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
                  onEdit={() => editTemplate(t)}
                  onDuplicate={() => duplicateTemplate(t)}
                  onArchive={() => archiveTemplate(t)}
                  onDelete={() => deleteTemplate(t)}
                  onIssue={() => issueFromTemplate(t)}
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
                        <Badge variant="outline" className={cn("text-[10px]", CERT_TYPE_COLORS[t.certType])}>
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
        onSave={async (t) => {
          await upsertTemplate(t);
          setEditingTemplate(null);
        }}
      />
      <ImportModal
        open={showImport}
        onOpenChange={setShowImport}
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
        onConfirm={addIssuedBatch}
      />
    </div>
  );
}

