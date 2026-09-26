import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Copy, KeyRound, Loader2, Lock, Plus, Sparkles, Tag, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { phpList } from "@/lib/phpList";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { canDelete } from "@/lib/permissions";
import { normalizeAppRole } from "@/lib/roleUtils";

type Coupon = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  discount: number | string;
  min_amount: number | string;
  code: string;
  lead_id?: string | null;
  org_id?: string | null;
  org_name?: string | null;
  expires_at?: string | null;
  used_at?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at?: string;
};

type LeadOption = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
};

type MailboxOption = {
  id: string;
  email: string;
  label?: string;
  from_name?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function inr(value: number | string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
}

function fmtDateOnly(raw?: string | null): string {
  if (!raw) return "—";
  const day = String(raw).slice(0, 10);
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-IN", { dateStyle: "medium" });
}

function couponUsed(raw?: string | null): boolean {
  return Boolean(raw && String(raw).trim());
}

function couponExpired(raw?: string | null): boolean {
  if (!raw) return false;
  const day = String(raw).slice(0, 10);
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return day < ymd;
}

function fmtWhen(raw?: string): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

const COUPON_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateCouponCode(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += COUPON_CODE_ALPHABET[bytes[i] % COUPON_CODE_ALPHABET.length];
  }
  return out;
}

function mapOrgOptions(res: unknown): Array<{ id: string; name: string }> {
  return phpList<{ id?: string; name?: string; is_active?: unknown }>(res)
    .map((o) => {
      const inactive = o.is_active === 0 || o.is_active === "0" || o.is_active === false;
      const base = String(o.name ?? "").trim() || "Untitled org";
      return {
        id: String(o.id ?? "").trim(),
        name: inactive ? `${base} (inactive)` : base,
      };
    })
    .filter((o) => o.id !== "")
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function CouponsPage() {
  const { toast } = useToast();
  const { user, role, organization } = useAuth();
  const userId = String(user?.id ?? "");
  const normalizedRole = normalizeAppRole(role);
  const isSuperAdmin = normalizedRole === "super_admin";
  const canManageApiKey = isSuperAdmin || normalizedRole === "org";
  const canEditMinAmount = isSuperAdmin || normalizedRole === "org";
  const [rows, setRows] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [smtpAccountId, setSmtpAccountId] = useState("");
  const [mailboxes, setMailboxes] = useState<MailboxOption[]>([]);
  const [mailboxesLoading, setMailboxesLoading] = useState(false);
  const [discount, setDiscount] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [leadId, setLeadId] = useState("");
  const [createOrgId, setCreateOrgId] = useState("");
  const [createOrgs, setCreateOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const [createOrgsLoading, setCreateOrgsLoading] = useState(false);
  const [minAmountLoading, setMinAmountLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [leadPickerOpen, setLeadPickerOpen] = useState(false);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const leadPickerRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<number | null>(null);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [apiKeyError, setApiKeyError] = useState("");
  const [apiKeyOrgId, setApiKeyOrgId] = useState("");
  const [apiKeyOrgs, setApiKeyOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const [apiKeyOrgsLoading, setApiKeyOrgsLoading] = useState(false);
  const apiKeyLoadSeq = useRef(0);
  const loadedMinRef = useRef("0");
  const publicCouponsUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/public-coupons.php` : "/api/public-coupons.php";

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.coupons.list();
      setRows(phpList<Coupon>(res));
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Failed to load coupons",
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Reload when Super Admin switches organization (JWT org scope changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization?.id]);

  function resetForm() {
    setName("");
    setEmail("");
    setPhone("");
    setSendEmail(false);
    setSmtpAccountId("");
    setDiscount("");
    setMinAmount("");
    setCode("");
    setExpiresAt("");
    setLeadId("");
    setCreateOrgId("");
    setErrors({});
    setLeads([]);
    setLeadPickerOpen(false);
  }

  async function loadMinAmount(orgId?: string) {
    const targetOrg = isSuperAdmin ? String(orgId ?? "").trim() : "";
    if (isSuperAdmin && targetOrg === "") {
      setMinAmount("");
      setMinAmountLoading(false);
      return;
    }
    setMinAmountLoading(true);
    try {
      const res = (await api.coupons.getMinAmount(isSuperAdmin ? targetOrg : undefined)) as {
        min_amount?: number | string;
      };
      const n = Number(res?.min_amount ?? 0);
      const next = Number.isFinite(n) ? String(n) : "0";
      loadedMinRef.current = next;
      setMinAmount(next);
    } catch {
      setMinAmount("0");
    } finally {
      setMinAmountLoading(false);
    }
  }

  async function loadMailboxes(orgId?: string) {
    const targetOrg = isSuperAdmin ? String(orgId ?? "").trim() : "";
    if (isSuperAdmin && targetOrg === "") {
      setMailboxes([]);
      setSmtpAccountId("");
      setMailboxesLoading(false);
      return;
    }
    setMailboxesLoading(true);
    try {
      const res = await api.coupons.listMailboxes(isSuperAdmin ? targetOrg : undefined);
      const list = phpList<MailboxOption>(res)
        .map((m) => ({
          id: String(m.id ?? "").trim(),
          email: String(m.email ?? "").trim(),
          label: String(m.label ?? "").trim(),
          from_name: String(m.from_name ?? "").trim(),
        }))
        .filter((m) => m.id !== "" && m.email !== "");
      setMailboxes(list);
      setSmtpAccountId((prev) => {
        if (list.some((m) => m.id === prev)) return prev;
        return list.length === 1 ? list[0].id : "";
      });
    } catch {
      setMailboxes([]);
      setSmtpAccountId("");
    } finally {
      setMailboxesLoading(false);
    }
  }

  async function persistMinAmount(orgId?: string) {
    if (!canEditMinAmount || !open) return;
    if (minAmount.trim() === "") return;
    const targetOrg = isSuperAdmin ? String(orgId ?? createOrgId).trim() : "";
    if (isSuperAdmin && targetOrg === "") return;
    const n = Number(minAmount);
    if (!Number.isFinite(n) || n < 0) return;
    if (n === Number(loadedMinRef.current)) return;
    try {
      await api.coupons.setMinAmount(n, isSuperAdmin ? targetOrg : undefined);
      loadedMinRef.current = String(n);
      void load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not save min amount",
        description: err instanceof Error ? err.message : "Try again.",
      });
    }
  }

  async function openAddDialog() {
    resetForm();
    setOpen(true);
    setCode(generateCouponCode());
    let orgId = isSuperAdmin ? String(organization?.id ?? "").trim() : "";
    if (isSuperAdmin) {
      setCreateOrgsLoading(true);
      try {
        const list = mapOrgOptions(await api.organizations.list());
        setCreateOrgs(list);
        if (orgId && !list.some((o) => o.id === orgId)) orgId = "";
        setCreateOrgId(orgId);
      } catch (err) {
        setCreateOrgs([]);
        setCreateOrgId("");
        toast({
          variant: "destructive",
          title: "Could not load organizations",
          description: err instanceof Error ? err.message : "Try again.",
        });
      } finally {
        setCreateOrgsLoading(false);
      }
    }
    if (!isSuperAdmin || orgId) {
      await loadMinAmount(orgId || undefined);
      await loadMailboxes(orgId || undefined);
    }
  }

  async function onCreateOrgChange(orgId: string) {
    setCreateOrgId(orgId);
    setLeadId("");
    setLeads([]);
    setErrors((er) => ({ ...er, org_id: "" }));
    setSmtpAccountId("");
    await loadMinAmount(orgId);
    await loadMailboxes(orgId);
  }

  function searchLeads(q: string) {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const query = q.trim();
    if (query.length < 1) {
      setLeads([]);
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      void (async () => {
        setLeadsLoading(true);
        try {
          const res = await api.leads.list({
            search: query,
            limit: 40,
            all: false,
            lite: true,
            org_id: isSuperAdmin ? createOrgId || undefined : undefined,
          });
          const list = phpList<LeadOption>(res).map((l) => ({
            id: String(l.id),
            name: (l as { name?: string }).name || "Unnamed lead",
            email: (l as { email?: string }).email || "",
            phone: (l as { phone?: string }).phone || "",
          }));
          setLeads(list);
        } catch {
          setLeads([]);
        } finally {
          setLeadsLoading(false);
        }
      })();
    }, 250);
  }

  useEffect(() => {
    if (!leadPickerOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (leadPickerRef.current && !leadPickerRef.current.contains(e.target as Node)) {
        setLeadPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [leadPickerOpen]);

  const selectedLead = useMemo(
    () => (leadId ? leads.find((l) => l.id === leadId) : undefined),
    [leads, leadId],
  );

  function patchName(value: string) {
    const keep = selectedLead && value.trim().toLowerCase() === selectedLead.name.trim().toLowerCase();
    setName(value);
    if (!keep) setLeadId("");
    setErrors((e) => ({ ...e, name: "" }));
    setLeadPickerOpen(true);
    searchLeads(value);
  }

  function selectLead(lead: LeadOption) {
    setLeadId(lead.id);
    setName(lead.name);
    if (lead.email?.trim()) setEmail(lead.email.trim());
    if (lead.phone?.trim()) setPhone(lead.phone.trim());
    setLeadPickerOpen(false);
    setErrors((e) => ({
      ...e,
      name: "",
      email: lead.email?.trim() ? "" : e.email,
      phone: lead.phone?.trim() ? "" : e.phone,
    }));
  }

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Name is required";
    if (!email.trim()) e.email = "Email is required";
    else if (!EMAIL_RE.test(email.trim())) e.email = "Enter a valid email";
    const phoneDigits = phone.replace(/\D+/g, "");
    if (!phone.trim()) e.phone = "Phone number is required";
    else if (phoneDigits.length < 10) e.phone = "Enter a valid phone number";
    const disc = Number(discount);
    if (discount.trim() === "" || !Number.isFinite(disc) || disc <= 0) e.discount = "Discount is required";
    if (!isSuperAdmin || createOrgId.trim()) {
      const min = Number(minAmount);
      if (minAmount.trim() === "" || !Number.isFinite(min) || min < 0) e.min_amount = "Min amount is required";
    }
    const c = code.trim().replace(/[^A-Za-z0-9_-]/g, "");
    if (!c) e.code = "Coupon code is required";
    else if (c.length < 3) e.code = "Use at least 3 characters";
    if (sendEmail && !smtpAccountId.trim()) e.smtp_account_id = "Select an Email Setup mailbox";
    if (isSuperAdmin && !createOrgId.trim()) e.org_id = "Select an organization";
    if (!expiresAt.trim()) e.expires_at = "Expiry date is required";
    else {
      const day = expiresAt.trim().slice(0, 10);
      const today = new Date();
      const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) e.expires_at = "Pick a valid date";
      else if (day < ymd) e.expires_at = "Expiry must be today or later";
    }
    return e;
  }

  async function onCreate() {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const res = (await api.coupons.create(
        {
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          discount: Number(discount),
          min_amount: Number(minAmount),
          code: code.trim().toUpperCase(),
          lead_id: leadId || undefined,
          expires_at: expiresAt.trim().slice(0, 10),
          send_email: sendEmail,
          smtp_account_id: sendEmail ? smtpAccountId.trim() || undefined : undefined,
        },
        isSuperAdmin ? createOrgId.trim() || undefined : undefined,
      )) as { email_sent?: boolean; email_error?: string | null; message?: string };
      toast({
        title: res?.email_sent ? "Coupon created and emailed" : "Coupon created",
        description: sendEmail && !res?.email_sent ? String(res?.email_error || "Email was not sent.") : undefined,
      });
      setOpen(false);
      resetForm();
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not create coupon",
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function loadApiKey(orgId?: string) {
    const seq = ++apiKeyLoadSeq.current;
    const targetOrg = isSuperAdmin ? String(orgId ?? "").trim() : "";
    if (isSuperAdmin && targetOrg === "") {
      setApiKeyValue("");
      setApiKeyError("");
      setApiKeyLoading(false);
      return;
    }
    setApiKeyLoading(true);
    setApiKeyError("");
    try {
      const res = (await api.coupons.getApiKey(isSuperAdmin ? targetOrg : undefined)) as {
        api_key?: string;
      };
      if (seq !== apiKeyLoadSeq.current) return;
      setApiKeyValue(String(res?.api_key ?? ""));
    } catch (err) {
      if (seq !== apiKeyLoadSeq.current) return;
      setApiKeyValue("");
      setApiKeyError(err instanceof Error ? err.message : "Could not load API key.");
    } finally {
      if (seq === apiKeyLoadSeq.current) setApiKeyLoading(false);
    }
  }

  async function openApiKeyDialog() {
    setApiKeyOpen(true);
    setApiKeyValue("");
    setApiKeyError("");
    if (!isSuperAdmin) {
      setApiKeyOrgId("");
      await loadApiKey();
      return;
    }

    setApiKeyOrgsLoading(true);
    try {
      const res = await api.organizations.list();
      const list = mapOrgOptions(res);
      setApiKeyOrgs(list);
      const preferred = String(organization?.id ?? "").trim();
      const nextOrg = list.some((o) => o.id === preferred) ? preferred : "";
      setApiKeyOrgId(nextOrg);
      if (nextOrg) {
        await loadApiKey(nextOrg);
      }
    } catch (err) {
      setApiKeyOrgs([]);
      setApiKeyOrgId("");
      setApiKeyError(err instanceof Error ? err.message : "Could not load organizations.");
    } finally {
      setApiKeyOrgsLoading(false);
    }
  }

  async function onApiKeyOrgChange(orgId: string) {
    setApiKeyOrgId(orgId);
    setApiKeyValue("");
    await loadApiKey(orgId);
  }

  async function generateApiKey() {
    if (isSuperAdmin && !apiKeyOrgId) {
      setApiKeyError("Select an organization");
      return;
    }
    if (apiKeyValue && !window.confirm("Generate a new key? Sites using the current key will stop working.")) {
      return;
    }
    setApiKeySaving(true);
    setApiKeyError("");
    try {
      const res = (await api.coupons.generateApiKey(isSuperAdmin ? apiKeyOrgId : undefined)) as {
        api_key?: string;
      };
      const next = String(res?.api_key ?? "");
      setApiKeyValue(next);
      toast({ title: next ? "API key generated" : "Key generated" });
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : "Could not generate API key.");
      toast({
        variant: "destructive",
        title: "Could not generate API key",
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setApiKeySaving(false);
    }
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ variant: "destructive", title: `Could not copy ${label.toLowerCase()}` });
    }
  }

  async function onDelete(row: Coupon) {
    if (!window.confirm(`Delete coupon ${row.code}?`)) return;
    try {
      await api.coupons.delete(row.id);
      toast({ title: "Coupon deleted" });
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not delete",
        description: err instanceof Error ? err.message : "Try again.",
      });
    }
  }

  const canRemove = (row: Coupon) =>
    canDelete(role) ||
    normalizedRole === "operational_manager" ||
    (userId !== "" && String(row.created_by ?? "") === userId);

  const showOrgColumn = isSuperAdmin && !organization?.id;

  const visibilityHint = isSuperAdmin
    ? organization?.id
      ? "Showing coupons for the selected organization."
      : "Showing coupons across all organizations. Switch org in the header to filter."
    : normalizedRole === "org" || normalizedRole === "operational_manager"
      ? "Showing every coupon in this organization."
      : normalizedRole === "manager"
        ? "You see coupons you created plus your downline."
        : "You see coupons you created.";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" />
            Coupons
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Create person-specific discount codes. Each code works once before it expires. {visibilityHint}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManageApiKey ? (
            <Button type="button" variant="outline" onClick={() => void openApiKeyDialog()}>
              <KeyRound className="mr-1.5 h-4 w-4" />
              API key
            </Button>
          ) : null}
          <Button type="button" onClick={() => void openAddDialog()}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add coupon
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading coupons…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">No coupons yet.</div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {showOrgColumn ? <TableHead>Organization</TableHead> : null}
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Min amount</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Created by</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    {showOrgColumn ? (
                      <TableCell className="text-muted-foreground">{row.org_name || "—"}</TableCell>
                    ) : null}
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.email}</TableCell>
                    <TableCell>{row.phone || "—"}</TableCell>
                    <TableCell>{inr(row.discount)}</TableCell>
                    <TableCell>{inr(row.min_amount)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-xs">{row.code}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => void copyText(row.code, "Code")}
                          aria-label={`Copy code ${row.code}`}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {couponUsed(row.used_at) ? (
                        <span className="text-muted-foreground">Used {fmtWhen(String(row.used_at))}</span>
                      ) : couponExpired(row.expires_at) ? (
                        <span className="text-destructive">Expired</span>
                      ) : (
                        <span>Unused</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {couponExpired(row.expires_at) ? (
                        <span className="text-destructive">Expired {fmtDateOnly(row.expires_at)}</span>
                      ) : (
                        fmtDateOnly(row.expires_at)
                      )}
                    </TableCell>
                    <TableCell>{row.created_by_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{fmtWhen(row.created_at)}</TableCell>
                    <TableCell>
                      {canRemove(row) ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => void onDelete(row)}
                          aria-label="Delete coupon"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add coupon</DialogTitle>
            <DialogDescription>
              Coupon code is generated automatically. Each coupon can be used once before the expiry date.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {isSuperAdmin ? (
              <div>
                <Label>
                  Organization <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={createOrgId || undefined}
                  onValueChange={(v) => void onCreateOrgChange(v)}
                  disabled={createOrgsLoading || saving}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder={createOrgsLoading ? "Loading organizations…" : "Select organization"} />
                  </SelectTrigger>
                  <SelectContent className="z-[210]">
                    {createOrgs.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.org_id ? <p className="mt-1 text-xs text-destructive">{errors.org_id}</p> : null}
              </div>
            ) : null}
            <div ref={leadPickerRef} className="relative">
              <Label htmlFor="coupon-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <div className="relative mt-1.5">
                <Input
                  id="coupon-name"
                  value={name}
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={leadPickerOpen}
                  placeholder="Search leads or type a name"
                  onChange={(e) => patchName(e.target.value)}
                  onFocus={() => {
                    if (name.trim()) {
                      setLeadPickerOpen(true);
                      searchLeads(name);
                    }
                  }}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground"
                  onClick={() => setLeadPickerOpen((o) => !o)}
                  aria-label="Show matching leads"
                >
                  <ChevronDown className={`h-4 w-4 ${leadPickerOpen ? "rotate-180" : ""}`} />
                </button>
              </div>
              {leadPickerOpen && (
                <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover py-1 shadow-md">
                  {leadsLoading ? (
                    <li className="px-3 py-2 text-xs text-muted-foreground">Searching leads…</li>
                  ) : leads.length === 0 ? (
                    <li className="px-3 py-2 text-xs text-muted-foreground">
                      No leads match — name will be used as entered
                    </li>
                  ) : (
                    leads.map((lead) => (
                      <li key={lead.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => selectLead(lead)}
                        >
                          <span className="block font-medium">{lead.name}</span>
                          {lead.email ? (
                            <span className="block text-xs text-muted-foreground">{lead.email}</span>
                          ) : null}
                          {lead.phone ? (
                            <span className="block text-xs text-muted-foreground">{lead.phone}</span>
                          ) : null}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
              {errors.name ? <p className="mt-1 text-xs text-destructive">{errors.name}</p> : null}
            </div>

            <div>
              <div className="flex items-end gap-3">
                <div className="min-w-0 flex-1">
                  <Label htmlFor="coupon-email">
                    Email <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="coupon-email"
                    className="mt-1.5"
                    type="email"
                    value={email}
                    placeholder="person@email.com"
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setErrors((er) => ({ ...er, email: "" }));
                    }}
                  />
                </div>
                <div className="flex h-10 shrink-0 items-center gap-2 pb-px">
                  <Switch
                    id="coupon-send-email"
                    checked={sendEmail}
                    onCheckedChange={(checked) => {
                      setSendEmail(checked);
                      setErrors((er) => ({ ...er, smtp_account_id: "" }));
                    }}
                  />
                  <Label htmlFor="coupon-send-email" className="text-xs font-medium leading-tight">
                    Send email
                  </Label>
                </div>
              </div>
              {errors.email ? <p className="mt-1 text-xs text-destructive">{errors.email}</p> : null}
            </div>

            {sendEmail ? (
              <div>
                <Label>
                  Send from (Email Setup) <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={smtpAccountId || undefined}
                  onValueChange={(v) => {
                    setSmtpAccountId(v);
                    setErrors((er) => ({ ...er, smtp_account_id: "" }));
                  }}
                  disabled={mailboxesLoading || saving || (isSuperAdmin && !createOrgId)}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue
                      placeholder={
                        mailboxesLoading
                          ? "Loading mailboxes…"
                          : mailboxes.length
                            ? "Choose organization mailbox"
                            : "No org emails yet — add them in Email Setup"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="z-[210]">
                    {mailboxes.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {(m.label || m.from_name || "Mailbox") + " — " + m.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.smtp_account_id ? <p className="mt-1 text-xs text-destructive">{errors.smtp_account_id}</p> : null}
              </div>
            ) : null}

            <div>
              <Label htmlFor="coupon-phone">
                Phone <span className="text-destructive">*</span>
              </Label>
              <Input
                id="coupon-phone"
                className="mt-1.5"
                type="tel"
                value={phone}
                placeholder="9876543210"
                onChange={(e) => {
                  setPhone(e.target.value);
                  setErrors((er) => ({ ...er, phone: "" }));
                }}
              />
              {errors.phone ? <p className="mt-1 text-xs text-destructive">{errors.phone}</p> : null}
            </div>

            <div>
              <Label htmlFor="coupon-discount">
                Discount (₹) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="coupon-discount"
                className="mt-1.5"
                type="number"
                min={0.01}
                step={0.01}
                value={discount}
                placeholder="0"
                onChange={(e) => {
                  setDiscount(e.target.value);
                  setErrors((er) => ({ ...er, discount: "" }));
                }}
              />
              {errors.discount ? <p className="mt-1 text-xs text-destructive">{errors.discount}</p> : null}
            </div>

            <div>
              <Label htmlFor="coupon-min">
                Min amount for discount (₹) <span className="text-destructive">*</span>
              </Label>
              <div className="relative mt-1.5">
                <Input
                  id="coupon-min"
                  className={!canEditMinAmount ? "pr-9 bg-muted" : ""}
                  type="number"
                  min={0}
                  step={0.01}
                  value={minAmount}
                  placeholder={minAmountLoading ? "Loading…" : "0"}
                  readOnly={!canEditMinAmount}
                  disabled={!canEditMinAmount || minAmountLoading || (isSuperAdmin && !createOrgId)}
                  onChange={(e) => {
                    if (!canEditMinAmount) return;
                    setMinAmount(e.target.value);
                    setErrors((er) => ({ ...er, min_amount: "" }));
                  }}
                  onBlur={() => void persistMinAmount()}
                />
                {!canEditMinAmount ? (
                  <Lock className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {canEditMinAmount
                  ? "This amount applies to every coupon in the organization."
                  : "Locked for this organization. Only Super Admin or Admin can change it."}
              </p>
              {errors.min_amount ? <p className="mt-1 text-xs text-destructive">{errors.min_amount}</p> : null}
            </div>

            <div>
              <Label htmlFor="coupon-code">Coupon code</Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  id="coupon-code"
                  className="uppercase bg-muted font-mono"
                  value={code}
                  readOnly
                  placeholder="Generating…"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setCode(generateCouponCode())}
                  aria-label="Generate a new code"
                >
                  <Sparkles className="mr-1.5 h-4 w-4" />
                  New code
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Generated automatically. Typing a code is not allowed.</p>
            </div>

            <div>
              <Label htmlFor="coupon-expires">
                Expiry date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="coupon-expires"
                className="mt-1.5"
                type="date"
                value={expiresAt}
                min={(() => {
                  const t = new Date();
                  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
                })()}
                onChange={(e) => {
                  setExpiresAt(e.target.value);
                  setErrors((er) => ({ ...er, expires_at: "" }));
                }}
              />
              {errors.expires_at ? <p className="mt-1 text-xs text-destructive">{errors.expires_at}</p> : null}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void onCreate()} disabled={saving || minAmountLoading}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={apiKeyOpen}
        onOpenChange={(next) => {
          setApiKeyOpen(next);
          if (!next) {
            setApiKeyError("");
            setApiKeyValue("");
            setApiKeyOrgId("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Coupon API key</DialogTitle>
            <DialogDescription>
              {isSuperAdmin
                ? "Select an organization to view or generate its coupon API key. Other websites use that key to list the org’s coupons."
                : "Other websites can list every coupon in this organization with this key."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {isSuperAdmin ? (
              <div>
                <Label>Organization</Label>
                <Select
                  value={apiKeyOrgId || undefined}
                  onValueChange={(v) => void onApiKeyOrgChange(v)}
                  disabled={apiKeyOrgsLoading || apiKeySaving}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder={apiKeyOrgsLoading ? "Loading organizations…" : "Select organization"} />
                  </SelectTrigger>
                  <SelectContent className="z-[210]">
                    {apiKeyOrgs.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {apiKeyError ? <p className="text-sm text-destructive">{apiKeyError}</p> : null}
            {isSuperAdmin && apiKeyOrgsLoading && !apiKeyOrgId ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading organizations…
              </div>
            ) : isSuperAdmin && !apiKeyOrgId ? (
              <p className="text-sm text-muted-foreground">Choose an organization to see its key.</p>
            ) : apiKeyLoading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading key…
              </div>
            ) : (
              <>
                <div>
                  <Label htmlFor="coupon-api-key">Existing key</Label>
                  <div className="mt-1.5 flex gap-2">
                    <Input
                      id="coupon-api-key"
                      readOnly
                      className="font-mono text-xs"
                      value={apiKeyValue}
                      placeholder="No key yet — generate one"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={!apiKeyValue}
                      onClick={() => void copyText(apiKeyValue, "API key")}
                      aria-label="Copy API key"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <Label>Public endpoint</Label>
                  <div className="mt-1.5 flex gap-2">
                    <Input readOnly className="font-mono text-xs" value={publicCouponsUrl} />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => void copyText(publicCouponsUrl, "Endpoint")}
                      aria-label="Copy endpoint"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Send <code className="rounded bg-muted px-1 py-0.5">X-Coupon-Api-Key</code> (or{" "}
                    <code className="rounded bg-muted px-1 py-0.5">Authorization: Bearer</code>) on GET. Optional{" "}
                    <code className="rounded bg-muted px-1 py-0.5">?code=SAVE500</code> looks up one code. After applying
                    the discount, POST the same URL with <code className="rounded bg-muted px-1 py-0.5">{`{"code":"SAVE500"}`}</code>{" "}
                    to mark it used. Codes are single-use.
                  </p>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setApiKeyOpen(false)} disabled={apiKeySaving}>
              Close
            </Button>
            <Button
              type="button"
              onClick={() => void generateApiKey()}
              disabled={apiKeyLoading || apiKeySaving || apiKeyOrgsLoading || (isSuperAdmin && !apiKeyOrgId)}
            >
              {apiKeySaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <KeyRound className="mr-1.5 h-4 w-4" />}
              {apiKeyValue ? "Generate new key" : "Generate key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
