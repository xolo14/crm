import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import {
  monthlyGateAmount,
  type FresherIncentiveTier,
  type FresherOrgPolicy,
} from "../policy";

export type PolicyTermsFieldsProps = {
  value: FresherOrgPolicy;
  onChange: (next: FresherOrgPolicy) => void;
  /** Hide training_days / month_days for compact add-member form. */
  compact?: boolean;
};

export function PolicyTermsFields({ value, onChange, compact }: PolicyTermsFieldsProps) {
  const patchNum = (key: keyof FresherOrgPolicy, raw: string) => {
    if (key === "incentive_tiers") return;
    const n = Number(raw);
    onChange({ ...value, [key]: Number.isFinite(n) ? n : value[key] });
  };

  const setTier = (tiers: FresherIncentiveTier[]) => {
    onChange({ ...value, incentive_tiers: tiers });
  };

  const updateTier = (index: number, patch: Partial<FresherIncentiveTier>) => {
    const next = value.incentive_tiers.map((t, i) =>
      i === index ? { ...t, ...patch } : t,
    );
    setTier(next);
  };

  const addTier = () => {
    const last = value.incentive_tiers[value.incentive_tiers.length - 1];
    setTier([
      ...value.incentive_tiers,
      {
        threshold: Math.max(0, (last?.threshold || 0) + 40_000),
        rate_percent: Math.min(100, (last?.rate_percent || 0) + 2),
      },
    ]);
  };

  const removeTier = (index: number) => {
    if (value.incentive_tiers.length <= 1) return;
    if (index === 0) return; // keep base row
    setTier(value.incentive_tiers.filter((_, i) => i !== index));
  };

  const gate = monthlyGateAmount(value);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Salary structure</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          Training target, probation, and monthly gate for fixed pay.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {!compact ? (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Training days</Label>
                <Input
                  type="number"
                  min={1}
                  value={value.training_days}
                  onChange={(e) => patchNum("training_days", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Days per evaluation month</Label>
                <Input
                  type="number"
                  min={1}
                  value={value.month_days}
                  onChange={(e) => patchNum("month_days", e.target.value)}
                />
              </div>
            </>
          ) : null}
          <div className="space-y-1">
            <Label className="text-xs">Training target (₹)</Label>
            <Input
              type="number"
              min={0}
              step={1000}
              value={value.training_target}
              onChange={(e) => patchNum("training_target", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Probation months (after training)</Label>
            <Input
              type="number"
              min={1}
              max={12}
              value={value.probation_months}
              onChange={(e) => patchNum("probation_months", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Monthly full target (₹)</Label>
            <Input
              type="number"
              min={0}
              step={1000}
              value={value.monthly_full_target}
              onChange={(e) => patchNum("monthly_full_target", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Gate % for fixed next month</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={value.monthly_gate_percent}
              onChange={(e) => patchNum("monthly_gate_percent", e.target.value)}
            />
            <p className="text-[11px] text-gray-500">
              Monthly target for fixed pay = ₹{gate.toLocaleString("en-IN")}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fixed salary / month (₹)</Label>
            <Input
              type="number"
              min={0}
              step={500}
              value={value.fixed_salary_monthly}
              onChange={(e) => patchNum("fixed_salary_monthly", e.target.value)}
            />
          </div>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Incentive structure (B2C)</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              % of collected amount. Base row is the default; higher rows apply when collected is
              greater than the threshold.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={addTier}>
            <Plus className="h-3.5 w-3.5" />
            Add tier
          </Button>
        </div>

        <div className="mt-3 overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-amber-50 text-left text-[11px] uppercase tracking-wide text-amber-900">
              <tr>
                <th className="px-3 py-2 font-semibold">#</th>
                <th className="px-3 py-2 font-semibold">Fixed (₹)</th>
                <th className="px-3 py-2 font-semibold">Target threshold</th>
                <th className="px-3 py-2 font-semibold">Incentive %</th>
                <th className="px-3 py-2 font-semibold w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {value.incentive_tiers.map((tier, i) => (
                <tr key={`${tier.threshold}-${i}`} className="bg-white">
                  <td className="px-3 py-2 tabular-nums text-gray-500">{i + 1}</td>
                  <td className="px-3 py-2 text-gray-700">
                    {i === 0 ? (
                      <span className="font-medium text-amber-800">
                        ₹{value.fixed_salary_monthly.toLocaleString("en-IN")}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {i === 0 ? (
                      <span className="text-xs text-gray-500">
                        &lt; ₹{(value.incentive_tiers[1]?.threshold || 80_000).toLocaleString("en-IN")}{" "}
                        (base)
                      </span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500">&gt;</span>
                        <Input
                          type="number"
                          min={0}
                          step={1000}
                          className="h-8 w-32"
                          value={tier.threshold}
                          onChange={(e) =>
                            updateTier(i, {
                              threshold: Math.max(0, Math.round(Number(e.target.value) || 0)),
                            })
                          }
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      className="h-8 w-24"
                      value={tier.rate_percent}
                      onChange={(e) =>
                        updateTier(i, {
                          rate_percent: Math.max(
                            0,
                            Math.min(100, Number(e.target.value) || 0),
                          ),
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    {i > 0 ? (
                      <button
                        type="button"
                        className="rounded p-1 text-red-600 hover:bg-red-50"
                        onClick={() => removeTier(i)}
                        aria-label="Remove tier"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
