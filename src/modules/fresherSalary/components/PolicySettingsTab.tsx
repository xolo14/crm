import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";
import { type FresherOrgPolicy } from "../policy";
import { PolicyTermsFields } from "./PolicyTermsFields";
import { SalaryFlowDiagram } from "./SalaryFlowDiagram";

export type PolicySettingsTabProps = {
  policy: FresherOrgPolicy;
  saving?: boolean;
  onSave: (next: FresherOrgPolicy) => void | Promise<void>;
};

export function PolicySettingsTab({ policy, saving, onSave }: PolicySettingsTabProps) {
  const [draft, setDraft] = useState<FresherOrgPolicy>(policy);

  useEffect(() => {
    setDraft(policy);
  }, [policy]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">Org policy numbers</h2>
        <p className="mt-1 text-xs text-gray-500">
          Design salary and incentive structures for freshers. These become the default when
          adding a member (can still be edited per person).
        </p>
        <div className="mt-5">
          <PolicyTermsFields value={draft} onChange={setDraft} />
        </div>
        <div className="mt-5 flex justify-end">
          <Button
            type="button"
            disabled={!!saving}
            className="gap-2 bg-[#0f5230] hover:bg-[#0c4226]"
            onClick={() => void onSave(draft)}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save policy
          </Button>
        </div>
      </div>
      <SalaryFlowDiagram policy={draft} />
    </div>
  );
}
