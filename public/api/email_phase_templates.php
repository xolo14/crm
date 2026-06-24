<?php
/**
 * Fresher salary phase progress email templates (PHP — mirrors server/templates/phaseEmailTemplates.ts).
 */

function phaseEmailFmtInr(float $n): string
{
    return '₹' . number_format($n, 0, '.', ',');
}

function phaseEmailSubject(array $p): string
{
    $name = (string) ($p['memberName'] ?? '');
    $phase = is_array($p['phase'] ?? null) ? $p['phase'] : [];
    $phaseName = (string) ($phase['phaseName'] ?? '');
    if (!empty($phase['isPhaseComplete'])) {
        return "✅ {$phaseName} Complete — Next Phase Begins | {$name} | SYNCPedia";
    }
    $day = (int) ($p['triggerDay'] ?? 0);
    return "📊 Day {$day} Progress Report — {$phaseName} | {$name} | SYNCPedia";
}

function phaseEmailHtml(array $p): string
{
    $h = static fn(string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');

    $phase = is_array($p['phase'] ?? null) ? $p['phase'] : [];
    $target = is_array($p['target'] ?? null) ? $p['target'] : [];
    $pct = min(100, (int) round((float) ($target['achievementPct'] ?? 0)));
    $barColor = $pct >= 80 ? '#22c55e' : ($pct >= 50 ? '#f59e0b' : '#ef4444');

    $isComplete = !empty($phase['isPhaseComplete']);
    $triggerDay = (int) ($p['triggerDay'] ?? 0);
    $statusLabel = $isComplete
        ? '🎉 Phase Complete'
        : ($triggerDay === 10 ? '📍 Day 10 Check-in' : ($triggerDay === 15 ? '📊 Day 15 Mid-review' : '📋 Day 30 Review'));

    $remaining = (float) ($target['remaining'] ?? 0);
    $remainingBg = $remaining > 0 ? '#fff7ed' : '#f0fdf4';
    $remainingBorder = $remaining > 0 ? '#fed7aa' : '#bbf7d0';
    $remainingText = $remaining > 0 ? phaseEmailFmtInr($remaining) : 'Completed! 🎉';

    $motivational = $pct >= 100
        ? '🎉 Outstanding work! You have achieved your target for this phase.'
        : ($pct >= 80
            ? '💪 Great progress! You are very close to your target.'
            : ($pct >= 50
                ? '📈 Good momentum! Focus on demos and follow-ups.'
                : '🎯 Focus on high-quality leads and consistent follow-ups.'));

    $joinDisp = $h((string) ($p['joiningDate'] ?? ''));
    $sentAt = $h((string) ($p['sentAt'] ?? date('c')));

    $activityHtml = '';
    foreach (
        [
            ['Calls', (int) ($p['totalCalls'] ?? 0), '#3b82f6', '#eff6ff'],
            ['Follow-ups', (int) ($p['totalFollowUps'] ?? 0), '#8b5cf6', '#f5f3ff'],
            ['Demos', (int) ($p['totalDemos'] ?? 0), '#6366f1', '#eef2ff'],
            ['Enrolled', (int) ($p['totalEnrolled'] ?? 0), '#22c55e', '#f0fdf4'],
        ] as [$label, $val, $color, $bg]
    ) {
        $activityHtml .= '<td align="center" style="padding:14px 8px;background:' . $bg
            . ';border-radius:10px;border:1px solid ' . $color . '22;">'
            . '<p style="margin:0;font-size:22px;font-weight:800;color:' . $color . ';">' . $val . '</p>'
            . '<p style="margin:4px 0 0;font-size:10px;color:#6b7280;text-transform:uppercase;">' . $h($label) . '</p></td><td width="6px"></td>';
    }

    $nextBlock = '';
    $next = is_array($p['nextPhase'] ?? null) ? $p['nextPhase'] : null;
    if ($isComplete && $next) {
        $nextBlock = '<tr><td style="padding:20px 36px 0;"><div style="background:#0f2318;border-radius:12px;padding:20px 24px;">'
            . '<p style="margin:0 0 4px;font-size:11px;color:#2ed573;font-weight:700;">🚀 Next Phase Begins</p>'
            . '<h3 style="margin:0 0 12px;color:white;font-size:16px;">' . $h((string) ($next['phaseName'] ?? '')) . '</h3>'
            . '<p style="margin:0;color:#2ed573;font-size:22px;font-weight:800;">'
            . phaseEmailFmtInr((float) ($next['targetAmount'] ?? 0)) . '</p></div></td></tr>';
    }

    return '<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif;">'
        . '<table width="100%" style="background:#f9fafb;padding:32px 0;"><tr><td align="center">'
        . '<table width="600" style="background:white;border-radius:16px;overflow:hidden;">'
        . '<tr><td style="background:#0f2318;padding:28px 36px;">'
        . '<p style="margin:0;color:#2ed573;font-size:11px;font-weight:700;">SYNCPedia Technologies</p>'
        . '<h1 style="margin:4px 0 0;color:white;font-size:22px;">' . $h($statusLabel) . '</h1>'
        . '<p style="margin:6px 0 0;color:rgba(255,255,255,0.6);font-size:13px;">'
        . $h((string) ($phase['phaseName'] ?? '')) . ' · Day ' . (int) ($phase['dayInPhase'] ?? 0)
        . ' of ' . (int) ($phase['totalDaysInPhase'] ?? 0) . '</p></td></tr>'
        . '<tr><td style="padding:28px 36px 0;"><h2 style="margin:0;font-size:20px;">' . $h((string) ($p['memberName'] ?? '')) . '</h2>'
        . '<p style="margin:4px 0 0;color:#6b7280;font-size:13px;">' . $h((string) ($p['memberRole'] ?? ''))
        . ' · Joined ' . $joinDisp . '</p></td></tr>'
        . '<tr><td style="padding:24px 36px 0;"><div style="background:#f9fafb;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">'
        . '<p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#6b7280;">TARGET PROGRESS</p>'
        . '<div style="background:#e5e7eb;border-radius:99px;height:10px;"><div style="background:' . $barColor
        . ';width:' . $pct . '%;height:10px;border-radius:99px;"></div></div>'
        . '<p style="margin:8px 0 16px;font-size:12px;color:#6b7280;">' . $pct . '% achieved</p>'
        . '<table width="100%"><tr>'
        . '<td align="center" style="padding:12px;background:white;border:1px solid #e5e7eb;border-radius:8px;">'
        . '<p style="margin:0;font-size:10px;color:#9ca3af;">TARGET</p><p style="margin:4px 0 0;font-size:18px;font-weight:800;">'
        . phaseEmailFmtInr((float) ($target['monthlyTarget'] ?? 0)) . '</p></td><td width="8"></td>'
        . '<td align="center" style="padding:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">'
        . '<p style="margin:0;font-size:10px;color:#15803d;">ACHIEVED</p><p style="margin:4px 0 0;font-size:18px;font-weight:800;color:#15803d;">'
        . phaseEmailFmtInr((float) ($target['achieved'] ?? 0)) . '</p></td><td width="8"></td>'
        . '<td align="center" style="padding:12px;background:' . $remainingBg . ';border:1px solid ' . $remainingBorder . ';border-radius:8px;">'
        . '<p style="margin:0;font-size:10px;">REMAINING</p><p style="margin:4px 0 0;font-size:18px;font-weight:800;">' . $remainingText . '</p></td>'
        . '</tr></table></div></td></tr>'
        . '<tr><td style="padding:20px 36px 0;"><p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#6b7280;">ACTIVITY SUMMARY</p>'
        . '<table width="100%"><tr>' . $activityHtml . '</tr></table></td></tr>'
        . $nextBlock
        . '<tr><td style="padding:20px 36px 0;"><div style="background:#f0fdf4;border-left:4px solid #2ed573;padding:14px 16px;">'
        . '<p style="margin:0;font-size:13px;color:#374151;">' . $h($motivational) . '</p></div></td></tr>'
        . '<tr><td style="padding:28px 36px;border-top:1px solid #e5e7eb;text-align:center;">'
        . '<p style="margin:0;font-size:11px;color:#9ca3af;">Automated report from SYNCPedia CRM · hr@syncpedia.in</p>'
        . '<p style="margin:8px 0 0;font-size:10px;color:#d1d5db;">Sent ' . $sentAt . '</p></td></tr>'
        . '</table></td></tr></table></body></html>';
}
