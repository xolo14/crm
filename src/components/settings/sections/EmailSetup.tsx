import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Mail, Send, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsSection } from "@/components/settings/ui/SettingsSection";

interface EmailAccount {
  slot: number;
  label: string;
  email: string;
  from_name: string;
  app_password: string;
  password_set: boolean;
  last_test_status?: string | null;
}

interface Category {
  key: string;
  label: string;
}

interface EmailSetupPayload {
  organization?: { name?: string };
  accounts?: Array<Partial<EmailAccount> & { slot: number }>;
  categories?: Category[];
  routes?: Record<string, number>;
}

interface EmailSetupResponse {
  data?: EmailSetupPayload;
}

const emptyAccounts = (): EmailAccount[] =>
  [1, 2, 3].map((slot) => ({
    slot,
    label: "",
    email: "",
    from_name: "",
    app_password: "",
    password_set: false,
  }));

export function EmailSetup() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingSlot, setTestingSlot] = useState<number | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [accounts, setAccounts] = useState<EmailAccount[]>(emptyAccounts);
  const [categories, setCategories] = useState<Category[]>([]);
  const [routes, setRoutes] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = (await api.settings.emailSetup()) as EmailSetupResponse;
      const data = response?.data ?? {};
      const loaded = emptyAccounts();
      for (const item of data.accounts ?? []) {
        const index = Number(item.slot) - 1;
        if (index >= 0 && index < 3) {
          loaded[index] = {
            slot: Number(item.slot),
            label: item.label ?? "",
            email: item.email ?? "",
            from_name: item.from_name ?? "",
            app_password: "",
            password_set: Boolean(item.password_set),
            last_test_status: item.last_test_status ?? null,
          };
        }
      }
      setAccounts(loaded);
      setCategories(data.categories ?? []);
      setRoutes(data.routes ?? {});
      setOrganizationName(data.organization?.name ?? "");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not load email setup",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const configured = useMemo(
    () => accounts.filter((account) => account.email.trim() !== ""),
    [accounts],
  );
  const emailOneConfigured = accounts[0].email.trim() !== "";

  function updateAccount(slot: number, field: keyof EmailAccount, value: string) {
    const isConfiguringEmailOne =
      slot === 1 &&
      field === "email" &&
      accounts[0].email.trim() === "" &&
      value.trim() !== "";
    setAccounts((current) =>
      current.map((account) =>
        account.slot === slot ? { ...account, [field]: value } : account,
      ),
    );
    if (isConfiguringEmailOne) {
      setRoutes((current) => {
        const next = { ...current };
        for (const category of categories) {
          if (!next[category.key]) next[category.key] = 1;
        }
        return next;
      });
    }
  }

  function clearAccount(slot: number) {
    setAccounts((current) =>
      current.map((account) =>
        account.slot === slot
          ? { ...emptyAccounts()[slot - 1], slot }
          : account,
      ),
    );
    setRoutes((current) => {
      const next = { ...current };
      for (const [category, selected] of Object.entries(next)) {
        if (selected === slot) delete next[category];
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const response = (await api.settings.saveEmailSetup({
        accounts: accounts.map(({ slot, label, email, from_name, app_password }) => ({
          slot,
          label,
          email,
          from_name,
          ...(app_password.trim() ? { app_password: app_password.replace(/\s/g, "") } : {}),
        })),
        routes,
      })) as EmailSetupResponse;
      toast({ title: "Email setup saved" });
      const data = response?.data;
      if (data) {
        const loaded = emptyAccounts();
        for (const item of data.accounts ?? []) {
          const index = Number(item.slot) - 1;
          if (index >= 0 && index < 3) {
            loaded[index] = {
              slot: Number(item.slot),
              label: item.label ?? "",
              email: item.email ?? "",
              from_name: item.from_name ?? "",
              app_password: "",
              password_set: true,
              last_test_status: item.last_test_status ?? null,
            };
          }
        }
        setAccounts(loaded);
        setRoutes(data.routes ?? {});
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  async function test(slot: number) {
    setTestingSlot(slot);
    try {
      const response = (await api.settings.testEmailAccount(slot)) as { to?: string };
      toast({
        title: "Test email sent",
        description: `Delivered to ${response?.to ?? "your account email"}.`,
      });
      setAccounts((current) =>
        current.map((account) =>
          account.slot === slot ? { ...account, last_test_status: "success" } : account,
        ),
      );
    } catch (error) {
      toast({
        variant: "destructive",
        title: "SMTP test failed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTestingSlot(null);
    }
  }

  if (loading) {
    return <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="bg-gray-50">
      <SettingsSection
        title="Gmail SMTP accounts"
        description={`Configure up to three Google Workspace or Gmail senders for ${organizationName}. Use a 16-character Google App Password, not the normal account password.`}
      >
        <div className="space-y-4 p-4">
          {accounts.map((account) => (
            <div key={account.slot} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-emerald-600" />
                  <h4 className="text-sm font-semibold">Email account {account.slot}</h4>
                  {account.last_test_status === "success" && (
                    <span className="text-xs font-medium text-emerald-600">Tested</span>
                  )}
                </div>
                {account.email && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => clearAccount(account.slot)} className="text-red-600">
                    <Trash2 className="mr-1 h-4 w-4" /> Remove
                  </Button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Label</Label>
                  <Input value={account.label} onChange={(e) => updateAccount(account.slot, "label", e.target.value)} placeholder="HR, Support, Accounts" />
                </div>
                <div>
                  <Label className="text-xs">Sender name</Label>
                  <Input value={account.from_name} onChange={(e) => updateAccount(account.slot, "from_name", e.target.value)} placeholder={organizationName} />
                </div>
                <div>
                  <Label className="text-xs">Gmail / Workspace email</Label>
                  <Input type="email" value={account.email} onChange={(e) => updateAccount(account.slot, "email", e.target.value)} placeholder="team@organization.com" autoComplete="off" />
                </div>
                <div>
                  <Label className="text-xs">Google App Password</Label>
                  <Input
                    type="password"
                    value={account.app_password}
                    onChange={(e) => updateAccount(account.slot, "app_password", e.target.value)}
                    placeholder={account.password_set ? "Leave blank to keep saved password" : "16-character app password"}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                <span>smtp.gmail.com · Port 587 · TLS</span>
                {account.password_set && account.email && (
                  <Button type="button" variant="outline" size="sm" disabled={testingSlot !== null} onClick={() => void test(account.slot)}>
                    {testingSlot === account.slot ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                    Send test
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Mail routing"
        description="Email 1 is automatically used for every unassigned mail type. You can route individual mail types through Email 2 or Email 3."
      >
        <div className="divide-y divide-gray-100">
          {categories.map((category) => (
            <div key={category.key} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_260px] sm:items-center">
              <Label className="text-sm">{category.label}</Label>
              <select
                value={routes[category.key] ?? ""}
                onChange={(e) =>
                  setRoutes((current) => ({
                    ...current,
                    [category.key]: e.target.value ? Number(e.target.value) : 0,
                  }))
                }
                className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
              >
                {!emailOneConfigured && <option value="">Not configured</option>}
                {configured.map((account) => (
                  <option key={account.slot} value={account.slot}>
                    {account.label || `Email ${account.slot}`} — {account.email}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </SettingsSection>

      <div className="flex justify-end pb-6">
        <Button onClick={() => void save()} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save email setup
        </Button>
      </div>
    </div>
  );
}
