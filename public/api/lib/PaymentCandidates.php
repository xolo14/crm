<?php
/**
 * Per-rep payment candidates (pitch price + installments). Org-scoped; never match across users.
 */

function paymentCandidatesEnsureSchema(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    try {
        $db->exec("
            CREATE TABLE IF NOT EXISTS payment_candidates (
              id CHAR(36) NOT NULL,
              org_id CHAR(36) NOT NULL,
              owner_user_id CHAR(36) NOT NULL,
              customer_name VARCHAR(200) NOT NULL,
              customer_email VARCHAR(255) DEFAULT NULL,
              customer_phone VARCHAR(40) DEFAULT NULL,
              phone_norm VARCHAR(20) DEFAULT NULL,
              email_norm VARCHAR(255) DEFAULT NULL,
              pitch_price DECIMAL(12,2) NOT NULL DEFAULT 0,
              lead_id CHAR(36) DEFAULT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              PRIMARY KEY (id),
              INDEX idx_pc_org_owner (org_id, owner_user_id),
              INDEX idx_pc_owner_phone (org_id, owner_user_id, phone_norm),
              INDEX idx_pc_owner_email (org_id, owner_user_id, email_norm)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
    } catch (Throwable $e) {
        error_log('[payment_candidates] create table: ' . $e->getMessage());
    }

    foreach ([
        'manual_payments' => ['candidate_id' => 'CHAR(36) DEFAULT NULL', 'installment_number' => 'INT DEFAULT NULL'],
        'payment_links' => ['candidate_id' => 'CHAR(36) DEFAULT NULL'],
    ] as $table => $cols) {
        foreach ($cols as $col => $def) {
            try {
                if (!syncpediaColumnExists($db, $table, $col)) {
                    $db->exec("ALTER TABLE `{$table}` ADD COLUMN `{$col}` {$def}");
                }
            } catch (Throwable $e) {
                error_log("[payment_candidates] alter {$table}.{$col}: " . $e->getMessage());
            }
        }
    }

    // One row per Razorpay payment (full or partial) against a candidate.
    try {
        $db->exec("
            CREATE TABLE IF NOT EXISTS payment_candidate_link_payments (
              id CHAR(36) NOT NULL,
              candidate_id CHAR(36) NOT NULL,
              razorpay_payment_link_id VARCHAR(64) NOT NULL,
              razorpay_payment_id VARCHAR(64) DEFAULT NULL,
              amount_paise BIGINT NOT NULL DEFAULT 0,
              paid_at TIMESTAMP NULL DEFAULT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (id),
              UNIQUE KEY uq_pclp_payment (razorpay_payment_id),
              INDEX idx_pclp_candidate (candidate_id),
              INDEX idx_pclp_link (razorpay_payment_link_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
    } catch (Throwable $e) {
        error_log('[payment_candidates] create link_payments: ' . $e->getMessage());
    }
}

function paymentCandidatesNormPhone(string $phone): string
{
    $d = preg_replace('/\D+/', '', $phone) ?? '';
    if (strlen($d) > 10) {
        $d = substr($d, -10);
    }
    return $d;
}

function paymentCandidatesNormEmail(string $email): string
{
    return strtolower(trim($email));
}

/**
 * Find candidate for this org + owner only (never cross users).
 */
function paymentCandidatesFindExisting(
    PDO $db,
    string $orgId,
    string $ownerUserId,
    string $email,
    string $phone,
): ?array {
    $orgId = trim($orgId);
    $ownerUserId = trim($ownerUserId);
    if ($orgId === '' || $ownerUserId === '') {
        return null;
    }
    $phoneNorm = paymentCandidatesNormPhone($phone);
    $emailNorm = paymentCandidatesNormEmail($email);
    if ($phoneNorm === '' && $emailNorm === '') {
        return null;
    }

    if ($phoneNorm !== '') {
        $st = $db->prepare(
            'SELECT * FROM payment_candidates
             WHERE org_id = ? AND owner_user_id = ? AND phone_norm = ?
             LIMIT 1'
        );
        $st->execute([$orgId, $ownerUserId, $phoneNorm]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            return $row;
        }
    }
    if ($emailNorm !== '') {
        $st = $db->prepare(
            'SELECT * FROM payment_candidates
             WHERE org_id = ? AND owner_user_id = ? AND email_norm = ?
             LIMIT 1'
        );
        $st->execute([$orgId, $ownerUserId, $emailNorm]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            return $row;
        }
    }
    return null;
}

/**
 * @return array{id: string, row: array, installment_number: int, is_new: bool}
 */
function paymentCandidatesResolveForPayment(
    PDO $db,
    string $orgId,
    string $ownerUserId,
    string $customerName,
    string $customerEmail,
    string $customerPhone,
    ?float $pitchPrice = null,
    ?string $candidateId = null,
    ?string $leadId = null,
): array {
    paymentCandidatesEnsureSchema($db);
    $orgId = trim($orgId);
    $ownerUserId = trim($ownerUserId);
    if ($orgId === '' || $ownerUserId === '') {
        throw new InvalidArgumentException('Organization context required');
    }

    $existing = null;
    if ($candidateId !== null && trim($candidateId) !== '') {
        $st = $db->prepare(
            'SELECT * FROM payment_candidates WHERE id = ? AND org_id = ? AND owner_user_id = ? LIMIT 1'
        );
        $st->execute([trim($candidateId), $orgId, $ownerUserId]);
        $existing = $st->fetch(PDO::FETCH_ASSOC) ?: null;
    }
    if (!$existing) {
        $existing = paymentCandidatesFindExisting(
            $db,
            $orgId,
            $ownerUserId,
            $customerEmail,
            $customerPhone,
        );
    }

    $isNew = false;
    if ($existing) {
        $id = (string) $existing['id'];
        if ($pitchPrice !== null && $pitchPrice > 0) {
            $curPitch = (float) ($existing['pitch_price'] ?? 0);
            if ($pitchPrice > $curPitch + 0.001) {
                $db->prepare('UPDATE payment_candidates SET pitch_price = ? WHERE id = ?')
                    ->execute([round($pitchPrice, 2), $id]);
                $existing['pitch_price'] = round($pitchPrice, 2);
            }
        }
        if ($leadId && empty($existing['lead_id'])) {
            $db->prepare('UPDATE payment_candidates SET lead_id = ? WHERE id = ?')
                ->execute([$leadId, $id]);
        }
        paymentCandidatesSyncPitchFromLinks($db, $id);
        $st = $db->prepare('SELECT * FROM payment_candidates WHERE id = ? LIMIT 1');
        $st->execute([$id]);
        $existing = $st->fetch(PDO::FETCH_ASSOC) ?: $existing;
    } else {
        if ($pitchPrice === null || $pitchPrice <= 0) {
            throw new InvalidArgumentException('Pitch price is required for a new candidate');
        }
        $id = generateUUID();
        $phoneNorm = paymentCandidatesNormPhone($customerPhone);
        $emailNorm = paymentCandidatesNormEmail($customerEmail);
        $db->prepare(
            'INSERT INTO payment_candidates
             (id, org_id, owner_user_id, customer_name, customer_email, customer_phone,
              phone_norm, email_norm, pitch_price, lead_id)
             VALUES (?,?,?,?,?,?,?,?,?,?)'
        )->execute([
            $id,
            $orgId,
            $ownerUserId,
            trim($customerName),
            trim($customerEmail) ?: null,
            trim($customerPhone) ?: null,
            $phoneNorm !== '' ? $phoneNorm : null,
            $emailNorm !== '' ? $emailNorm : null,
            round($pitchPrice, 2),
            $leadId ?: null,
        ]);
        $st = $db->prepare('SELECT * FROM payment_candidates WHERE id = ? LIMIT 1');
        $st->execute([$id]);
        $existing = $st->fetch(PDO::FETCH_ASSOC) ?: [];
        $isNew = true;
    }

    $inst = paymentCandidatesNextInstallmentNumber($db, (string) $existing['id']);
    return [
        'id' => (string) $existing['id'],
        'row' => $existing,
        'installment_number' => $inst,
        'is_new' => $isNew,
    ];
}

function paymentCandidatesLinkPaymentCount(PDO $db, string $candidateId): int
{
    try {
        $st = $db->prepare(
            'SELECT COUNT(*) FROM payment_candidate_link_payments WHERE candidate_id = ?'
        );
        $st->execute([$candidateId]);
        return (int) $st->fetchColumn();
    } catch (Throwable $e) {
        return 0;
    }
}

function paymentCandidatesNextInstallmentNumber(PDO $db, string $candidateId): int
{
    $st = $db->prepare(
        "SELECT COUNT(*) FROM manual_payments
         WHERE candidate_id = ? AND status IN ('approved','pending')"
    );
    $st->execute([$candidateId]);
    $manualCount = (int) $st->fetchColumn();
    $linkCount = paymentCandidatesLinkPaymentCount($db, $candidateId);

    return $manualCount + $linkCount + 1;
}

/**
 * Record one Razorpay payment (partial or full) as a candidate installment.
 * Idempotent by razorpay_payment_id when present.
 *
 * @param array<string, mixed>|null $paymentEntity
 */
function paymentCandidatesRecordLinkPayment(
    PDO $db,
    string $candidateId,
    string $razorpayLinkId,
    int $amountPaise,
    ?array $paymentEntity = null,
    ?string $paidAt = null,
): bool {
    $candidateId = trim($candidateId);
    $razorpayLinkId = trim($razorpayLinkId);
    if ($candidateId === '' || $razorpayLinkId === '' || $amountPaise <= 0) {
        return false;
    }
    paymentCandidatesEnsureSchema($db);

    $paymentId = '';
    if (is_array($paymentEntity)) {
        $paymentId = trim((string) ($paymentEntity['id'] ?? ''));
        if ($amountPaise <= 0) {
            $amountPaise = (int) ($paymentEntity['amount'] ?? 0);
        }
        if ($paidAt === null && !empty($paymentEntity['created_at'])) {
            $paidAt = date('Y-m-d H:i:s', (int) $paymentEntity['created_at']);
        }
    }
    if ($amountPaise <= 0) {
        return false;
    }

    // Fallback idempotency key when Razorpay payment id is missing.
    if ($paymentId === '') {
        $paymentId = 'delta:' . $razorpayLinkId . ':' . $amountPaise . ':' . ($paidAt ?: date('Y-m-d'));
    }

    try {
        $chk = $db->prepare(
            'SELECT id FROM payment_candidate_link_payments WHERE razorpay_payment_id = ? LIMIT 1'
        );
        $chk->execute([$paymentId]);
        if ($chk->fetchColumn()) {
            return false;
        }

        $id = generateUUID();
        $db->prepare(
            'INSERT INTO payment_candidate_link_payments
             (id, candidate_id, razorpay_payment_link_id, razorpay_payment_id, amount_paise, paid_at)
             VALUES (?,?,?,?,?,?)'
        )->execute([
            $id,
            $candidateId,
            $razorpayLinkId,
            $paymentId,
            $amountPaise,
            $paidAt,
        ]);
        return true;
    } catch (Throwable $e) {
        error_log('[payment_candidates] record link payment: ' . $e->getMessage());
        return false;
    }
}

/**
 * After payment_links.amount_paid changes, record the delta installment for the linked candidate.
 *
 * @param array<string, mixed>|null $paymentEntity
 */
function paymentCandidatesSyncLinkPaidDelta(
    PDO $db,
    array $linkRow,
    int $previousAmountPaid,
    int $newAmountPaid,
    ?array $paymentEntity = null,
): void {
    $candidateId = trim((string) ($linkRow['candidate_id'] ?? ''));
    $plinkId = trim((string) ($linkRow['razorpay_payment_link_id'] ?? ''));
    if ($candidateId === '' || $plinkId === '') {
        return;
    }
    $delta = $newAmountPaid - max(0, $previousAmountPaid);
    if ($delta <= 0 && is_array($paymentEntity)) {
        $delta = (int) ($paymentEntity['amount'] ?? 0);
    }
    if ($delta <= 0) {
        return;
    }
    paymentCandidatesRecordLinkPayment($db, $candidateId, $plinkId, $delta, $paymentEntity);
}

/** Sum of payment link totals (amount, not amount_paid) linked to this candidate, in rupees. */
function paymentCandidatesSumLinkTotalsRupees(PDO $db, string $candidateId): float
{
    if (!syncpediaColumnExists($db, 'payment_links', 'candidate_id')) {
        return 0.0;
    }
    $candidateId = trim($candidateId);
    if ($candidateId === '') {
        return 0.0;
    }
    try {
        $st = $db->prepare(
            'SELECT COALESCE(SUM(amount), 0) FROM payment_links
             WHERE candidate_id = ? AND amount > 0'
        );
        $st->execute([$candidateId]);
        return round((float) ($st->fetchColumn() ?: 0) / 100, 2);
    } catch (Throwable $e) {
        return 0.0;
    }
}

/** Final pitch = max(stored pitch, sum of all linked payment link totals). */
function paymentCandidatesEffectivePitch(PDO $db, array $candidate): float
{
    $stored = round((float) ($candidate['pitch_price'] ?? 0), 2);
    $id = trim((string) ($candidate['id'] ?? ''));
    if ($id === '') {
        return $stored;
    }
    return max($stored, paymentCandidatesSumLinkTotalsRupees($db, $id));
}

/** Persist pitch when link totals (summed) exceed stored pitch. Returns effective pitch. */
function paymentCandidatesSyncPitchFromLinks(PDO $db, string $candidateId): float
{
    $candidateId = trim($candidateId);
    if ($candidateId === '') {
        return 0.0;
    }
    $st = $db->prepare('SELECT * FROM payment_candidates WHERE id = ? LIMIT 1');
    $st->execute([$candidateId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return 0.0;
    }
    $effective = paymentCandidatesEffectivePitch($db, $row);
    $stored = round((float) ($row['pitch_price'] ?? 0), 2);
    if ($effective > $stored + 0.001) {
        $db->prepare('UPDATE payment_candidates SET pitch_price = ? WHERE id = ?')
            ->execute([$effective, $candidateId]);
    }
    return $effective;
}

/**
 * Backfill candidates from existing payment_links + manual_payments (idempotent).
 * Scoped by org and optional owner user ids.
 *
 * @param string[]|null $ownerUserIds null = all owners in org (or all if org null)
 * @return array{links: int, manuals: int, candidates: int}
 */
function paymentCandidatesBackfillLegacy(PDO $db, ?string $orgId, ?array $ownerUserIds = null): array
{
    paymentCandidatesEnsureSchema($db);
    $stats = ['links' => 0, 'manuals' => 0, 'candidates' => 0];
    $orgId = $orgId !== null ? trim($orgId) : '';

    $ownerFilter = null;
    if (is_array($ownerUserIds) && count($ownerUserIds) > 0) {
        $ownerFilter = array_values(array_filter(array_map('strval', $ownerUserIds)));
    }

    // --- Payment links ---
    if (syncpediaColumnExists($db, 'payment_links', 'candidate_id')) {
        $where = ['1=1'];
        $params = [];
        if ($orgId !== '') {
            $where[] = 'org_id = ?';
            $params[] = $orgId;
        }
        if ($ownerFilter !== null) {
            $in = implode(',', array_fill(0, count($ownerFilter), '?'));
            $where[] = "salesperson_id IN ({$in})";
            $params = array_merge($params, $ownerFilter);
        }
        $sql = 'SELECT * FROM payment_links WHERE ' . implode(' AND ', $where) . ' ORDER BY created_at ASC LIMIT 2000';
        try {
            $st = $db->prepare($sql);
            $st->execute($params);
            $links = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $e) {
            error_log('[payment_candidates] backfill links: ' . $e->getMessage());
            $links = [];
        }

        foreach ($links as $link) {
            $owner = trim((string) ($link['salesperson_id'] ?? ''));
            $linkOrg = trim((string) ($link['org_id'] ?? $orgId));
            $plinkId = trim((string) ($link['razorpay_payment_link_id'] ?? ''));
            if ($owner === '' || $owner === 'unknown' || $linkOrg === '' || $plinkId === '') {
                continue;
            }
            $name = trim((string) ($link['customer_name'] ?? '')) ?: 'Customer';
            $email = trim((string) ($link['customer_email'] ?? ''));
            $phone = trim((string) ($link['customer_phone'] ?? ''));
            $amountPaise = (int) ($link['amount'] ?? 0);
            $paidPaise = (int) ($link['amount_paid'] ?? 0);
            $pitch = $amountPaise > 0 ? round($amountPaise / 100, 2) : 0.0;

            $candidateId = trim((string) ($link['candidate_id'] ?? ''));
            if ($candidateId === '') {
                $existing = null;
                if ($email !== '' || $phone !== '') {
                    $existing = paymentCandidatesFindExisting($db, $linkOrg, $owner, $email, $phone);
                }
                if ($existing) {
                    $candidateId = (string) $existing['id'];
                } else {
                    $candidateId = generateUUID();
                    $phoneNorm = paymentCandidatesNormPhone($phone);
                    $emailNorm = paymentCandidatesNormEmail($email);
                    // Unique fallback so links without email/phone still group per-link.
                    if ($phoneNorm === '' && $emailNorm === '') {
                        $emailNorm = 'plink:' . strtolower($plinkId);
                    }
                    try {
                        $db->prepare(
                            'INSERT INTO payment_candidates
                             (id, org_id, owner_user_id, customer_name, customer_email, customer_phone,
                              phone_norm, email_norm, pitch_price, lead_id)
                             VALUES (?,?,?,?,?,?,?,?,?,NULL)'
                        )->execute([
                            $candidateId,
                            $linkOrg,
                            $owner,
                            $name,
                            $email !== '' ? $email : null,
                            $phone !== '' ? $phone : null,
                            $phoneNorm !== '' ? $phoneNorm : null,
                            $emailNorm !== '' ? $emailNorm : null,
                            0,
                        ]);
                        $stats['candidates']++;
                    } catch (Throwable $e) {
                        // Race / duplicate — try find again
                        $existing = paymentCandidatesFindExisting($db, $linkOrg, $owner, $email, $phone);
                        if (!$existing) {
                            continue;
                        }
                        $candidateId = (string) $existing['id'];
                    }
                }
                try {
                    $db->prepare(
                        'UPDATE payment_links SET candidate_id = ? WHERE razorpay_payment_link_id = ? LIMIT 1'
                    )->execute([$candidateId, $plinkId]);
                    $stats['links']++;
                } catch (Throwable $e) {
                    // ignore
                }
            }

            if ($candidateId !== '' && $paidPaise > 0) {
                // Ensure at least one installment row for legacy paid amount.
                $cnt = 0;
                try {
                    $c = $db->prepare(
                        'SELECT COUNT(*) FROM payment_candidate_link_payments
                         WHERE candidate_id = ? AND razorpay_payment_link_id = ?'
                    );
                    $c->execute([$candidateId, $plinkId]);
                    $cnt = (int) $c->fetchColumn();
                } catch (Throwable $e) {
                    $cnt = 0;
                }
                if ($cnt === 0) {
                    $paidAt = null;
                    if (!empty($link['updated_at'])) {
                        $paidAt = (string) $link['updated_at'];
                    } elseif (!empty($link['created_at'])) {
                        $paidAt = (string) $link['created_at'];
                    }
                    paymentCandidatesRecordLinkPayment(
                        $db,
                        $candidateId,
                        $plinkId,
                        $paidPaise,
                        null,
                        $paidAt,
                    );
                }
            }

            if ($candidateId !== '') {
                paymentCandidatesSyncPitchFromLinks($db, $candidateId);
            }
        }
    }

    // --- Manual payments ---
    if (syncpediaColumnExists($db, 'manual_payments', 'candidate_id')) {
        $where = ['(candidate_id IS NULL OR candidate_id = \'\')'];
        $params = [];
        if ($orgId !== '') {
            $where[] = 'org_id = ?';
            $params[] = $orgId;
        }
        if ($ownerFilter !== null) {
            $in = implode(',', array_fill(0, count($ownerFilter), '?'));
            $where[] = "submitted_by IN ({$in})";
            $params = array_merge($params, $ownerFilter);
        }
        $sql = 'SELECT * FROM manual_payments WHERE ' . implode(' AND ', $where)
            . ' ORDER BY COALESCE(paid_at, created_at) ASC LIMIT 2000';
        try {
            $st = $db->prepare($sql);
            $st->execute($params);
            $manuals = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable $e) {
            error_log('[payment_candidates] backfill manuals: ' . $e->getMessage());
            $manuals = [];
        }

        $instSeq = []; // candidate_id => next installment number
        foreach ($manuals as $mp) {
            $owner = trim((string) ($mp['submitted_by'] ?? ''));
            $mpOrg = trim((string) ($mp['org_id'] ?? $orgId));
            $mpId = trim((string) ($mp['id'] ?? ''));
            if ($owner === '' || $mpOrg === '' || $mpId === '') {
                continue;
            }
            $name = trim((string) ($mp['customer_name'] ?? '')) ?: 'Customer';
            $email = trim((string) ($mp['customer_email'] ?? ''));
            $phone = trim((string) ($mp['customer_phone'] ?? ''));
            $amount = round((float) ($mp['amount'] ?? 0), 2);
            if ($email === '' && $phone === '') {
                continue;
            }

            $existing = paymentCandidatesFindExisting($db, $mpOrg, $owner, $email, $phone);
            if ($existing) {
                $candidateId = (string) $existing['id'];
            } else {
                $candidateId = generateUUID();
                $phoneNorm = paymentCandidatesNormPhone($phone);
                $emailNorm = paymentCandidatesNormEmail($email);
                try {
                    $db->prepare(
                        'INSERT INTO payment_candidates
                         (id, org_id, owner_user_id, customer_name, customer_email, customer_phone,
                          phone_norm, email_norm, pitch_price, lead_id)
                         VALUES (?,?,?,?,?,?,?,?,?,NULL)'
                    )->execute([
                        $candidateId,
                        $mpOrg,
                        $owner,
                        $name,
                        $email !== '' ? $email : null,
                        $phone !== '' ? $phone : null,
                        $phoneNorm !== '' ? $phoneNorm : null,
                        $emailNorm !== '' ? $emailNorm : null,
                        0,
                    ]);
                    $stats['candidates']++;
                } catch (Throwable $e) {
                    $existing = paymentCandidatesFindExisting($db, $mpOrg, $owner, $email, $phone);
                    if (!$existing) {
                        continue;
                    }
                    $candidateId = (string) $existing['id'];
                }
            }

            if (!isset($instSeq[$candidateId])) {
                $instSeq[$candidateId] = paymentCandidatesNextInstallmentNumber($db, $candidateId);
            }
            $instNo = $instSeq[$candidateId];
            $instSeq[$candidateId] = $instNo + 1;

            try {
                $db->prepare(
                    'UPDATE manual_payments SET candidate_id = ?, installment_number = COALESCE(installment_number, ?) WHERE id = ?'
                )->execute([$candidateId, $instNo, $mpId]);
                $stats['manuals']++;
            } catch (Throwable $e) {
                // ignore
            }

            paymentCandidatesSyncPitchFromLinks($db, $candidateId);
        }
    }

    // Re-sync pitch for all candidates in scope (sum of link totals vs stored pitch).
    $syncWhere = ['1=1'];
    $syncParams = [];
    if ($orgId !== '') {
        $syncWhere[] = 'org_id = ?';
        $syncParams[] = $orgId;
    }
    if ($ownerFilter !== null) {
        $in = implode(',', array_fill(0, count($ownerFilter), '?'));
        $syncWhere[] = "owner_user_id IN ({$in})";
        $syncParams = array_merge($syncParams, $ownerFilter);
    }
    try {
        $syncSt = $db->prepare(
            'SELECT id FROM payment_candidates WHERE ' . implode(' AND ', $syncWhere) . ' LIMIT 2000'
        );
        $syncSt->execute($syncParams);
        foreach ($syncSt->fetchAll(PDO::FETCH_COLUMN) ?: [] as $cid) {
            paymentCandidatesSyncPitchFromLinks($db, (string) $cid);
        }
    } catch (Throwable $e) {
        error_log('[payment_candidates] backfill pitch sync: ' . $e->getMessage());
    }

    return $stats;
}

function paymentCandidatesLinkPaymentLink(
    PDO $db,
    string $orgId,
    string $ownerUserId,
    string $razorpayLinkId,
    string $customerName,
    string $customerEmail,
    string $customerPhone,
    ?string $leadId = null,
): void {
    if (!syncpediaColumnExists($db, 'payment_links', 'candidate_id')) {
        return;
    }
    paymentCandidatesEnsureSchema($db);
    $orgId = trim($orgId);
    $ownerUserId = trim($ownerUserId);
    if ($orgId === '' || $ownerUserId === '' || trim($razorpayLinkId) === '') {
        return;
    }

    $existing = paymentCandidatesFindExisting($db, $orgId, $ownerUserId, $customerEmail, $customerPhone);
    if (!$existing) {
        $id = generateUUID();
        $phoneNorm = paymentCandidatesNormPhone($customerPhone);
        $emailNorm = paymentCandidatesNormEmail($customerEmail);
        $db->prepare(
            'INSERT INTO payment_candidates
             (id, org_id, owner_user_id, customer_name, customer_email, customer_phone,
              phone_norm, email_norm, pitch_price, lead_id)
             VALUES (?,?,?,?,?,?,?,?,0,?)'
        )->execute([
            $id,
            $orgId,
            $ownerUserId,
            trim($customerName) ?: 'Customer',
            trim($customerEmail) ?: null,
            trim($customerPhone) ?: null,
            $phoneNorm !== '' ? $phoneNorm : null,
            $emailNorm !== '' ? $emailNorm : null,
            $leadId ?: null,
        ]);
        $candidateId = $id;
    } else {
        $candidateId = (string) $existing['id'];
    }

    $db->prepare(
        'UPDATE payment_links SET candidate_id = ? WHERE razorpay_payment_link_id = ? LIMIT 1'
    )->execute([$candidateId, $razorpayLinkId]);

    paymentCandidatesSyncPitchFromLinks($db, $candidateId);
}

/**
 * @return array{sql: string, params: array, owner_only: bool}
 */
function paymentCandidatesListScope(PDO $db, array $tokenData): array
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $userId = trim((string) ($tokenData['user_id'] ?? ''));
    $orgId = resolveCreatorOrgId($db, $tokenData);

    if ($role === 'super_admin' && ($orgId === null || $orgId === '')) {
        return ['sql' => '1=1', 'params' => [], 'owner_only' => false];
    }
    if (in_array($role, ['admin', 'org', 'super_admin', 'operational_manager'], true) && $orgId) {
        return ['sql' => 'pc.org_id = ?', 'params' => [$orgId], 'owner_only' => false];
    }
    if ($role === 'manager') {
        $visible = hierarchyGetVisibleUserIds($db, $tokenData);
        if (empty($visible)) {
            $visible = $userId !== '' ? [$userId] : ['__none__'];
        }
        $in = implode(',', array_fill(0, count($visible), '?'));
        $params = array_values($visible);
        $sql = "pc.owner_user_id IN ({$in})";
        if ($orgId) {
            $sql .= ' AND pc.org_id = ?';
            $params[] = $orgId;
        }
        return ['sql' => $sql, 'params' => $params, 'owner_only' => false];
    }
    return [
        'sql' => 'pc.org_id = ? AND pc.owner_user_id = ?',
        'params' => [$orgId ?: '__none__', $userId !== '' ? $userId : '__none__'],
        'owner_only' => true,
    ];
}

function paymentCandidatesTotalsForRow(PDO $db, array $candidate): array
{
    $id = (string) ($candidate['id'] ?? '');
    $pitch = paymentCandidatesEffectivePitch($db, $candidate);

    $manualPaid = 0.0;
    $manualCount = 0;
    $manualPending = 0;
    $st = $db->prepare(
        "SELECT
            COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0) AS s,
            SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS c_ok,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS c_pending
         FROM manual_payments WHERE candidate_id = ?"
    );
    $st->execute([$id]);
    $mr = $st->fetch(PDO::FETCH_ASSOC) ?: [];
    $manualPaid = round((float) ($mr['s'] ?? 0), 2);
    $manualCount = (int) ($mr['c_ok'] ?? 0);
    $manualPending = (int) ($mr['c_pending'] ?? 0);

    $linkPaid = 0.0;
    $linkCount = paymentCandidatesLinkPaymentCount($db, $id);
    try {
        $ls = $db->prepare(
            'SELECT COALESCE(SUM(amount_paise), 0) AS s
             FROM payment_candidate_link_payments WHERE candidate_id = ?'
        );
        $ls->execute([$id]);
        $linkPaid = round((float) ($ls->fetchColumn() ?: 0) / 100, 2);
    } catch (Throwable $e) {
        // Fallback: sum payment_links.amount_paid if installments table missing.
        if (syncpediaColumnExists($db, 'payment_links', 'candidate_id')) {
            $fb = $db->prepare(
                'SELECT COALESCE(SUM(amount_paid), 0) FROM payment_links
                 WHERE candidate_id = ? AND amount_paid > 0'
            );
            $fb->execute([$id]);
            $linkPaid = round((float) ($fb->fetchColumn() ?: 0) / 100, 2);
            $linkCount = $linkPaid > 0 ? max(1, $linkCount) : 0;
        }
    }

    $totalPaid = round($manualPaid + $linkPaid, 2);
    $remaining = $pitch > 0 ? max(0, round($pitch - $totalPaid, 2)) : 0;
    $installments = $manualCount + $manualPending + $linkCount;
    $enrolled = paymentCandidatesIsEnrolled($db, $candidate);
    $cleared = $enrolled;

    return [
        'pitch_price' => $pitch,
        'total_paid' => $totalPaid,
        'remaining' => $remaining,
        'installment_count' => $installments,
        'manual_count' => $manualCount,
        'manual_pending_count' => $manualPending,
        'link_count' => $linkCount,
        'status' => $cleared ? 'cleared' : ($pitch > 0 ? 'in_progress' : 'no_pitch'),
        'enrolled' => $enrolled,
    ];
}

/** True when candidate is linked to an enrolled student or enrolled lead. */
function paymentCandidatesIsEnrolled(PDO $db, array $candidate): bool
{
    $orgId = trim((string) ($candidate['org_id'] ?? ''));
    $leadId = trim((string) ($candidate['lead_id'] ?? ''));
    if ($leadId !== '') {
        try {
            $st = $db->prepare('SELECT id FROM students WHERE lead_id = ? LIMIT 1');
            $st->execute([$leadId]);
            if ($st->fetchColumn()) {
                return true;
            }
            $ls = $db->prepare(
                "SELECT id FROM leads WHERE id = ? AND LOWER(TRIM(COALESCE(status, ''))) IN ('enrolled', 'converted') LIMIT 1"
            );
            $ls->execute([$leadId]);
            if ($ls->fetchColumn()) {
                return true;
            }
        } catch (Throwable $e) {
            // ignore
        }
    }

    $email = paymentCandidatesNormEmail(
        (string) ($candidate['customer_email'] ?? '')
    );
    $phone = paymentCandidatesNormPhone(
        (string) ($candidate['customer_phone'] ?? '')
    );

    if ($orgId !== '' && $email !== '') {
        try {
            $st = $db->prepare(
                "SELECT id FROM students
                 WHERE org_id = ? AND LOWER(TRIM(COALESCE(email, ''))) = ?
                 LIMIT 1"
            );
            $st->execute([$orgId, $email]);
            if ($st->fetchColumn()) {
                return true;
            }
        } catch (Throwable $e) {
            // ignore
        }
    }

    if ($orgId !== '' && $phone !== '') {
        try {
            $st = $db->prepare(
                "SELECT id, phone FROM students WHERE org_id = ? AND phone IS NOT NULL AND TRIM(phone) <> '' LIMIT 500"
            );
            $st->execute([$orgId]);
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) ?: [] as $sr) {
                if (paymentCandidatesNormPhone((string) ($sr['phone'] ?? '')) === $phone) {
                    return true;
                }
            }
        } catch (Throwable $e) {
            // ignore
        }
    }

    return false;
}

/**
 * Match a payment candidate for an enrolled student (org-wide, any rep).
 *
 * @param array<string, mixed> $student
 */
function paymentCandidatesFindForStudent(PDO $db, string $orgId, array $student): ?array
{
    paymentCandidatesEnsureSchema($db);
    $orgId = trim($orgId);
    if ($orgId === '') {
        return null;
    }

    $leadId = trim((string) ($student['lead_id'] ?? $student['source_lead_id'] ?? ''));
    if ($leadId !== '') {
        $st = $db->prepare(
            'SELECT * FROM payment_candidates WHERE org_id = ? AND lead_id = ? ORDER BY updated_at DESC LIMIT 1'
        );
        $st->execute([$orgId, $leadId]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            return $row;
        }
    }

    $emailNorm = paymentCandidatesNormEmail(
        (string) ($student['email'] ?? $student['lead_email'] ?? '')
    );
    if ($emailNorm !== '') {
        $st = $db->prepare(
            'SELECT * FROM payment_candidates WHERE org_id = ? AND email_norm = ? ORDER BY updated_at DESC LIMIT 1'
        );
        $st->execute([$orgId, $emailNorm]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            return $row;
        }
    }

    $phoneNorm = paymentCandidatesNormPhone(
        (string) ($student['phone'] ?? $student['lead_phone'] ?? '')
    );
    if ($phoneNorm !== '') {
        $st = $db->prepare(
            'SELECT * FROM payment_candidates WHERE org_id = ? AND phone_norm = ? ORDER BY updated_at DESC LIMIT 1'
        );
        $st->execute([$orgId, $phoneNorm]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            return $row;
        }
    }

    $name = strtolower(trim((string) ($student['name'] ?? $student['lead_contact_name'] ?? '')));
    if ($name !== '') {
        $st = $db->prepare(
            'SELECT * FROM payment_candidates
             WHERE org_id = ? AND LOWER(TRIM(customer_name)) = ?
             ORDER BY updated_at DESC LIMIT 1'
        );
        $st->execute([$orgId, $name]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            return $row;
        }
    }

    return null;
}

/**
 * Attach payment candidate paid/pitch summary to student list rows.
 *
 * @param list<array<string, mixed>> $rows
 */
function studentsAttachPaymentSummaries(PDO $db, array &$rows): void
{
    foreach ($rows as &$row) {
        if (!is_array($row)) {
            continue;
        }
        $orgId = trim((string) ($row['org_id'] ?? ''));
        if ($orgId === '') {
            $row['payment_summary'] = null;
            continue;
        }
        $candidate = paymentCandidatesFindForStudent($db, $orgId, $row);
        if (!$candidate) {
            $row['payment_summary'] = null;
            continue;
        }
        $totals = paymentCandidatesTotalsForRow($db, $candidate);
        $row['payment_summary'] = [
            'candidate_id' => (string) ($candidate['id'] ?? ''),
            'pitch_price' => (float) ($totals['pitch_price'] ?? 0),
            'total_paid' => (float) ($totals['total_paid'] ?? 0),
            'remaining' => (float) ($totals['remaining'] ?? 0),
        ];
    }
    unset($row);
}

function paymentCandidatesFetchInstallments(PDO $db, string $candidateId): array
{
    $items = [];

    $st = $db->prepare(
        "SELECT mp.id, mp.amount, mp.paid_at, mp.payment_method, mp.status, mp.installment_number,
                mp.proof_path, mp.created_at, 'manual' AS source
         FROM manual_payments mp
         WHERE mp.candidate_id = ?
         ORDER BY COALESCE(mp.paid_at, mp.created_at) ASC, mp.installment_number ASC"
    );
    $st->execute([$candidateId]);
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $items[] = $row;
    }

    try {
        $ls = $db->prepare(
            "SELECT lp.id, lp.amount_paise, lp.paid_at, lp.created_at, lp.razorpay_payment_id,
                    lp.razorpay_payment_link_id, 'payment_link' AS source, 'paid' AS status,
                    'razorpay' AS payment_method
             FROM payment_candidate_link_payments lp
             WHERE lp.candidate_id = ?
             ORDER BY COALESCE(lp.paid_at, lp.created_at) ASC"
        );
        $ls->execute([$candidateId]);
        foreach ($ls->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            $row['amount'] = round((float) ($row['amount_paise'] ?? 0) / 100, 2);
            $items[] = $row;
        }
    } catch (Throwable $e) {
        if (syncpediaColumnExists($db, 'payment_links', 'candidate_id')) {
            $fb = $db->prepare(
                "SELECT razorpay_payment_link_id AS id, amount_paid, created_at, updated_at,
                        description, 'payment_link' AS source, status, 'razorpay' AS payment_method
                 FROM payment_links WHERE candidate_id = ? AND amount_paid > 0"
            );
            $fb->execute([$candidateId]);
            foreach ($fb->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
                $row['amount'] = round((float) ($row['amount_paid'] ?? 0) / 100, 2);
                $row['paid_at'] = $row['updated_at'] ?? $row['created_at'] ?? null;
                $items[] = $row;
            }
        }
    }

    usort($items, static function ($a, $b) {
        $da = (string) ($a['paid_at'] ?? $a['created_at'] ?? '');
        $dbt = (string) ($b['paid_at'] ?? $b['created_at'] ?? '');
        return strcmp($da, $dbt);
    });

    // Number installments in chronological order for display.
    $n = 0;
    foreach ($items as &$it) {
        $n++;
        if (empty($it['installment_number'])) {
            $it['installment_number'] = $n;
        }
    }
    unset($it);

    return $items;
}

/** Org admin / super_admin, or the rep who owns the candidate (owner_user_id). */
function paymentCandidatesCanEditPitch(array $tokenData, array $candidateRow): bool
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    if (in_array($role, ['super_admin', 'admin', 'org'], true)) {
        return true;
    }
    $userId = trim((string) ($tokenData['user_id'] ?? ''));
    $ownerId = trim((string) ($candidateRow['owner_user_id'] ?? ''));
    return $userId !== '' && $ownerId !== '' && $userId === $ownerId;
}
