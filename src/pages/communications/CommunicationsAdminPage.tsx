import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Pencil, Phone, Plus, Shield, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { communicationsApi } from "@/services/communications";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { OrgWhatsappOverview, VirtualNumber } from "@/types/communications";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  connected: "default",
  configured: "outline",
  not_connected: "secondary",
};

type VirtualNumberForm = {
  phone_number: string;
  label: string;
  org_id: string;
  provider: string;
  whatsapp_enabled: boolean;
  calls_enabled: boolean;
};

const EMPTY_VN_FORM: VirtualNumberForm = {
  phone_number: "",
  label: "",
  org_id: "",
  provider: "exotel",
  whatsapp_enabled: true,
  calls_enabled: true,
};

function virtualNumberToForm(n: VirtualNumber): VirtualNumberForm {
  return {
    phone_number: n.phone_number || "",
    label: n.label || "",
    org_id: n.org_id || "",
    provider: n.provider || "exotel",
    whatsapp_enabled: Boolean(n.whatsapp_enabled),
    calls_enabled: Boolean(n.calls_enabled),
  };
}

export default function CommunicationsAdminPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [vnForm, setVnForm] = useState<VirtualNumberForm>({ ...EMPTY_VN_FORM });
  const [vnOpen, setVnOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingNumber, setEditingNumber] = useState<VirtualNumber | null>(null);
  const [editForm, setEditForm] = useState<VirtualNumberForm>({ ...EMPTY_VN_FORM });
  const [deleteTarget, setDeleteTarget] = useState<VirtualNumber | null>(null);
  const [assignVnId, setAssignVnId] = useState("");
  const [assignUserId, setAssignUserId] = useState("");

  const { data: orgsOverviewRes } = useQuery({ queryKey: ["comm", "orgs-overview"], queryFn: communicationsApi.orgsOverview });
  const { data: numbersRes } = useQuery({ queryKey: ["comm", "all-numbers"], queryFn: () => communicationsApi.virtualNumbers() });
  const { data: orgsRes } = useQuery({ queryKey: ["orgs"], queryFn: () => api.organizations.list() });
  const { data: teamRes } = useQuery({ queryKey: ["team"], queryFn: () => api.team.list() });

  const orgsOverview = orgsOverviewRes?.data ?? [];
  const numbers = numbersRes?.data ?? [];
  const orgs = Array.isArray(orgsRes) ? orgsRes : orgsRes?.data ?? [];
  const team = Array.isArray(teamRes) ? teamRes : teamRes?.data ?? [];

  const addNumberMut = useMutation({
    mutationFn: () =>
      communicationsApi.addVirtualNumber({
        ...vnForm,
        whatsapp_enabled: vnForm.whatsapp_enabled ? 1 : 0,
        calls_enabled: vnForm.calls_enabled ? 1 : 0,
      }),
    onSuccess: () => {
      toast({ title: "Virtual number assigned to organization" });
      setVnOpen(false);
      setVnForm({ ...EMPTY_VN_FORM });
      qc.invalidateQueries({ queryKey: ["comm"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Failed", description: e.message }),
  });

  const updateNumberMut = useMutation({
    mutationFn: () => {
      if (!editingNumber) throw new Error("No number selected");
      return communicationsApi.updateVirtualNumber(editingNumber.id, {
        org_id: editForm.org_id,
        phone_number: editForm.phone_number,
        label: editForm.label,
        provider: editForm.provider,
        whatsapp_enabled: editForm.whatsapp_enabled ? 1 : 0,
        calls_enabled: editForm.calls_enabled ? 1 : 0,
      });
    },
    onSuccess: () => {
      toast({ title: "Virtual number updated" });
      setEditOpen(false);
      setEditingNumber(null);
      qc.invalidateQueries({ queryKey: ["comm"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Update failed", description: e.message }),
  });

  const deleteNumberMut = useMutation({
    mutationFn: (id: string) => communicationsApi.deleteVirtualNumber(id),
    onSuccess: () => {
      toast({ title: "Virtual number deleted" });
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["comm"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Delete failed", description: e.message }),
  });

  const assignMut = useMutation({
    mutationFn: () => communicationsApi.assignNumber(assignVnId, assignUserId),
    onSuccess: () => {
      toast({ title: "Number assigned to employee" });
      setAssignVnId("");
      setAssignUserId("");
      qc.invalidateQueries({ queryKey: ["comm"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Assign failed", description: e.message }),
  });

  const openEdit = (n: VirtualNumber) => {
    setEditingNumber(n);
    setEditForm(virtualNumberToForm(n));
    setEditOpen(true);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/communications"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Communications Admin</h1>
          <p className="text-sm text-muted-foreground">
            Assign virtual numbers as caller-ID labels for the device dialer (tel:) and WhatsApp — not Exotel/cloud call routing
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" asChild>
            <Link to="/communications/meta-partner"><Shield className="h-3.5 w-3.5" /> Meta Partner</Link>
          </Button>
        </div>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Step 1: Assign a virtual number to an organization (metadata/label only). Step 2: Assign that number to employees.
          Dialing always uses the phone&apos;s native dialer — there is no Exotel webhook or cloud telephony in this CRM.
          Each org connects their own Meta WhatsApp API separately.
        </CardContent>
      </Card>

      <Tabs defaultValue="orgs">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="orgs" className="gap-1.5"><Building2 className="h-4 w-4" /> Organizations</TabsTrigger>
          <TabsTrigger value="numbers" className="gap-1.5"><Phone className="h-4 w-4" /> Virtual Numbers</TabsTrigger>
        </TabsList>

        <TabsContent value="orgs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">WhatsApp status by organization</CardTitle>
              <CardDescription>Meta API is configured per org — not on this platform</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Meta status</TableHead>
                    <TableHead>Business phone</TableHead>
                    <TableHead>Virtual numbers</TableHead>
                    <TableHead>Approved templates</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgsOverview.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No organizations</TableCell></TableRow>
                  ) : (
                    orgsOverview.map((o: OrgWhatsappOverview) => (
                      <TableRow key={o.id}>
                        <TableCell className="font-medium">{o.name}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[o.connection_status || "not_connected"] || "secondary"}>
                            {o.connection_status || "not connected"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{o.business_phone || "—"}</TableCell>
                        <TableCell>{o.virtual_numbers}</TableCell>
                        <TableCell>{o.approved_templates}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="numbers" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold">Virtual numbers (caller ID labels)</h2>
            <Dialog open={vnOpen} onOpenChange={setVnOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> Assign number</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Assign virtual number to organization</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Organization</Label>
                    <Select value={vnForm.org_id} onValueChange={(v) => setVnForm((p) => ({ ...p, org_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select org" /></SelectTrigger>
                      <SelectContent>
                        {orgs.map((o: { id: string; name: string }) => (
                          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone number</Label>
                    <Input value={vnForm.phone_number} onChange={(e) => setVnForm((p) => ({ ...p, phone_number: e.target.value }))} placeholder="+91..." />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Label</Label>
                    <Input value={vnForm.label} onChange={(e) => setVnForm((p) => ({ ...p, label: e.target.value }))} placeholder="Sales line 1" />
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={vnForm.calls_enabled}
                        onCheckedChange={(c) => setVnForm((p) => ({ ...p, calls_enabled: c === true }))}
                      />
                      Calls enabled
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={vnForm.whatsapp_enabled}
                        onCheckedChange={(c) => setVnForm((p) => ({ ...p, whatsapp_enabled: c === true }))}
                      />
                      WhatsApp enabled
                    </label>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => addNumberMut.mutate()} disabled={addNumberMut.isPending || !vnForm.org_id || !vnForm.phone_number}>Assign</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Org</TableHead>
                    <TableHead>Number</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Calls</TableHead>
                    <TableHead>WhatsApp</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {numbers.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No virtual numbers yet</TableCell></TableRow>
                  ) : (
                    numbers.map((n: VirtualNumber) => (
                      <TableRow key={n.id}>
                        <TableCell>{n.org_name}</TableCell>
                        <TableCell className="font-mono">{n.phone_number}</TableCell>
                        <TableCell>{n.label}</TableCell>
                        <TableCell>{n.calls_enabled ? "✓" : "—"}</TableCell>
                        <TableCell>{n.whatsapp_enabled ? "✓" : "—"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(n)} title="Edit">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setDeleteTarget(n)}
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setEditingNumber(null); }}>
            <DialogContent>
              <DialogHeader><DialogTitle>Edit virtual number</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Organization</Label>
                  <Select value={editForm.org_id} onValueChange={(v) => setEditForm((p) => ({ ...p, org_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select org" /></SelectTrigger>
                    <SelectContent>
                      {orgs.map((o: { id: string; name: string }) => (
                        <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Phone number</Label>
                  <Input value={editForm.phone_number} onChange={(e) => setEditForm((p) => ({ ...p, phone_number: e.target.value }))} placeholder="+91..." />
                </div>
                <div className="space-y-1.5">
                  <Label>Label</Label>
                  <Input value={editForm.label} onChange={(e) => setEditForm((p) => ({ ...p, label: e.target.value }))} placeholder="Sales line 1" />
                </div>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={editForm.calls_enabled}
                      onCheckedChange={(c) => setEditForm((p) => ({ ...p, calls_enabled: c === true }))}
                    />
                    Calls enabled
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={editForm.whatsapp_enabled}
                      onCheckedChange={(c) => setEditForm((p) => ({ ...p, whatsapp_enabled: c === true }))}
                    />
                    WhatsApp enabled
                  </label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => updateNumberMut.mutate()}
                  disabled={updateNumberMut.isPending || !editForm.org_id || !editForm.phone_number}
                >
                  Save changes
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete virtual number?</AlertDialogTitle>
                <AlertDialogDescription>
                  Remove <strong>{deleteTarget?.label || deleteTarget?.phone_number}</strong> from{" "}
                  <strong>{deleteTarget?.org_name}</strong>? Team assignments for this number will no longer work.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => deleteTarget && deleteNumberMut.mutate(deleteTarget.id)}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Card>
            <CardHeader><CardTitle className="text-base">Assign number to employee</CardTitle></CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-3">
              <Select value={assignVnId} onValueChange={setAssignVnId}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Virtual number" /></SelectTrigger>
                <SelectContent>
                  {numbers.map((n: VirtualNumber) => (
                    <SelectItem key={n.id} value={n.id}>{n.label} — {n.phone_number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={assignUserId} onValueChange={setAssignUserId}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Employee" /></SelectTrigger>
                <SelectContent>
                  {team.map((u: { id: string; full_name: string; email: string }) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name} ({u.email})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => assignMut.mutate()} disabled={!assignVnId || !assignUserId}>Assign</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
