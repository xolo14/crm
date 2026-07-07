<?php
/**
 * Post-payment fulfillment: invoice email + lead enrollment / student creation.
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/payment_link_store.php';
require_once __DIR__ . '/payment_link_receipt.php';

/**
 * @param array<string, mixed> $row
 * @param array<string, mixed> $rzpLink
 * @return array<string, string>
 */
function paymentLinkMergedNotes(array $row, array $rzpLink): array
{
    $notes = [];
    if (!empty($row['notes'])) {
        $decoded = json_decode((string) $row['notes'], true);
        if (is_array($decoded)) {
            $notes = $decoded;
        }
    }
    $rzpNotes = is_array($rzpLink['notes'] ?? null) ? $rzpLink['notes'] : [];
    return array_merge($notes, $rzpNotes);
}

/**
 * Resolve CRM lead from payment-link notes or customer email.
 */
function paymentLinkResolveLeadId(PDO $db, array $row, array $rzpLink, array $notes): ?string
{
    $plinkOrg = trim((string) ($row['org_id'] ?? ''));
    $leadId = trim((string) ($notes['lead_id'] ?? ''));
    if ($leadId !== '') {
        $st = $db->prepare('SELECT id, org_id FROM leads WHERE id = ? LIMIT 1');
        $st->execute([$leadId]);
        $found = $st->fetch(PDO::FETCH_ASSOC);
        if (!is_array($found)) {
            error_log('[payment_fulfillment] lead_id not found: ' . $leadId);
            return null;
        }
        $leadOrg = trim((string) ($found['org_id'] ?? ''));
        if ($plinkOrg !== '' && $leadOrg !== '' && $leadOrg !== $plinkOrg) {
            error_log('[payment_fulfillment] lead_id org mismatch for payment link');
            return null;
        }
        return $leadId;
    }

    $email = trim((string) ($row['customer_email'] ?? ''));
    $cust = is_array($rzpLink['customer'] ?? null) ? $rzpLink['customer'] : [];
    if ($email === '') {
        $email = trim((string) ($cust['email'] ?? ''));
    }
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return null;
    }

    $orgId = trim((string) ($row['org_id'] ?? ''));
    if ($orgId !== '') {
        $st = $db->prepare(
            'SELECT id FROM leads WHERE LOWER(TRIM(email)) = LOWER(?) AND org_id = ?
             ORDER BY updated_at DESC LIMIT 1',
        );
        $st->execute([$email, $orgId]);
    } else {
        $st = $db->prepare(
            'SELECT id FROM leads WHERE LOWER(TRIM(email)) = LOWER(?)
             ORDER BY updated_at DESC LIMIT 1',
        );
        $st->execute([$email]);
    }
    $found = $st->fetch(PDO::FETCH_ASSOC);
    if (!is_array($found)) {
        return null;
    }
    $id = trim((string) ($found['id'] ?? ''));
    return $id !== '' ? $id : null;
}

/**
 * @param array<string, mixed> $row
 * @return array<string, mixed>
 */
function paymentLinkFulfillmentTokenData(array $row): array
{
    return [
        'user_id' => trim((string) ($row['salesperson_id'] ?? '')),
        'org_id' => !empty($row['org_id']) ? (string) $row['org_id'] : null,
        'role' => 'admin',
    ];
}

/**
 * @param array<string, mixed> $leadRow
 * @return array{course_id: ?string, seat_limit: int, enrolled: int, error: ?string}
 */
function paymentLinkValidateBatchForEnrollment(
    PDO $db,
    string $batchId,
    array $leadRow,
    array $tokenData,
): array {
    $bid = trim($batchId);
    if ($bid === '') {
        return ['course_id' => null, 'seat_limit' => 0, 'enrolled' => 0, 'error' => 'batch_id is empty'];
    }
    $st = $db->prepare('SELECT id, course_id, org_id, seat_limit FROM batches WHERE id = ? LIMIT 1');
    $st->execute([$bid]);
    $b = $st->fetch(PDO::FETCH_ASSOC);
    if (!is_array($b)) {
        return ['course_id' => null, 'seat_limit' => 0, 'enrolled' => 0, 'error' => 'Batch not found'];
    }
    $leadOrg = trim((string) ($leadRow['org_id'] ?? ''));
    $jwtOrg = getOrgId($tokenData);
    $jwtOrgStr = is_string($jwtOrg) ? trim($jwtOrg) : '';
    $bOrg = trim((string) ($b['org_id'] ?? ''));
    $expectedOrg = $leadOrg !== '' ? $leadOrg : $jwtOrgStr;
    if ($expectedOrg !== '' && $bOrg !== '' && $bOrg !== $expectedOrg) {
        return ['course_id' => null, 'seat_limit' => 0, 'enrolled' => 0, 'error' => 'Batch org mismatch'];
    }
    $cid = isset($b['course_id']) ? trim((string) $b['course_id']) : '';
    $courseId = $cid !== '' ? $cid : null;
    $seatLimit = (int) ($b['seat_limit'] ?? 30);
    if ($seatLimit < 1) {
        $seatLimit = 30;
    }
    $cntSt = $db->prepare('SELECT COUNT(*) FROM students WHERE batch_id = ?');
    $cntSt->execute([$bid]);
    $enrolled = (int) $cntSt->fetchColumn();
    if ($enrolled >= $seatLimit) {
        return [
            'course_id' => $courseId,
            'seat_limit' => $seatLimit,
            'enrolled' => $enrolled,
            'error' => 'Batch is full',
        ];
    }

    return ['course_id' => $courseId, 'seat_limit' => $seatLimit, 'enrolled' => $enrolled, 'error' => null];
}

function paymentLinkMarkEnrollmentApplied(string $plinkId): void
{
    $db = paymentLinksDb();
    $st = $db->prepare(
        'UPDATE payment_links SET enrollment_applied_at = NOW(), updated_at = CURRENT_TIMESTAMP
         WHERE razorpay_payment_link_id = ? AND enrollment_applied_at IS NULL',
    );
    $st->execute([$plinkId]);
}

/**
 * Enroll linked lead and create student after full payment.
 *
 * @param array<string, mixed> $row
 * @param array<string, mixed> $rzpLink
 * @return array<string, mixed>
 */
function paymentLinkTryEnrollFromPayment(array $row, array $rzpLink): array
{
    if (!empty($row['enrollment_applied_at'])) {
        return ['ok' => true, 'skipped' => true, 'reason' => 'already_enrolled'];
    }

    $notes = paymentLinkMergedNotes($row, $rzpLink);
    $db = paymentLinksDb();
    $leadId = paymentLinkResolveLeadId($db, $row, $rzpLink, $notes) ?? '';
    if ($leadId === '') {
        return ['ok' => true, 'skipped' => true, 'reason' => 'no_lead_match'];
    }
    $tokenData = paymentLinkFulfillmentTokenData($row);

    $st = $db->prepare(
        'SELECT id, name, email, phone, college, year_of_study, org_id, status
         FROM leads WHERE id = ? LIMIT 1',
    );
    $st->execute([$leadId]);
    $leadRow = $st->fetch(PDO::FETCH_ASSOC);
    if (!is_array($leadRow)) {
        return ['ok' => false, 'error' => 'lead_not_found', 'lead_id' => $leadId];
    }

    $plinkOrg = trim((string) ($row['org_id'] ?? ''));
    $leadOrg = trim((string) ($leadRow['org_id'] ?? ''));
    if ($plinkOrg !== '' && $leadOrg !== '' && $leadOrg !== $plinkOrg) {
        return ['ok' => false, 'error' => 'lead_org_mismatch', 'lead_id' => $leadId];
    }

    $leadEmail = trim((string) ($leadRow['email'] ?? ''));
    if ($leadEmail === '') {
        $leadEmail = trim((string) ($row['customer_email'] ?? ''));
        $cust = is_array($rzpLink['customer'] ?? null) ? $rzpLink['customer'] : [];
        if ($leadEmail === '') {
            $leadEmail = trim((string) ($cust['email'] ?? ''));
        }
        if ($leadEmail !== '') {
            try {
                $upEm = $db->prepare(
                    'UPDATE leads SET email = ? WHERE id = ? AND (email IS NULL OR email = \'\')',
                );
                $upEm->execute([$leadEmail, $leadId]);
                $leadRow['email'] = $leadEmail;
            } catch (Throwable $ignored) {
            }
        }
    }

    if (trim((string) ($leadRow['email'] ?? '')) === '') {
        return ['ok' => false, 'error' => 'lead_missing_email', 'lead_id' => $leadId];
    }

    $currentStatus = strtolower(trim((string) ($leadRow['status'] ?? '')));
    if ($currentStatus !== 'enrolled') {
        try {
            $db->prepare(
                'UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            )->execute(['enrolled', $leadId]);
        } catch (Throwable $e) {
            error_log('[payment_fulfillment] lead status: ' . $e->getMessage());
            return ['ok' => false, 'error' => 'lead_status_update_failed', 'lead_id' => $leadId];
        }
    }

    try {
        leadsTryAttachStudentForEnrollment($db, $tokenData, $leadId);
    } catch (Throwable $e) {
        error_log('[payment_fulfillment] student create: ' . $e->getMessage());
    }

    $batchId = trim((string) ($notes['batch_id'] ?? ''));
    if ($batchId !== '') {
        $v = paymentLinkValidateBatchForEnrollment($db, $batchId, $leadRow, $tokenData);
        if ($v['error'] === null) {
            try {
                $u = $db->prepare(
                    'UPDATE students SET course_id = ?, batch_id = ? WHERE lead_id = ?',
                );
                $u->execute([$v['course_id'], $batchId, $leadId]);
            } catch (Throwable $e) {
                error_log('[payment_fulfillment] batch attach: ' . $e->getMessage());
            }
        } else {
            error_log('[payment_fulfillment] batch skip: ' . $v['error']);
        }
    }

    paymentLinkMarkEnrollmentApplied((string) ($row['razorpay_payment_link_id'] ?? ''));

    return [
        'ok' => true,
        'lead_id' => $leadId,
        'batch_id' => $batchId !== '' ? $batchId : null,
        'student_created' => true,
    ];
}

/**
 * Invoice email + enrollment after payment (idempotent).
 *
 * @param array<string, mixed> $row
 * @param array<string, mixed> $rzpLink
 * @param array<string, mixed>|null $paymentEntity
 * @return array<string, mixed>
 */
function paymentLinkProcessPaymentSideEffects(
    array $row,
    array $rzpLink,
    ?array $paymentEntity,
    string $eventType = 'payment_link.paid',
): array {
    $amountPaid = (int) ($rzpLink['amount_paid'] ?? $row['amount_paid'] ?? 0);
    $totalAmount = (int) ($row['amount'] ?? $rzpLink['amount'] ?? 0);
    $status = paymentLinkMapRazorpayStatus(
        (string) ($rzpLink['status'] ?? $row['status'] ?? 'created'),
        $amountPaid,
        $totalAmount,
    );

    $result = ['receipt' => null, 'enrollment' => null, 'status' => $status];

    if ($amountPaid <= 0) {
        return $result;
    }

    $receiptEvent = $eventType;
    if ($status === 'partially_paid') {
        $receiptEvent = 'payment_link.partially_paid';
    } elseif ($status === 'paid') {
        $receiptEvent = 'payment_link.paid';
    }

    if (in_array($receiptEvent, ['payment_link.paid', 'payment_link.partially_paid'], true)) {
        try {
            $result['receipt'] = paymentLinkDeliverReceipt(
                $row,
                $rzpLink,
                $paymentEntity,
                $receiptEvent,
            );
        } catch (Throwable $e) {
            error_log('[payment_fulfillment] receipt: ' . $e->getMessage());
            $result['receipt'] = ['ok' => false, 'error' => $e->getMessage()];
        }
    }

    if ($status === 'paid') {
        try {
            $result['enrollment'] = paymentLinkTryEnrollFromPayment($row, $rzpLink);
        } catch (Throwable $e) {
            error_log('[payment_fulfillment] enrollment: ' . $e->getMessage());
            $result['enrollment'] = ['ok' => false, 'error' => $e->getMessage()];
        }
    }

    return $result;
}

/**
 * Catch missed webhooks: invoice + enrollment for paid links on list load.
 *
 * @param array<int, mixed> $items
 */
function paymentLinksFulfillPaidItems(array $items, int $maxCheck = 20): void
{
    $checked = 0;
    foreach ($items as $item) {
        if ($checked >= $maxCheck) {
            break;
        }
        if (!is_array($item)) {
            continue;
        }

        $id = trim((string) ($item['id'] ?? ''));
        if ($id === '') {
            continue;
        }

        $amountPaid = (int) ($item['amount_paid'] ?? 0);
        $amount = (int) ($item['amount'] ?? 0);
        $status = paymentLinkMapRazorpayStatus(
            (string) ($item['status'] ?? 'created'),
            $amountPaid,
            $amount,
        );

        if ($amountPaid <= 0 && $status !== 'paid') {
            continue;
        }

        $row = paymentLinkFindByRazorpayId($id);
        if (!is_array($row)) {
            continue;
        }

        $needsReceipt = $amountPaid > (int) ($row['invoice_sent_for_amount_paid'] ?? 0);
        $needsEnroll = $status === 'paid' && empty($row['enrollment_applied_at']);
        if (!$needsReceipt && !$needsEnroll) {
            continue;
        }

        $checked++;
        $eventType = $status === 'paid' ? 'payment_link.paid' : 'payment_link.partially_paid';
        try {
            paymentLinkProcessPaymentSideEffects($row, $item, null, $eventType);
        } catch (Throwable $e) {
            error_log('[payment_links] fulfill paid item ' . $id . ': ' . $e->getMessage());
        }
    }
}
