import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, Upload, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const ACCEPT =
  "image/*,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff,.heic,.heif,.svg,.pdf,application/pdf";

const selectCls =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

type LeadOption = {
  id: string;
  name: string;
  email: string;
  phone: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => void;
}

export default function ManualPaymentDialog({
  open,
  onOpenChange,
  onSubmitted,
}: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const leadPickerRef = useRef<HTMLDivElement>(null);

  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paidAt, setPaidAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("upi");
  const [proof, setProof] = useState<File | null>(null);
  const [leadId, setLeadId] = useState("");
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [leadPickerOpen, setLeadPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  function reset() {
    setCustomerName("");
    setCustomerEmail("");
    setCustomerPhone("");
    setPaidAt(new Date().toISOString().slice(0, 10));
    setAmount("");
    setPaymentMethod("upi");
    setProof(null);
    setLeadId("");
    setLeadPickerOpen(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoadingLeads(true);
      try {
        const leadRes = await api.leads.list({ limit: 5000 });
        if (cancelled) return;
        const leadList = (
          Array.isArray(leadRes)
            ? leadRes
            : (leadRes as { data?: unknown; leads?: unknown })?.data ||
              (leadRes as { leads?: unknown })?.leads ||
              []
        ) as Array<Record<string, unknown>>;
        setLeads(
          leadList
            .map((l) => ({
              id: String(l.id ?? ""),
              name: String(l.name || "Unnamed lead"),
              email: String(l.email || ""),
              phone: String(l.phone || ""),
            }))
            .filter((l) => l.id)
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch {
        if (!cancelled) setLeads([]);
      } finally {
        if (!cancelled) setLoadingLeads(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!leadPickerOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (
        leadPickerRef.current &&
        !leadPickerRef.current.contains(e.target as Node)
      ) {
        setLeadPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [leadPickerOpen]);

  const filteredLeads = useMemo(() => {
    const q = customerName.trim().toLowerCase();
    const list = !q
      ? leads
      : leads.filter(
          (l) =>
            l.name.toLowerCase().includes(q) ||
            l.email.toLowerCase().includes(q) ||
            l.phone.replace(/\D/g, "").includes(q.replace(/\D/g, "")),
        );
    return list.slice(0, 40);
  }, [leads, customerName]);

  function handleNameChange(value: string) {
    setCustomerName(value);
    setLeadId("");
    setLeadPickerOpen(true);
  }

  function selectLead(l: LeadOption) {
    setLeadId(l.id);
    setCustomerName(l.name);
    setCustomerEmail(l.email || "");
    setCustomerPhone(l.phone || "");
    setLeadPickerOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = customerName.trim();
    const email = customerEmail.trim();
    const phone = customerPhone.trim();
    const method = paymentMethod.trim();
    const paid = paidAt.trim();
    const amt = Number(amount);

    if (!name) {
      toast({ variant: "destructive", title: "Customer name is required" });
      return;
    }
    if (!email) {
      toast({ variant: "destructive", title: "Customer email is required" });
      return;
    }
    if (!phone) {
      toast({ variant: "destructive", title: "Customer phone is required" });
      return;
    }
    if (!paid) {
      toast({ variant: "destructive", title: "Paid on date is required" });
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ variant: "destructive", title: "Enter a valid amount" });
      return;
    }
    if (!method) {
      toast({ variant: "destructive", title: "Payment mode is required" });
      return;
    }
    if (!proof) {
      toast({ variant: "destructive", title: "Upload a payment proof image" });
      return;
    }

    setSaving(true);
    try {
      const res = await api.manualPayments.create({
        amount: amt,
        payment_method: method,
        customer_name: name,
        customer_phone: phone,
        customer_email: email,
        paid_at: paid,
        proof,
      });
      toast({
        title: "Payment submitted",
        description:
          (res as { message?: string })?.message || "Saved successfully",
      });
      reset();
      onOpenChange(false);
      onSubmitted();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not submit payment",
        description: err instanceof Error ? err.message : "Try again",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add manual payment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Customer name — search leads or type manually */}
          <div className="space-y-1.5" ref={leadPickerRef}>
            <Label htmlFor="mp-customer">Customer name *</Label>
            <div className="relative">
              <Input
                id="mp-customer"
                required
                autoComplete="off"
                role="combobox"
                aria-expanded={leadPickerOpen}
                aria-autocomplete="list"
                aria-controls="mp-lead-listbox"
                disabled={loadingLeads}
                value={customerName}
                onChange={(e) => handleNameChange(e.target.value)}
                onFocus={() => setLeadPickerOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setLeadPickerOpen(false);
                }}
                placeholder="Type name or search leads…"
                className="pr-9"
              />
              <button
                type="button"
                tabIndex={-1}
                aria-label="Show leads"
                disabled={loadingLeads || leads.length === 0}
                onClick={() => setLeadPickerOpen((o) => !o)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-400 hover:text-gray-600 disabled:opacity-30"
              >
                <ChevronDown
                  size={18}
                  className={
                    leadPickerOpen ? "rotate-180 transition-transform" : ""
                  }
                />
              </button>

              {leadPickerOpen && leads.length > 0 ? (
                <ul
                  id="mp-lead-listbox"
                  role="listbox"
                  className="absolute z-20 left-0 right-0 mt-1 max-h-52 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg py-1"
                >
                  {filteredLeads.length === 0 ? (
                    <li className="px-3 py-2 text-xs text-gray-500">
                      No leads match — enter details manually
                    </li>
                  ) : (
                    filteredLeads.map((l) => (
                      <li
                        key={l.id}
                        role="option"
                        aria-selected={leadId === l.id}
                      >
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => selectLead(l)}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-[#e6faf0] ${
                            leadId === l.id ? "bg-[#e6faf0]/80" : ""
                          }`}
                        >
                          <span className="font-medium text-[#0f2318] block truncate">
                            {l.name}
                          </span>
                          {(l.email || l.phone) && (
                            <span className="text-[11px] text-gray-500 block truncate">
                              {[l.email, l.phone].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {leads.length === 0 && !loadingLeads
                ? "No leads found — enter the customer manually"
                : "Pick a lead to auto-fill email and phone, or type a new name"}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mp-email">Email *</Label>
              <Input
                id="mp-email"
                type="email"
                required
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="customer@email.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mp-phone">Phone *</Label>
              <Input
                id="mp-phone"
                required
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="Phone number"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mp-paid-at">Paid on *</Label>
            <Input
              id="mp-paid-at"
              type="date"
              required
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mp-amount">Amount (₹) *</Label>
              <Input
                id="mp-amount"
                type="number"
                min="1"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 15000"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mp-method">Payment mode *</Label>
              <select
                id="mp-method"
                required
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className={selectCls}
              >
                <option value="upi">UPI</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Payment proof *</Label>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => setProof(e.target.files?.[0] ?? null)}
            />
            {proof ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                <span className="truncate font-medium text-emerald-900">
                  {proof.name}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-emerald-800 hover:text-red-600"
                  onClick={() => {
                    setProof(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  aria-label="Remove file"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-600 hover:border-emerald-400 hover:bg-emerald-50/40"
              >
                <Upload size={20} className="text-gray-500" />
                <span className="font-medium">Upload proof image</span>
                <span className="text-xs text-gray-400">
                  JPG, PNG, GIF, WebP, BMP, TIFF, HEIC, SVG, PDF — max 12MB
                </span>
              </button>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-[#2ed573] hover:bg-[#25c066] text-[#0f2318]"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Submit payment"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
