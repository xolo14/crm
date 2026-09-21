import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { buildPublicDocFormUrl } from "@/lib/applyFormUrl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";

type ListedForm = {
  id: string;
  name: string;
  slug: string;
  form_type?: string;
  is_active?: number | boolean | string;
};

function isFormActive(f: ListedForm) {
  return f.is_active !== 0 && f.is_active !== false && f.is_active !== "0";
}

export default function AssignedDocFormLinksCard({ showEmpty = false }: { showEmpty?: boolean }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const referralCode = String(profile?.referral_code || "").trim();

  const { data, isLoading } = useQuery({
    queryKey: ["assigned-doc-form-links"],
    queryFn: () => api.docForms.list({ scope: "assigned" }),
  });

  const raw = Array.isArray(data) ? data : (data as { data?: ListedForm[] })?.data || [];
  const forms = (raw as ListedForm[]).filter(isFormActive);

  const personalFormUrl = (slug: string) => buildPublicDocFormUrl(window.location.origin, slug, referralCode);

  const copyFormLink = async (slug: string) => {
    if (!referralCode) {
      toast({
        variant: "destructive",
        title: "Staff ID missing",
        description: "Refresh the page to get your staff ID before sharing a form link.",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(personalFormUrl(slug));
      toast({ title: "Link copied", description: "This URL uses only your staff ID." });
    } catch {
      toast({ variant: "destructive", title: "Could not copy", description: "Copy the link from the preview." });
    }
  };

  const typeLabel = (t?: string) => (t === "certificate" ? "Certificate" : t === "offer_letter" ? "Offer letter" : "Document");

  if (isLoading) {
    if (!showEmpty) return null;
    return (
      <Card className="mb-4 border-border/50 shadow-none">
        <CardContent className="py-4 text-sm text-muted-foreground">Loading document form links…</CardContent>
      </Card>
    );
  }

  if (forms.length === 0) {
    if (!showEmpty) return null;
    return (
      <Card className="mb-4 border-border/50 shadow-none border-emerald-500/20 bg-emerald-500/[0.03]">
        <CardHeader className="px-3 sm:px-4 pb-2 pt-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-emerald-700" />
            Your certificate & offer-letter forms
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 sm:px-4 pb-4">
          <p className="text-sm text-muted-foreground py-2">
            No document forms assigned yet. When an admin assigns you in{" "}
            <span className="font-medium text-foreground">Form Management → Certificates & Offer Letters</span>, your personal link (your staff ID only) will show here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-4 border-border/50 shadow-none border-emerald-500/20 bg-emerald-500/[0.03]">
      <CardHeader className="px-3 sm:px-4 pb-2 pt-4">
        <CardTitle className="text-sm font-semibold flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-emerald-700" />
            Your certificate & offer-letter forms
          </span>
          <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
            <Link to="/my-doc-forms">Open</Link>
          </Button>
        </CardTitle>
        <p className="text-xs text-muted-foreground font-normal leading-snug mt-1">
          Document forms assigned to you. Each link includes only your staff ID.
        </p>
        {!referralCode ? (
          <p className="text-[11px] text-amber-700 bg-amber-500/10 border border-amber-200/60 rounded-md px-2 py-1.5 mt-2">
            Your profile has no staff ID yet — links may not attribute submissions. Ask your admin to set the org prefix.
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="px-3 sm:px-4 pb-4">
        {isMobile ? (
          <div className="space-y-2">
            {forms.map((f) => (
              <div key={f.id} className="rounded-lg border border-border/60 bg-background p-3 space-y-2">
                <p className="text-sm font-medium">{f.name}</p>
                <p className="text-[10px] text-muted-foreground">{typeLabel(f.form_type)}</p>
                <p className="text-[10px] text-muted-foreground font-mono break-all">{personalFormUrl(f.slug)}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-8 text-xs flex-1 gap-1" onClick={() => copyFormLink(f.slug)}>
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs flex-1 gap-1" asChild>
                    <a href={personalFormUrl(f.slug)} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3" /> Open
                    </a>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Form</TableHead>
                <TableHead className="w-[120px]">Type</TableHead>
                <TableHead className="min-w-[200px]">Your link</TableHead>
                <TableHead className="w-[140px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {forms.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium text-sm">{f.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{typeLabel(f.form_type)}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground break-all max-w-md">
                    {personalFormUrl(f.slug)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => copyFormLink(f.slug)}>
                        <Copy className="h-3 w-3" /> Copy
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" asChild>
                        <a href={personalFormUrl(f.slug)} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3 w-3" /> Open
                        </a>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
