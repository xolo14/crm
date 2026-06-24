import type { PhaseEmailPayload } from "../types/emailTypes";

const PHASE_TIMELINE = [
  { num: 1, name: "Training", days: "15 days", desc: "Onboarding" },
  { num: 2, name: "Phase 1 Evaluation", days: "30 days", desc: "First target period" },
  { num: 3, name: "Phase 2 Evaluation", days: "30 days", desc: "Second target period" },
  { num: 4, name: "Phase 3 Evaluation", days: "30 days", desc: "Final target period" },
] as const;

function fmt(n: number): string {
  return "₹" + n.toLocaleString("en-IN");
}

function formatJoinDate(joiningDate: string): string {
  return new Date(joiningDate).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatSentAt(sentAt: string): string {
  return new Date(sentAt).toLocaleString("en-IN", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

function formatNextPhaseStart(startDate: string): string {
  return new Date(startDate).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
  });
}

export function getEmailSubject(p: PhaseEmailPayload): string {
  if (p.phase.isPhaseComplete) {
    return `✅ ${p.phase.phaseName} Complete — Next Phase Begins | ${p.memberName} | SYNCPedia`;
  }
  return `📊 Day ${p.triggerDay} Progress Report — ${p.phase.phaseName} | ${p.memberName} | SYNCPedia`;
}

export function getEmailHTML(p: PhaseEmailPayload): string {
  const pct = Math.min(Math.round(p.target.achievementPct), 100);
  const progressBarColor =
    pct >= 80 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";

  const statusLabel = p.phase.isPhaseComplete
    ? "🎉 Phase Complete"
    : p.triggerDay === 10
      ? "📍 Day 10 Check-in"
      : p.triggerDay === 15
        ? "📊 Day 15 Mid-review"
        : "📋 Day 30 Review";

  const motivational =
    pct >= 100
      ? "🎉 Outstanding work! You have achieved your target for this phase. Keep up the excellent performance!"
      : pct >= 80
        ? "💪 Great progress! You are very close to your target. Push through these final days — you've got this!"
        : pct >= 50
          ? "📈 Good momentum! Focus on increasing demos and follow-ups to close the gap to your target."
          : "🎯 There is still time to turn this around. Focus on high-quality leads and consistent follow-ups each day.";

  const remainingBg = p.target.remaining > 0 ? "#fff7ed" : "#f0fdf4";
  const remainingBorder = p.target.remaining > 0 ? "#fed7aa" : "#bbf7d0";
  const remainingLabelColor = p.target.remaining > 0 ? "#9a3412" : "#15803d";
  const remainingValueColor = p.target.remaining > 0 ? "#ea580c" : "#15803d";
  const remainingText =
    p.target.remaining > 0 ? fmt(p.target.remaining) : "Completed! 🎉";

  const activityCells = [
    { label: "Calls", value: p.totalCalls, color: "#3b82f6", bg: "#eff6ff" },
    {
      label: "Follow-ups",
      value: p.totalFollowUps,
      color: "#8b5cf6",
      bg: "#f5f3ff",
    },
    { label: "Demos", value: p.totalDemos, color: "#6366f1", bg: "#eef2ff" },
    { label: "Enrolled", value: p.totalEnrolled, color: "#22c55e", bg: "#f0fdf4" },
  ]
    .map(
      (s) => `
              <td align="center"
                style="padding:14px 8px;
                       background:${s.bg};
                       border-radius:10px;
                       border:1px solid ${s.color}22;">
                <p style="margin:0;font-size:22px;
                          font-weight:800;
                          color:${s.color};">
                  ${s.value}
                </p>
                <p style="margin:4px 0 0;
                          font-size:10px;
                          color:#6b7280;
                          text-transform:uppercase;
                          letter-spacing:0.5px;
                          font-weight:600;">
                  ${s.label}
                </p>
              </td>
              <td width="6px"></td>
            `,
    )
    .join("");

  const timelineRows = PHASE_TIMELINE.map((ph) => {
    const isCurrent = ph.num === p.phase.phaseNumber;
    const isPast = ph.num < p.phase.phaseNumber;
    const circleBg = isPast ? "#0f2318" : isCurrent ? "#2ed573" : "#e5e7eb";
    const circleColor = isPast ? "white" : isCurrent ? "#0f2318" : "#9ca3af";
    const currentBadge = isCurrent
      ? ' <span style="background:#fef9c3;color:#854d0e;font-size:10px;padding:2px 8px;border-radius:20px;font-weight:600;">Current</span>'
      : "";

    return `
              <tr>
                <td style="padding:8px 0;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td width="32" valign="middle" align="center">
                        <motion style="width:28px;height:28px;border-radius:50%;
                                    background:${circleBg};
                                    color:${circleColor};
                                    display:inline-block;
                                    font-size:12px;font-weight:700;
                                    line-height:28px;text-align:center;">
                          ${isPast ? "✓" : ph.num}
                        </motion>
                      </td>
                      <td style="padding-left:12px;">
                        <p style="margin:0;font-size:13px;
                                  font-weight:${isCurrent ? "700" : "400"};
                                  color:${isCurrent ? "#111827" : "#6b7280"};">
                          ${ph.name}${currentBadge}
                        </p>
                        <p style="margin:2px 0 0;font-size:11px;color:#9ca3af;">
                          ${ph.days} · ${ph.desc}
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            `;
  }).join("");

  const nextPhaseBlock =
    p.phase.isPhaseComplete && p.nextPhase
      ? `
    <tr>
      <td style="padding:20px 36px 0;">
        <motion style="background:#0f2318;border-radius:12px;padding:20px 24px;">
          <p style="margin:0 0 4px;font-size:11px;color:#2ed573;
                    font-weight:700;text-transform:uppercase;letter-spacing:1px;">
            🚀 Next Phase Begins
          </p>
          <h3 style="margin:0 0 12px;color:white;font-size:16px;font-weight:700;">
            ${p.nextPhase.phaseName}
          </h3>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.6);">
                  New Monthly Target
                </p>
                <p style="margin:4px 0 0;font-size:22px;font-weight:800;color:#2ed573;">
                  ${fmt(p.nextPhase.targetAmount)}
                </p>
              </td>
              <td align="right">
                <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.6);">
                  Duration
                </p>
                <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:white;">
                  ${p.nextPhase.durationDays} days
                </p>
                <p style="margin:2px 0 0;font-size:11px;color:rgba(255,255,255,0.5);">
                  Starts ${formatNextPhaseStart(p.nextPhase.startDate)}
                </p>
              </td>
            </tr>
          </table>
        </motion>
      </td>
    </tr>
    `
      : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>SYNCPedia Progress Report</title>
</head>
<body style="margin:0;padding:0;background-color:#f9fafb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 0;">
  <tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0"
    style="background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

    <tr>
      <td style="background:#0f2318;padding:28px 36px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <p style="margin:0;color:#2ed573;font-size:11px;font-weight:700;
                        letter-spacing:2px;text-transform:uppercase;">
                SYNCPedia Technologies
              </p>
              <h1 style="margin:4px 0 0;color:white;font-size:22px;font-weight:700;">
                ${statusLabel}
              </h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.6);font-size:13px;">
                ${p.phase.phaseName} · Day ${p.phase.dayInPhase} of ${p.phase.totalDaysInPhase}
              </p>
            </td>
            <td align="right" valign="top">
              <motion style="background:#2ed573;color:#0f2318;font-weight:800;
                          font-size:11px;padding:6px 14px;border-radius:20px;
                          display:inline-block;letter-spacing:0.5px;">
                Phase ${p.phase.phaseNumber} of 4
              </motion>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:28px 36px 0;">
        <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;
                  text-transform:uppercase;letter-spacing:1px;font-weight:600;">
          Hello,
        </p>
        <h2 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#111827;">
          ${p.memberName}
        </h2>
        <p style="margin:0;font-size:13px;color:#6b7280;">
          ${p.memberRole} · Joined ${formatJoinDate(p.joiningDate)}
        </p>
      </td>
    </tr>

    <tr>
      <td style="padding:24px 36px 0;">
        <motion style="background:#f9fafb;border-radius:12px;padding:20px 24px;border:1px solid #e5e7eb;">
          <p style="margin:0 0 16px;font-size:12px;font-weight:700;color:#6b7280;
                    text-transform:uppercase;letter-spacing:1px;">
            Target Progress
          </p>
          <div style="margin-bottom:16px;">
            <p style="margin:0 0 8px;font-size:13px;color:#374151;font-weight:500;">
              Pipeline Achievement
            </p>
            <div style="background:#e5e7eb;border-radius:99px;height:10px;width:100%;">
              <motion style="background:${progressBarColor};width:${pct}%;height:10px;
                          border-radius:99px;max-width:100%;"></motion>
            </div>
            <p style="margin:6px 0 0;font-size:12px;color:#6b7280;">
              ${pct}% achieved
            </p>
          </motion>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" width="33%"
                style="padding:12px;background:white;border-radius:8px;border:1px solid #e5e7eb;">
                <p style="margin:0;font-size:10px;color:#9ca3af;
                          text-transform:uppercase;letter-spacing:0.5px;">
                  Monthly Target
                </p>
                <p style="margin:4px 0 0;font-size:18px;font-weight:800;color:#111827;">
                  ${fmt(p.target.monthlyTarget)}
                </p>
              </td>
              <td width="8px"></td>
              <td align="center" width="33%"
                style="padding:12px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
                <p style="margin:0;font-size:10px;color:#15803d;
                          text-transform:uppercase;letter-spacing:0.5px;">
                  Achieved
                </p>
                <p style="margin:4px 0 0;font-size:18px;font-weight:800;color:#15803d;">
                  ${fmt(p.target.achieved)}
                </p>
              </td>
              <td width="8px"></td>
              <td align="center" width="33%"
                style="padding:12px;background:${remainingBg};border-radius:8px;
                       border:1px solid ${remainingBorder};">
                <p style="margin:0;font-size:10px;color:${remainingLabelColor};
                          text-transform:uppercase;letter-spacing:0.5px;">
                  Remaining
                </p>
                <p style="margin:4px 0 0;font-size:18px;font-weight:800;
                          color:${remainingValueColor};">
                  ${remainingText}
                </p>
              </td>
            </tr>
          </table>
        </motion>
      </td>
    </tr>

    <tr>
      <td style="padding:20px 36px 0;">
        <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#6b7280;
                  text-transform:uppercase;letter-spacing:1px;">
          Activity Summary (This Phase)
        </p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>${activityCells}</tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:20px 36px 0;">
        <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#6b7280;
                  text-transform:uppercase;letter-spacing:1px;">
          Training Program Timeline
        </p>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${timelineRows}
        </table>
      </td>
    </tr>

    ${nextPhaseBlock}

    <tr>
      <td style="padding:20px 36px 0;">
        <motion style="background:#f0fdf4;border-left:4px solid #2ed573;
                    border-radius:0 8px 8px 0;padding:14px 16px;">
          <p style="margin:0;font-size:13px;color:#374151;line-height:1.6;">
            ${motivational}
          </p>
        </motion>
      </td>
    </tr>

    <tr>
      <td style="padding:28px 36px;border-top:1px solid #e5e7eb;">
        <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;">
          This is an automated progress report from SYNCPedia CRM.
        </p>
        <p style="margin:4px 0 0;font-size:11px;color:#9ca3af;text-align:center;">
          Sent by HR Team · hr@syncpedia.in · SYNCPedia Technologies Pvt Ltd
        </p>
        <p style="margin:8px 0 0;font-size:10px;color:#d1d5db;text-align:center;">
          Sent on ${formatSentAt(p.sentAt)}
        </p>
      </td>
    </tr>

  </table>
  </td></tr>
  </table>
</body>
</html>`;
}
