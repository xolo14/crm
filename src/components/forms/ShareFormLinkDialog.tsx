import { useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Check, Copy, Download, Mail, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { buildPrefilledUrl } from "@/components/forms/formPrefill";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  title: string;
  /** Short intro used for WhatsApp / email share text. */
  message?: string;
  /** Extra hint under the link (e.g. "includes your staff ID"). */
  hint?: string;
  /** Questions that can be pre-filled via the link (Google Forms "Get pre-filled link"). */
  prefillFields?: Array<{ key: string; label: string }>;
};

/** Google Forms "Send" dialog: link + QR code + embed snippet + WhatsApp / email share + pre-filled link. */
export function ShareFormLinkDialog({ open, onOpenChange, url, title, message, hint, prefillFields = [] }: Props) {
  const { toast } = useToast();
  const qrWrap = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<"link" | "embed" | "prefill" | null>(null);
  const [embedW, setEmbedW] = useState("640");
  const [embedH, setEmbedH] = useState("900");
  const [prefill, setPrefill] = useState<Record<string, string>>({});
  const prefillUrl = useMemo(() => buildPrefilledUrl(url, prefill), [url, prefill]);
  const hasPrefill = prefillFields.length > 0;

  const embedCode = useMemo(
    () =>
      `<iframe src="${url}" width="${Number(embedW) || 640}" height="${Number(embedH) || 900}" frameborder="0" marginheight="0" marginwidth="0" style="max-width:100%;border:0" title="${title.replace(/"/g, "&quot;")}">Loading…</iframe>`,
    [url, embedW, embedH, title],
  );

  const shareText = `${message || title}\n${url}`;
  const waHref = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  const mailHref = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(shareText)}`;

  const copy = async (text: string, which: "link" | "embed" | "prefill") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1500);
      toast({ title: which === "embed" ? "Embed code copied" : which === "prefill" ? "Pre-filled link copied" : "Link copied" });
    } catch {
      toast({ variant: "destructive", title: "Copy failed", description: "Select the text and copy manually." });
    }
  };

  const downloadQr = () => {
    const canvas = qrWrap.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "form"}-qr.png`;
    a.click();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share “{title}”</DialogTitle>
          <DialogDescription>Send the link, print a QR code, or embed the form on a website.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="link">
          <TabsList className={`grid w-full ${hasPrefill ? "grid-cols-4" : "grid-cols-3"}`}>
            <TabsTrigger value="link">Link</TabsTrigger>
            <TabsTrigger value="qr">QR code</TabsTrigger>
            <TabsTrigger value="embed">Embed</TabsTrigger>
            {hasPrefill ? <TabsTrigger value="prefill">Pre-fill</TabsTrigger> : null}
          </TabsList>

          <TabsContent value="link" className="space-y-3 pt-3">
            <div className="flex gap-2">
              <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="outline" onClick={() => void copy(url, "link")}>
                {copied === "link" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <a href={waHref} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </a>
              </Button>
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <a href={mailHref}>
                  <Mail className="h-4 w-4" /> Email
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={url} target="_blank" rel="noopener noreferrer">
                  Open form
                </a>
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="qr" className="pt-3">
            <div className="flex flex-col items-center gap-3">
              <div ref={qrWrap} className="rounded-lg border bg-white p-3">
                <QRCodeCanvas value={url} size={220} level="M" includeMargin={false} />
              </div>
              <p className="text-xs text-muted-foreground text-center break-all">{url}</p>
              <Button type="button" variant="outline" size="sm" onClick={downloadQr} className="gap-1.5">
                <Download className="h-4 w-4" /> Download PNG
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="embed" className="space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Width (px)</Label>
                <Input className="mt-1 h-8 text-xs" value={embedW} onChange={(e) => setEmbedW(e.target.value.replace(/\D/g, ""))} />
              </div>
              <div>
                <Label className="text-xs">Height (px)</Label>
                <Input className="mt-1 h-8 text-xs" value={embedH} onChange={(e) => setEmbedH(e.target.value.replace(/\D/g, ""))} />
              </div>
            </div>
            <Textarea readOnly value={embedCode} rows={4} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" variant="outline" size="sm" onClick={() => void copy(embedCode, "embed")} className="gap-1.5">
              {copied === "embed" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy embed code
            </Button>
          </TabsContent>

          {hasPrefill ? (
            <TabsContent value="prefill" className="space-y-3 pt-3">
              <p className="text-xs text-muted-foreground">
                Fill any answers you want pre-populated; the link opens the form with those values already entered.
              </p>
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {prefillFields.map((f) => (
                  <div key={f.key}>
                    <Label className="text-xs">{f.label}</Label>
                    <Input
                      className="mt-1 h-8 text-xs"
                      value={prefill[f.key] || ""}
                      onChange={(e) => setPrefill((p) => ({ ...p, [f.key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input readOnly value={prefillUrl} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                <Button type="button" variant="outline" onClick={() => void copy(prefillUrl, "prefill")}>
                  {copied === "prefill" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </TabsContent>
          ) : null}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
