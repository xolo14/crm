import { Card, CardContent } from "@/components/ui/card";
import { ANALYTICS_CARD_CLASS, type SalesReport } from "@/utils/analyticsHelpers";

interface Props {
  data: SalesReport[];
}

export function ConversionFunnel({ data }: Props) {
  const sum = (key: keyof Pick<SalesReport, "calls" | "followUps" | "demos" | "enrolled">) =>
    data.reduce((s, r) => s + r[key], 0);

  const stages = [
    { label: "Calls", value: sum("calls"), color: "#3b82f6" },
    { label: "Follow-ups", value: sum("followUps"), color: "#6366f1" },
    { label: "Demos", value: sum("demos"), color: "#8b5cf6" },
    { label: "Enrolled", value: sum("enrolled"), color: "#22c55e" },
  ];

  const max = Math.max(stages[0].value, 1);

  return (
    <Card className={ANALYTICS_CARD_CLASS}>
      <CardContent className="px-4 py-4">
        <h3 className="mb-4 text-sm font-semibold text-gray-700">Conversion Funnel</h3>
        <div className="space-y-2">
          {stages.map((s, i) => {
            const pct = Math.round((s.value / max) * 100);
            const prev = stages[i - 1];
            const dropPct = prev && prev.value > 0 ? Math.round((1 - s.value / prev.value) * 100) : null;
            return (
              <div key={s.label}>
                {dropPct !== null && (
                  <p className="my-1.5 text-center text-xs text-gray-400">▼ {dropPct}% drop-off</p>
                )}
                <div className="flex justify-center">
                  <div
                    style={{
                      width: `${Math.max(pct, 20)}%`,
                      background: s.color,
                      borderRadius: "8px",
                      padding: "10px 16px",
                      transition: "width 600ms ease-out",
                      minWidth: "120px",
                    }}
                    className="flex items-center justify-between"
                  >
                    <span className="text-xs font-semibold text-white">{s.label}</span>
                    <span className="ml-2 text-sm font-bold text-white">{s.value}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 border-t border-gray-100 pt-3 text-center">
          <span className="text-xs text-gray-400">Overall conversion: </span>
          <span className="mx-1 text-sm font-bold text-[#22c55e]">
            {stages[0].value > 0 ? ((stages[3].value / stages[0].value) * 100).toFixed(1) : 0}%
          </span>
          <span className="text-xs text-gray-400">Calls → Enrolled</span>
        </div>
      </CardContent>
    </Card>
  );
}
