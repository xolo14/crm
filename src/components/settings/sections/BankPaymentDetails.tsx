import { ChangeEvent, useEffect, useState } from "react";
import { QrCode, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { ProtectedUploadImage } from "@/components/ProtectedUploadImage";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/settings/ui/SaveButton";
import { SettingsInput } from "@/components/settings/ui/SettingsInput";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSection } from "@/components/settings/ui/SettingsSection";

type BankFields = {
  paymentQrUrl: string;
  accountName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  branch: string;
  upi: string;
};

const emptyFields = (): BankFields => ({
  paymentQrUrl: "",
  accountName: "",
  accountNumber: "",
  ifsc: "",
  bankName: "",
  branch: "",
  upi: "",
});

function applyProfile(profile: Record<string, unknown> | null | undefined): BankFields {
  const p = profile || {};
  return {
    paymentQrUrl: String(p.payment_qr_url || "").trim(),
    accountName: String(p.bank_account_name || ""),
    accountNumber: String(p.bank_account_number || ""),
    ifsc: String(p.bank_ifsc || ""),
    bankName: String(p.bank_name || ""),
    branch: String(p.bank_branch || ""),
    upi: String(p.bank_upi || ""),
  };
}

export function BankPaymentDetails() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [fields, setFields] = useState<BankFields>(emptyFields);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await api.organizations.myOrg();
        if (!active) return;
        const org = (res as { data?: { profile?: Record<string, unknown> } })?.data;
        setFields(applyProfile(org?.profile));
      } catch {
        if (active) setFields(emptyFields());
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const patch = <K extends keyof BankFields>(key: K, value: BankFields[K]) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await api.organizations.updateProfile({
        payment_qr_url: fields.paymentQrUrl,
        bank_account_name: fields.accountName,
        bank_account_number: fields.accountNumber,
        bank_ifsc: fields.ifsc,
        bank_name: fields.bankName,
        bank_branch: fields.branch,
        bank_upi: fields.upi,
      });
      toast({ title: "Bank & QR details saved" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not save bank details";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleQrUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type) || file.size > 2 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "Invalid QR image",
        description: "Use PNG, JPG, or WebP up to 2MB.",
      });
      return;
    }
    setUploadingQr(true);
    try {
      const res = await api.organizations.uploadPaymentQr(file);
      const next = String(res.payment_qr_url || "").trim();
      setFields((prev) => ({ ...prev, paymentQrUrl: next }));
      toast({ title: "QR uploaded", description: "Shown on Payment Records for your team." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not upload QR";
      toast({ variant: "destructive", title: "Upload failed", description: msg });
    } finally {
      setUploadingQr(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading bank details…</div>;
  }

  return (
    <div className="space-y-4">
      <SettingsSection
        title="Payment QR"
        description="Upload the UPI / bank QR shown on Payment Records so team members can pay or share it."
      >
        <div className="border-b border-gray-100 px-5 py-6">
          <div className="flex flex-col items-center sm:flex-row sm:items-start gap-4">
            <div className="flex h-36 w-36 shrink-0 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-transparent overflow-hidden">
              {fields.paymentQrUrl ? (
                <ProtectedUploadImage
                  path={fields.paymentQrUrl}
                  alt="Payment QR"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <QrCode className="h-10 w-10 text-gray-400" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <p className="text-sm text-muted-foreground">
                PNG, JPG, or WebP up to 2MB. This QR appears next to Add Payments on Payment Records.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="gap-1.5" asChild>
                  <label className="cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    {uploadingQr ? "Uploading…" : "Upload QR"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      disabled={uploadingQr}
                      onChange={(e) => void handleQrUpload(e)}
                    />
                  </label>
                </Button>
                {fields.paymentQrUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => patch("paymentQrUrl", "")}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Bank account details"
        description="Account name, number, IFSC, and related fields. Copiable from Payment Records."
      >
        <SettingsRow label="Account name">
          <SettingsInput
            value={fields.accountName}
            onChange={(v) => patch("accountName", v)}
            placeholder="Beneficiary / account holder name"
          />
        </SettingsRow>
        <SettingsRow label="Account number">
          <SettingsInput
            value={fields.accountNumber}
            onChange={(v) => patch("accountNumber", v)}
            placeholder="Bank account number"
          />
        </SettingsRow>
        <SettingsRow label="IFSC code">
          <SettingsInput
            value={fields.ifsc}
            onChange={(v) => patch("ifsc", v.toUpperCase())}
            placeholder="e.g. HDFC0001234"
          />
        </SettingsRow>
        <SettingsRow label="Bank name">
          <SettingsInput
            value={fields.bankName}
            onChange={(v) => patch("bankName", v)}
            placeholder="Bank name"
          />
        </SettingsRow>
        <SettingsRow label="Branch">
          <SettingsInput
            value={fields.branch}
            onChange={(v) => patch("branch", v)}
            placeholder="Branch (optional)"
          />
        </SettingsRow>
        <SettingsRow label="UPI ID" border={false}>
          <SettingsInput
            value={fields.upi}
            onChange={(v) => patch("upi", v)}
            placeholder="name@upi (optional)"
          />
        </SettingsRow>
      </SettingsSection>

      <div className="flex justify-end">
        <SaveButton loading={saving} onClick={() => void onSave()} />
      </div>
    </div>
  );
}
