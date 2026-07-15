import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, KeyRound, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { isL3AdminRole, isMarketingFamilyRole, normalizeAppRole } from "@/lib/roleUtils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

type LeadForm = {
  id: string;
  name: string;
  slug: string;
  is_active?: number | boolean;
  meta_json?: Record<string, unknown> | string | null;
};

function parseMeta(raw: LeadForm["meta_json"]): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim() !== "") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // ignore
    }
  }
  return {};
}

export default function FormApiIntegrationsPage() {
  const { toast } = useToast();
  const { role } = useAuth();
  const normalizedRole = normalizeAppRole(role);
  const canAccess =
    normalizedRole === "super_admin" ||
    normalizedRole === "admin" ||
    isL3AdminRole(normalizedRole) ||
    isMarketingFamilyRole(normalizedRole);
  const [forms, setForms] = useState<LeadForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyFormId, setBusyFormId] = useState<string>("");
  const [freshKeys, setFreshKeys] = useState<Record<string, string>>({});

  const origin = useMemo(() => window.location.origin, []);

  async function loadForms() {
    setLoading(true);
    try {
      const res = await api.forms.list();
      const rows = Array.isArray(res) ? res : (res?.data || []);
      setForms(rows);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Failed to load forms", description: error?.message || "Try again." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canAccess) return;
    void loadForms();
  }, [canAccess]);

  if (!canAccess) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Form API integrations</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You do not have access to manage form API keys.{" "}
          <Link to="/form-management" className="text-primary underline">
            Back to Form Management
          </Link>
        </CardContent>
      </Card>
    );
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied` });
    } catch {
      toast({ variant: "destructive", title: "Copy failed" });
    }
  }

  async function toggleEnabled(form: LeadForm, enabled: boolean) {
    setBusyFormId(form.id);
    try {
      const meta = parseMeta(form.meta_json);
      meta.external_api_enabled = enabled;
      await api.forms.update(form.id, { meta_json: meta });
      setForms((prev) => prev.map((f) => (f.id === form.id ? { ...f, meta_json: meta } : f)));
      toast({ title: enabled ? "API enabled for form" : "API disabled for form" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Update failed", description: error?.message || "Try again." });
    } finally {
      setBusyFormId("");
    }
  }

  async function generateKey(form: LeadForm) {
    setBusyFormId(form.id);
    try {
      const res = await api.forms.generateApiKey(form.id);
      const plain = String(res?.data?.api_key || "");
      if (!plain) {
        throw new Error("API key not returned");
      }
      const meta = parseMeta(form.meta_json);
      meta.external_api_enabled = true;
      setForms((prev) => prev.map((f) => (f.id === form.id ? { ...f, meta_json: meta } : f)));
      setFreshKeys((prev) => ({ ...prev, [form.id]: plain }));
      toast({ title: "New API key generated", description: "Copy it now. It won't be shown again." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Key generation failed", description: error?.message || "Try again." });
    } finally {
      setBusyFormId("");
    }
  }

  async function revokeKey(form: LeadForm) {
    setBusyFormId(form.id);
    try {
      await api.forms.revokeApiKey(form.id);
      const meta = parseMeta(form.meta_json);
      delete meta.external_api_key_hash;
      meta.external_api_enabled = false;
      setForms((prev) => prev.map((f) => (f.id === form.id ? { ...f, meta_json: meta } : f)));
      setFreshKeys((prev) => {
        const next = { ...prev };
        delete next[form.id];
        return next;
      });
      toast({ title: "API key revoked" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Revoke failed", description: error?.message || "Try again." });
    } finally {
      setBusyFormId("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Form API Integrations</h1>
          <p className="text-sm text-muted-foreground">
            Use per-form API keys for external Apply/Enroll buttons.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadForms()} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">External Form Access</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading forms…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Form</TableHead>
                  <TableHead>API Access</TableHead>
                  <TableHead>Integration URL</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {forms.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">
                      No forms available.
                    </TableCell>
                  </TableRow>
                ) : (
                  forms.map((form) => {
                    const meta = parseMeta(form.meta_json);
                    const enabled = Boolean(meta.external_api_enabled);
                    const hasKey = String(meta.external_api_key_hash || "").trim() !== "";
                    const plainKey = freshKeys[form.id] || "";
                    const integrationUrl = `${origin}/apply?form=${encodeURIComponent(form.slug)}${plainKey ? `&api_key=${encodeURIComponent(plainKey)}` : ""}`;
                    return (
                      <TableRow key={form.id}>
                        <TableCell>
                          <div className="font-medium">{form.name}</div>
                          <code className="text-xs text-muted-foreground">{form.slug}</code>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={enabled}
                              disabled={busyFormId === form.id}
                              onCheckedChange={(v) => void toggleEnabled(form, v)}
                            />
                            <Badge variant={enabled ? "default" : "secondary"}>
                              {enabled ? "Enabled" : "Disabled"}
                            </Badge>
                            {hasKey ? <Badge variant="outline">Key exists</Badge> : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-2">
                            <div className="text-xs text-muted-foreground break-all">{integrationUrl}</div>
                            {plainKey ? (
                              <div className="text-xs">
                                <span className="font-medium">API key:</span>{" "}
                                <code className="rounded bg-muted px-1 py-0.5">{plainKey}</code>
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground">
                                Generate key to get full URL with <code>api_key</code>.
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyFormId === form.id}
                              onClick={() => void generateKey(form)}
                            >
                              <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                              {hasKey ? "Rotate Key" : "Generate Key"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!plainKey}
                              onClick={() => void copy(integrationUrl, "Integration URL")}
                            >
                              <Copy className="mr-1.5 h-3.5 w-3.5" />
                              Copy URL
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busyFormId === form.id || (!hasKey && !enabled)}
                              onClick={() => void revokeKey(form)}
                            >
                              Revoke
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

