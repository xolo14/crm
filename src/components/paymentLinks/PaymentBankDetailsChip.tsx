import { useEffect, useMemo, useState } from "react";
import { Building2, Check, Copy, QrCode } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { ProtectedUploadImage } from "@/components/ProtectedUploadImage";
import { resolveUploadSrc, resumeStoragePath } from "@/lib/resumeHref";
import { getApiBase } from "@/lib/apiBase";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type OrgBankPaymentInfo = {
  paymentQrUrl: string;
  accountName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  branch: string;
  upi: string;
};

function parseBankInfo(res: unknown): OrgBankPaymentInfo {
  const profile =
    (res as { data?: { profile?: Record<string, unknown> } })?.data?.profile || {};
  return {
    paymentQrUrl: String(profile.payment_qr_url || "").trim(),
    accountName: String(profile.bank_account_name || "").trim(),
    accountNumber: String(profile.bank_account_number || "").trim(),
    ifsc: String(profile.bank_ifsc || "").trim(),
    bankName: String(profile.bank_name || "").trim(),
    branch: String(profile.bank_branch || "").trim(),
    upi: String(profile.bank_upi || "").trim(),
  };
}

function formatBankDetailsText(info: OrgBankPaymentInfo): string {
  const lines: string[] = [];
  if (info.accountName) lines.push(`Account name: ${info.accountName}`);
  if (info.accountNumber) lines.push(`Account number: ${info.accountNumber}`);
  if (info.ifsc) lines.push(`IFSC: ${info.ifsc}`);
  if (info.bankName) lines.push(`Bank: ${info.bankName}`);
  if (info.branch) lines.push(`Branch: ${info.branch}`);
  if (info.upi) lines.push(`UPI: ${info.upi}`);
  return lines.join("\n");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

async function fetchQrBlob(path: string): Promise<Blob> {
  const storage = resumeStoragePath(path);
  const src = storage
    ? `${getApiBase()}/files.php?path=${encodeURIComponent(storage)}`
    : resolveUploadSrc(path);
  if (!src) throw new Error("Missing QR path");
  const res = await fetch(src, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load QR (${res.status})`);
  const blob = await res.blob();
  if (blob.size <= 0) throw new Error("Empty QR file");
  return blob;
}

/** Browsers reliably accept image/png on the clipboard — convert JPEG/WebP first. */
async function blobAsPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
  if (!png) throw new Error("PNG encode failed");
  return png;
}

async function copyQrImage(path: string): Promise<boolean> {
  const raw = await fetchQrBlob(path);
  const png = await blobAsPng(raw);
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error("Clipboard image not supported in this browser");
  }
  // Some Chromium builds require a Promise-valued ClipboardItem entry.
  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": Promise.resolve(png),
    }),
  ]);
  return true;
}

function DetailLine({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 text-sm leading-relaxed">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all font-medium text-foreground">{value}</span>
    </div>
  );
}

/** Bank & QR button → popup with full details + copy (QR copies the image, not a URL). */
export default function PaymentBankDetailsChip() {
  const { toast } = useToast();
  const [info, setInfo] = useState<OrgBankPaymentInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [qrZoomOpen, setQrZoomOpen] = useState(false);
  const [copied, setCopied] = useState<"bank" | "qr" | null>(null);
  const [copyingQr, setCopyingQr] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.organizations.myOrg();
        if (!active) return;
        setInfo(parseBankInfo(res));
      } catch {
        if (active) setInfo(null);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const hasBank = useMemo(() => {
    if (!info) return false;
    return Boolean(
      info.accountName ||
        info.accountNumber ||
        info.ifsc ||
        info.bankName ||
        info.branch ||
        info.upi,
    );
  }, [info]);

  const hasAnything = Boolean(info?.paymentQrUrl || hasBank);
  if (!hasAnything || !info) return null;

  const flash = (kind: "bank" | "qr") => {
    setCopied(kind);
    window.setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1600);
  };

  const onCopyBank = async () => {
    const text = formatBankDetailsText(info);
    if (!text.trim()) {
      toast({ variant: "destructive", title: "No bank details to copy" });
      return;
    }
    const ok = await copyText(text);
    if (ok) {
      flash("bank");
      toast({ title: "Bank details copied" });
    } else {
      toast({ variant: "destructive", title: "Could not copy bank details" });
    }
  };

  const onCopyQr = async () => {
    if (!info.paymentQrUrl) {
      toast({ variant: "destructive", title: "No QR to copy" });
      return;
    }
    setCopyingQr(true);
    try {
      await copyQrImage(info.paymentQrUrl);
      flash("qr");
      toast({ title: "QR image copied", description: "Paste into WhatsApp, chat, or docs." });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Could not copy QR image",
        description:
          e instanceof Error
            ? e.message
            : "Try Chrome/Edge, or long-press / save the image from the preview.",
      });
    } finally {
      setCopyingQr(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="shrink-0 gap-1.5 border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
        onClick={() => setOpen(true)}
      >
        <QrCode size={16} />
        Bank &amp; QR
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[min(92dvh,100%)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Bank &amp; QR details
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {info.paymentQrUrl ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Payment QR
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={copyingQr}
                    onClick={() => void onCopyQr()}
                  >
                    {copied === "qr" ? <Check size={14} /> : <Copy size={14} />}
                    {copyingQr ? "Copying…" : "Copy QR image"}
                  </Button>
                </div>
                <button
                  type="button"
                  className="mx-auto flex h-52 w-52 items-center justify-center overflow-hidden rounded-xl border border-border bg-white p-2 hover:ring-2 hover:ring-primary/30 transition"
                  title="Click to enlarge"
                  onClick={() => setQrZoomOpen(true)}
                >
                  <ProtectedUploadImage
                    path={info.paymentQrUrl}
                    alt="Payment QR"
                    className="max-h-full max-w-full object-contain"
                  />
                </button>
                <p className="text-center text-[11px] text-muted-foreground">
                  Tap the QR to enlarge · Copy QR image pastes the photo (not a link)
                </p>
              </div>
            ) : null}

            {hasBank ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Bank details
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => void onCopyBank()}
                  >
                    {copied === "bank" ? <Check size={14} /> : <Copy size={14} />}
                    Copy details
                  </Button>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 space-y-2">
                  <DetailLine label="Account name" value={info.accountName} />
                  <DetailLine label="Account no." value={info.accountNumber} />
                  <DetailLine label="IFSC" value={info.ifsc} />
                  <DetailLine label="Bank" value={info.bankName} />
                  <DetailLine label="Branch" value={info.branch} />
                  <DetailLine label="UPI" value={info.upi} />
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={qrZoomOpen} onOpenChange={setQrZoomOpen}>
        <DialogContent className="max-w-lg p-4">
          <DialogHeader>
            <DialogTitle>Payment QR</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            <div className="flex max-h-[min(70dvh,28rem)] w-full items-center justify-center overflow-auto rounded-lg bg-muted/30 p-2">
              {info.paymentQrUrl ? (
                <ProtectedUploadImage
                  path={info.paymentQrUrl}
                  alt="Payment QR enlarged"
                  className="max-h-[min(68dvh,26rem)] max-w-full object-contain"
                />
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              disabled={copyingQr}
              onClick={() => void onCopyQr()}
            >
              {copied === "qr" ? <Check size={14} /> : <Copy size={14} />}
              Copy QR image
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
