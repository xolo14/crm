export type EmailSendTone = 'sent' | 'failed' | 'pending';

export type EmailSendOutcome = {
  label: string;
  tone: EmailSendTone;
  reason: string;
};

/** Sent only when the mailbox recorded a send time. Everything else keeps a reason. */
export function emailSendOutcome(row: {
  status?: string | null;
  error_message?: string | null;
  sent_at?: string | null;
  scheduled_at?: string | null;
}): EmailSendOutcome {
  const status = String(row.status || '').trim().toLowerCase();
  const err = String(row.error_message || '').trim();
  const sentAt = row.sent_at ? new Date(row.sent_at) : null;
  const sentOk = !!sentAt && !Number.isNaN(sentAt.getTime());
  const scheduled = row.scheduled_at ? new Date(row.scheduled_at) : null;
  const scheduledFuture = !!scheduled && !Number.isNaN(scheduled.getTime()) && scheduled.getTime() > Date.now();

  if (status === 'sent' && sentOk) {
    return { label: 'Sent', tone: 'sent', reason: '' };
  }
  if (status === 'pending' && scheduledFuture) {
    return {
      label: 'Scheduled',
      tone: 'pending',
      reason: 'Not sent yet. It is waiting for the scheduled time.',
    };
  }
  if (status === 'pending' || status === 'sending') {
    return {
      label: 'Sending',
      tone: 'pending',
      reason: err || 'Not sent yet. It is in the send queue.',
    };
  }
  if (status === 'sent') {
    return {
      label: 'Not sent',
      tone: 'failed',
      reason: err || 'Not counted as sent. The mail server did not record a send time.',
    };
  }
  return {
    label: 'Failed',
    tone: 'failed',
    reason: err || 'Send failed. The mail server did not accept this message.',
  };
}

export type CampaignSendStatus = 'completed' | 'partial' | 'failed' | 'scheduled' | 'sending';

export type CampaignSendSummary = {
  status: CampaignSendStatus;
  label: string;
  sent: number;
  failed: number;
  pending: number;
  total: number;
};

/** Completed only when every log was actually sent. Partial when some were. Failed when none were. */
export function campaignSendSummary(rows: Array<{
  status?: string | null;
  error_message?: string | null;
  sent_at?: string | null;
  scheduled_at?: string | null;
}>): CampaignSendSummary {
  let sent = 0;
  let failed = 0;
  let pending = 0;
  let sending = 0;
  for (const row of rows) {
    const outcome = emailSendOutcome(row);
    if (outcome.tone === 'sent') sent += 1;
    else if (outcome.tone === 'pending' && outcome.label === 'Scheduled') pending += 1;
    else if (outcome.tone === 'pending') sending += 1;
    else failed += 1;
  }
  const total = sent + failed + pending + sending;
  let status: CampaignSendStatus = 'failed';
  if (total > 0 && sent === total) status = 'completed';
  else if (sending > 0) status = 'sending';
  else if (sent === 0 && failed === 0 && pending > 0) status = 'scheduled';
  else if (sent > 0) status = 'partial';
  const label = campaignStatusLabel(status);
  return { status, label, sent, failed, pending: pending + sending, total };
}

function campaignStatusLabel(status: CampaignSendStatus): string {
  if (status === 'completed') return 'Completed';
  if (status === 'partial') return 'Partial';
  if (status === 'scheduled') return 'Scheduled';
  if (status === 'sending') return 'Sending';
  return 'Failed';
}

function emptyCampaignSummary(status: CampaignSendStatus): CampaignSendSummary {
  return { status, label: campaignStatusLabel(status), sent: 0, failed: 0, pending: 0, total: 0 };
}

/** Log rows win. An empty log keeps the campaign status from the server instead of looking failed. */
export function campaignDisplaySummary(
  rows: Array<{
    status?: string | null;
    error_message?: string | null;
    sent_at?: string | null;
    scheduled_at?: string | null;
  }>,
  serverStatus?: string | null,
): CampaignSendSummary {
  if (rows.length > 0) return campaignSendSummary(rows);
  const status = String(serverStatus || '').trim().toLowerCase();
  if (status === 'completed' || status === 'partial' || status === 'scheduled' || status === 'sending' || status === 'failed') {
    return emptyCampaignSummary(status);
  }
  return emptyCampaignSummary('failed');
}

/** Failed campaigns, and partial campaigns that still have a failed recipient. */
export function campaignCanRetry(summary: CampaignSendSummary): boolean {
  return summary.status === 'failed' || (summary.status === 'partial' && summary.failed > 0);
}
