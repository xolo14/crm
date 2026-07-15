import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { SaveButton } from "@/components/settings/ui/SaveButton";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSection } from "@/components/settings/ui/SettingsSection";
import { SettingsSelect } from "@/components/settings/ui/SettingsSelect";
import { ToggleSwitch } from "@/components/settings/ui/ToggleSwitch";

export function DataPrivacy() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [leadRetention, setLeadRetention] = useState("1y");
  const [activityRetention, setActivityRetention] = useState("6m");
  const [autoArchive, setAutoArchive] = useState(false);
  const [autoArchiveAfter, setAutoArchiveAfter] = useState("90");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.organizations.myOrg();
        if (!active) return;
        const org = (res as any)?.data;
        if (!org) return;
        const retention = org.profile?.retention || {};
        setLeadRetention(retention.lead_retention || "1y");
        setActivityRetention(retention.activity_retention || "6m");
        setAutoArchive(Boolean(retention.auto_archive));
        setAutoArchiveAfter(retention.auto_archive_after || "90");
      } catch (e) {
        // Non-fatal — form just keeps defaults.
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const onSaveRetention = async () => {
    setSaving(true);
    try {
      await api.organizations.updateProfile({
        retention: {
          lead_retention: leadRetention,
          activity_retention: activityRetention,
          auto_archive: autoArchive,
          auto_archive_after: autoArchiveAfter,
        },
      });
      toast({ title: "Data retention settings saved" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not save retention settings";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Loading data settings…</div>;
  }

  return (
    <div className="bg-gray-50">
      <SettingsSection title="Data Export" description="Download your CRM data in multiple formats.">
        <SettingsRow label="Export All CRM Data" description="Download complete backup as CSV/JSON">
          <button type="button" className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm">Export Data</button>
        </SettingsRow>
        <SettingsRow label="Export Contacts Only">
          <button type="button" className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm">Export Contacts</button>
        </SettingsRow>
        <SettingsRow label="Export Deals Only" border={false}>
          <button type="button" className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm">Export Deals</button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Data Retention" description="Configure automatic cleanup and archival windows.">
        <SettingsRow label="Lead Data Retention">
          <SettingsSelect
            value={leadRetention}
            onChange={setLeadRetention}
            options={[
              { value: "6m", label: "6 months" },
              { value: "1y", label: "1 year" },
              { value: "2y", label: "2 years" },
              { value: "forever", label: "Forever" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Activity Log Retention">
          <SettingsSelect
            value={activityRetention}
            onChange={setActivityRetention}
            options={[
              { value: "3m", label: "3 months" },
              { value: "6m", label: "6 months" },
              { value: "1y", label: "1 year" },
              { value: "forever", label: "Forever" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Auto-archive Inactive Leads" border={false}>
          <div className="flex items-center gap-3">
            <ToggleSwitch enabled={autoArchive} onChange={setAutoArchive} />
            <span className="text-sm text-gray-500">after</span>
            <SettingsSelect
              value={autoArchiveAfter}
              onChange={setAutoArchiveAfter}
              options={[
                { value: "30", label: "30 days" },
                { value: "60", label: "60 days" },
                { value: "90", label: "90 days" },
                { value: "180", label: "180 days" },
              ]}
            />
          </div>
        </SettingsRow>
      </SettingsSection>

      <div className="flex justify-end">
        <SaveButton onClick={onSaveRetention} loading={saving} label="Save Data Retention Settings" />
      </div>
    </div>
  );
}
