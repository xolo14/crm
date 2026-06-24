import { Card, CardContent } from "@/components/ui/card";
import { ANALYTICS_CARD_CLASS, type RepSummary } from "@/utils/analyticsHelpers";

interface Props {
  byRep: RepSummary[];
}

const MEDALS = ["🥇", "🥈", "🥉"];
const MEDAL_BG = ["#fef9c3", "#f1f5f9", "#fef3c7"];

export function RepLeaderboard({ byRep }: Props) {
  const maxEnrolled = byRep[0]?.enrolled ?? 1;

  return (
    <Card className={ANALYTICS_CARD_CLASS}>
      <CardContent className="px-4 py-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Rep Leaderboard</h3>
          <span className="text-xs text-gray-400">ranked by enrolled</span>
        </div>
        {byRep.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">No data for selected period</p>
        ) : (
          byRep.map((rep, i) => {
            const barPct = maxEnrolled > 0 ? Math.round((rep.enrolled / maxEnrolled) * 100) : 0;
            return (
              <div key={rep.rep} className="flex items-center gap-3 border-b border-gray-50 py-3 last:border-0">
                {i < 3 ? (
                  <div
                    style={{ background: MEDAL_BG[i] }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base"
                  >
                    {MEDALS[i]}
                  </div>
                ) : (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-400">
                    {i + 1}
                  </div>
                )}
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e6faf0] text-xs font-bold text-[#0f5230]">
                  {rep.rep.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="truncate text-sm font-semibold text-gray-800">{rep.rep}</p>
                    <span className="ml-2 shrink-0 text-sm font-bold text-[#22c55e]">{rep.enrolled}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-100">
                    <div
                      className="h-1.5 rounded-full bg-[#22c55e] transition-all duration-700"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                  <div className="mt-1 flex gap-3">
                    <span className="text-xs text-gray-400">{rep.calls} calls</span>
                    <span className="text-xs text-gray-400">{rep.demos} demos</span>
                    <span className="text-xs font-medium text-[#22c55e]">{rep.conversionRate}% CVR</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
