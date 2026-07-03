import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { DangerButton } from "@/components/settings/ui/DangerButton";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSection } from "@/components/settings/ui/SettingsSection";
import { SettingsSelect } from "@/components/settings/ui/SettingsSelect";
import { ToggleSwitch } from "@/components/settings/ui/ToggleSwitch";

function DangerConfirmModal({
  open,
  action,
  orgName,
  onClose,
  onConfirm,
}: {
  open: boolean;
  action: string;
  orgName: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5">
        <div className="mb-3 flex items-center gap-2 text-red-600">
          <AlertTriangle className="h-5 w-5" />
          <h4 className="font-semibold">Confirm {action}</h4>
        </div>
        <p className="text-sm text-gray-600">
          Type <strong>{orgName}</strong> to confirm this action.
        </p>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={confirmText !== orgName}
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Confirm Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export function DataPrivacy() {
  const [leadRetention, setLeadRetention] = useState("1y");
  const [activityRetention, setActivityRetention] = useState("6m");
  const [autoArchive, setAutoArchive] = useState(false);
  const [autoArchiveAfter, setAutoArchiveAfter] = useState("90");
  const [modalAction, setModalAction] = useState("");

  const orgName = "SYNCPedia";

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

      <div className="rounded-xl border border-red-300 bg-[#fff5f5] p-5">
        <h3 className="text-base font-semibold text-red-700">Danger Zone</h3>
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Delete Organisation Account</p>
              <p className="text-xs text-gray-500">Permanently delete this CRM workspace and all associated data.</p>
            </div>
            <DangerButton label="Delete Account" onClick={() => setModalAction("Delete Organisation Account")} />
          </div>
        </div>
      </div>

      <DangerConfirmModal
        open={Boolean(modalAction)}
        action={modalAction}
        orgName={orgName}
        onClose={() => setModalAction("")}
        onConfirm={() => {
          window.alert(`${modalAction} confirmed`);
          setModalAction("");
        }}
      />
    </div>
  );
}
