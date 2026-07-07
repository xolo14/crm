import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Phone, Plus, Shield } from "lucide-react";
import { Link } from "react-router-dom";
import { communicationsApi } from "@/services/communications";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { OrgWhatsappOverview, VirtualNumber } from "@/types/communications";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  connected: "default",
  configured: "outline",
  not_connected: "secondary",
};

export default function CommunicationsAdminPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [vnForm, setVnForm] = useState({ phone_number: "", label: "", org_id: "", provider: "exotel" });
  const [vnOpen, setVnOpen] = useState(false);
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
    mutationFn: () => communicationsApi.addVirtualNumber(vnForm),
    onSuccess: () => {
      toast({ title: "Virtual number assigned to organization" });
      setVnOpen(false);
      setVnForm({ phone_number: "", label: "", org_id: "", provider: "exotel" });
      qc.invalidateQueries({ queryKey: ["comm"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Failed", description: e.message }),
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

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/communications"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Communications Admin</h1>
          <p className="text-sm text-muted-foreground">
            Assign virtual numbers to organizations — each org connects their own Meta WhatsApp API
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
          Step 1: Assign a virtual number to an organization. Step 2: Assign that number to employees (org admins also receive numbers automatically).
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
            <h2 className="font-semibold">Virtual numbers (assigned by Syncpedia)</h2>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {numbers.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No virtual numbers yet</TableCell></TableRow>
                  ) : (
                    numbers.map((n: VirtualNumber) => (
                      <TableRow key={n.id}>
                        <TableCell>{n.org_name}</TableCell>
                        <TableCell className="font-mono">{n.phone_number}</TableCell>
                        <TableCell>{n.label}</TableCell>
                        <TableCell>{n.calls_enabled ? "✓" : "—"}</TableCell>
                        <TableCell>{n.whatsapp_enabled ? "✓" : "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

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
