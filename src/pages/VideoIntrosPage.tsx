import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Copy, Loader2, Mail, Plus, Search, Trash2, Video } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { api, type VideoIntroInvitation } from "@/lib/api";
import { phpList } from "@/lib/phpList";
import { normalizeAppRole } from "@/lib/roleUtils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { VIDEO_INTRO_STATUSES } from "@/lib/videoIntroState";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function defaultExpiryLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setSeconds(0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtWhen(raw?: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 16);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    created: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100",
    opened: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-100",
    recording: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100",
    submitted: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100",
    expired: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
    revoked: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-100",
  };
  return (
    <Badge className={`capitalize border-0 ${map[status] || ""}`} variant="secondary">
      {status}
    </Badge>
  );
}

export default function VideoIntrosPage() {
  const { user, organization } = useAuth();
  const role = normalizeAppRole(user?.role);
  const isSa = role === "super_admin";
  const canDeleteInvite = isSa || role === "org" || role === "admin";
  const { toast } = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [orgId, setOrgId] = useState(isSa ? "all" : "");
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkInvite, setLinkInvite] = useState<VideoIntroInvitation | null>(null);
  const [smtpAccountId, setSmtpAccountId] = useState("");
  const [mailboxes, setMailboxes] = useState<Array<{ id: string; email: string; label?: string; from_name?: string }>>([]);
  const [mailboxesLoading, setMailboxesLoading] = useState(false);
  const [sendingMail, setSendingMail] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VideoIntroInvitation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({
    candidate_name: "",
    email: "",
    phone: "",
    position: "",
    expires_at: defaultExpiryLocal(),
    max_duration_sec: 90,
    max_retries: 3,
    org_id: organization?.id || "",
  });

  const { data: orgsRes } = useQuery({
    queryKey: ["organizations"],
    queryFn: () => api.organizations.list(),
    enabled: isSa,
  });
  const orgs = useMemo(() => {
    return phpList<{ id: string; name: string }>(orgsRes).map((o) => ({
      id: String(o.id || ""),
      name: String(o.name || "Organisation"),
    })).filter((o) => o.id);
  }, [orgsRes]);

  const listOrg = isSa && orgId && orgId !== "all" ? orgId : undefined;
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["video-intros", q, status, listOrg || "all"],
    queryFn: () => api.videoIntros.list({ q, status, org_id: listOrg }),
  });
  const rows = data?.data ?? [];
  const counts = data?.counts ?? {};

  useEffect(() => {
    if (!isSa && organization?.id) {
      setForm((f) => ({ ...f, org_id: organization.id || "" }));
    }
  }, [isSa, organization?.id]);

  useEffect(() => {
    if (!linkInvite) {
      setMailboxes([]);
      setSmtpAccountId("");
      return;
    }
    const orgForMail = String(linkInvite.org_id || (isSa ? form.org_id : organization?.id) || "").trim();
    if (isSa && !orgForMail) {
      setMailboxes([]);
      setSmtpAccountId("");
      return;
    }
    let cancelled = false;
    setMailboxesLoading(true);
    void api.videoIntros
      .listMailboxes(isSa ? orgForMail : undefined)
      .then((res) => {
        if (cancelled) return;
        const list = phpList<{ id: string; email: string; label?: string; from_name?: string }>(res)
          .map((m) => ({
            id: String(m.id ?? "").trim(),
            email: String(m.email ?? "").trim(),
            label: String(m.label ?? "").trim(),
            from_name: String(m.from_name ?? "").trim(),
          }))
          .filter((m) => m.id !== "" && m.email !== "");
        setMailboxes(list);
        setSmtpAccountId(list.length === 1 ? list[0].id : "");
      })
      .catch(() => {
        if (cancelled) return;
        setMailboxes([]);
        setSmtpAccountId("");
      })
      .finally(() => {
        if (!cancelled) setMailboxesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [linkInvite?.id, linkInvite?.org_id, isSa, form.org_id, organization?.id]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const name = form.candidate_name.trim();
    const email = form.email.trim();
    const phone = form.phone.trim();
    if (!name) {
      toast({ variant: "destructive", title: "Name is required" });
      return;
    }
    if (!email && !phone) {
      toast({ variant: "destructive", title: "Add an email or phone" });
      return;
    }
    if (email && !EMAIL_RE.test(email)) {
      toast({ variant: "destructive", title: "Enter a valid email" });
      return;
    }
    if (isSa && !form.org_id) {
      toast({ variant: "destructive", title: "Select an organisation" });
      return;
    }
    setSaving(true);
    try {
      const expires = form.expires_at ? new Date(form.expires_at) : null;
      const res = await api.videoIntros.create(
        {
          candidate_name: name,
          email,
          phone,
          position: form.position.trim(),
          expires_at: expires && !Number.isNaN(expires.getTime()) ? expires.toISOString().slice(0, 19).replace("T", " ") : form.expires_at,
          max_duration_sec: form.max_duration_sec,
          max_retries: form.max_retries,
          org_id: isSa ? form.org_id : undefined,
        },
        isSa ? form.org_id : undefined,
      );
      setCreateOpen(false);
      setForm({
        candidate_name: "",
        email: "",
        phone: "",
        position: "",
        expires_at: defaultExpiryLocal(),
        max_duration_sec: 90,
        max_retries: 3,
        org_id: isSa ? form.org_id : organization?.id || "",
      });
      setLinkInvite(res.data);
      void qc.invalidateQueries({ queryKey: ["video-intros"] });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Could not create invitation" });
    } finally {
      setSaving(false);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Link copied" });
    } catch {
      toast({ variant: "destructive", title: "Could not copy" });
    }
  }

  const inviteUrl = (row: VideoIntroInvitation) => {
    if (row.invite_url) {
      return row.invite_url.startsWith("http") ? row.invite_url : `${window.location.origin}${row.invite_url}`;
    }
    if (row.invite_path) return `${window.location.origin}${row.invite_path}`;
    return "";
  };

  async function onSendMail() {
    if (!linkInvite) return;
    const url = inviteUrl(linkInvite);
    const to = String(linkInvite.email || "").trim();
    if (!to) {
      toast({ variant: "destructive", title: "This invitation has no email" });
      return;
    }
    if (!smtpAccountId) {
      toast({ variant: "destructive", title: "Select an Email Setup mailbox" });
      return;
    }
    if (!url) {
      toast({ variant: "destructive", title: "Invitation link is missing" });
      return;
    }
    setSendingMail(true);
    try {
      await api.videoIntros.sendEmail(linkInvite.id, { smtp_account_id: smtpAccountId, invite_url: url });
      toast({ title: "Email sent", description: `Sent to ${to}` });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Could not send email" });
    } finally {
      setSendingMail(false);
    }
  }

  async function onDeleteInvite() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.videoIntros.delete(deleteTarget.id);
      toast({ title: "Invitation deleted" });
      setDeleteTarget(null);
      void qc.invalidateQueries({ queryKey: ["video-intros"] });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Could not delete" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Video introductions</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Create a private link, copy it, or send it from an Email Setup mailbox. The candidate records a short
            camera introduction.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New invitation
        </Button>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search name, email, phone, role"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search invitations"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full lg:w-44" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses ({counts.all ?? 0})</SelectItem>
            {VIDEO_INTRO_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s} ({counts[s] ?? 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isSa ? (
          <Select value={orgId} onValueChange={setOrgId}>
            <SelectTrigger className="w-full lg:w-56" aria-label="Filter organisation">
              <SelectValue placeholder="Organisation" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All organisations</SelectItem>
              {orgs.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <p className="text-sm text-destructive">Could not load invitations.</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Video className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No invitations yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Create an invitation, copy the secure link, and send it to the candidate through your usual channel.
            </p>
            <Button onClick={() => setCreateOpen(true)}>Create invitation</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Candidate</TableHead>
                <TableHead className="hidden md:table-cell">Role</TableHead>
                {isSa ? <TableHead className="hidden lg:table-cell">Organisation</TableHead> : null}
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Expires</TableHead>
                <TableHead className="text-right"> </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="cursor-pointer" onClick={() => navigate(`/video-intros/${row.id}`)}>
                  <TableCell>
                    <div className="font-medium">{row.candidate_name}</div>
                    <div className="text-xs text-muted-foreground">{row.email || row.phone || "—"}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{row.position || "—"}</TableCell>
                  {isSa ? <TableCell className="hidden lg:table-cell">{row.org_name || "—"}</TableCell> : null}
                  <TableCell>{statusBadge(row.status)}</TableCell>
                  <TableCell className="hidden sm:table-cell text-sm">{fmtWhen(row.expires_at)}</TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/video-intros/${row.id}`}>Open</Link>
                      </Button>
                      {canDeleteInvite ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          aria-label={`Delete ${row.candidate_name}`}
                          onClick={() => setDeleteTarget(row)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New video invitation</DialogTitle>
            <DialogDescription>
              The candidate will see their name and the time limit. You copy the link after saving.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => void onCreate(e)}>
            {isSa ? (
              <div className="space-y-2">
                <Label htmlFor="vi-org">Organisation</Label>
                <Select value={form.org_id} onValueChange={(v) => setForm((f) => ({ ...f, org_id: v }))}>
                  <SelectTrigger id="vi-org">
                    <SelectValue placeholder="Select organisation" />
                  </SelectTrigger>
                  <SelectContent>
                    {orgs.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="vi-name">Candidate name</Label>
              <Input
                id="vi-name"
                required
                value={form.candidate_name}
                onChange={(e) => setForm((f) => ({ ...f, candidate_name: e.target.value }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="vi-email">Email</Label>
                <Input
                  id="vi-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vi-phone">Phone</Label>
                <Input
                  id="vi-phone"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vi-role">Role / position (optional)</Label>
              <Input
                id="vi-role"
                value={form.position}
                onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="vi-exp">Expires</Label>
                <Input
                  id="vi-exp"
                  type="datetime-local"
                  required
                  value={form.expires_at}
                  onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vi-dur">Max duration (seconds)</Label>
                <Input
                  id="vi-dur"
                  type="number"
                  min={30}
                  max={180}
                  value={form.max_duration_sec}
                  onChange={(e) => setForm((f) => ({ ...f, max_duration_sec: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vi-retry">Retries allowed after the first take</Label>
              <Input
                id="vi-retry"
                type="number"
                min={1}
                max={5}
                value={form.max_retries}
                onChange={(e) => setForm((f) => ({ ...f, max_retries: Number(e.target.value) }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create link
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!linkInvite} onOpenChange={(o) => !o && setLinkInvite(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy this link now</DialogTitle>
            <DialogDescription>
              For security the full link is only shown here. Generating a new link later invalidates this one.
            </DialogDescription>
          </DialogHeader>
          {linkInvite ? (
            <div className="space-y-3">
              <Input readOnly value={inviteUrl(linkInvite)} aria-label="Candidate invitation link" />
              <Button className="w-full" onClick={() => void copyText(inviteUrl(linkInvite))}>
                <Copy className="mr-2 h-4 w-4" /> Copy link
              </Button>
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Send mail</p>
                {linkInvite.email ? (
                  <p className="text-xs text-muted-foreground">To {linkInvite.email}</p>
                ) : (
                  <p className="text-xs text-destructive">This invitation has no email, so mail cannot be sent.</p>
                )}
                <Select
                  value={smtpAccountId || undefined}
                  onValueChange={setSmtpAccountId}
                  disabled={mailboxesLoading || sendingMail || !linkInvite.email}
                >
                  <SelectTrigger aria-label="Email Setup mailbox">
                    <SelectValue
                      placeholder={
                        mailboxesLoading
                          ? "Loading mailboxes…"
                          : mailboxes.length
                            ? "Choose Email Setup mailbox"
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
                <Button
                  className="w-full"
                  variant="secondary"
                  disabled={sendingMail || !linkInvite.email || !smtpAccountId || mailboxes.length === 0}
                  onClick={() => void onSendMail()}
                >
                  {sendingMail ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                  Send mail
                </Button>
              </div>
              <Button variant="outline" className="w-full" asChild>
                <Link to={`/video-intros/${linkInvite.id}`}>Open invitation</Link>
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `This removes ${deleteTarget.candidate_name} from the list and deletes any uploaded recording from storage. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void onDeleteInvite();
              }}
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
