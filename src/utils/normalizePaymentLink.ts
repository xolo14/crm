import type {
  PaymentLinkStatus,
  PaymentLinksListResult,
  RazorpayPaymentLink,
  RazorpayPayment,
} from "@/types/paymentLinks";

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function normalizePayment(raw: unknown): RazorpayPayment | null {
  const p = asRecord(raw);
  if (!p.payment_id && !p.id) return null;
  return {
    payment_id: String(p.payment_id ?? p.id ?? ""),
    amount: Number(p.amount ?? 0),
    status: String(p.status ?? ""),
    created_at: Number(p.created_at ?? 0),
    method: String(p.method ?? ""),
  };
}

/** Map Razorpay API shape → app model (handles snake_case & partial payloads). */
export function normalizePaymentLink(raw: unknown): RazorpayPaymentLink {
  const r = asRecord(raw);
  const customer = asRecord(r.customer);
  const notesRaw = r.notes;
  const notes: Record<string, string> = {};
  if (notesRaw && typeof notesRaw === "object" && !Array.isArray(notesRaw)) {
    for (const [k, v] of Object.entries(notesRaw as Record<string, unknown>)) {
      if (v !== null && v !== undefined) notes[k] = String(v);
    }
  }

  const payments: RazorpayPayment[] = [];
  if (Array.isArray(r.payments)) {
    for (const p of r.payments) {
      const norm = normalizePayment(p);
      if (norm) payments.push(norm);
    }
  }

  const status = String(r.status ?? "created") as PaymentLinkStatus;

  return {
    id: String(r.id ?? ""),
    amount: Number(r.amount ?? 0),
    amount_paid: Number(r.amount_paid ?? 0),
    currency: String(r.currency ?? "INR"),
    description: String(r.description ?? ""),
    status: ["created", "partially_paid", "paid", "cancelled", "expired"].includes(
        status,
      )
      ? status
      : "created",
    short_url: String(r.short_url ?? ""),
    created_at: Number(r.created_at ?? 0),
    expire_by: r.expire_by ? Number(r.expire_by) : undefined,
    reference_id: String(r.reference_id ?? ""),
    customer: {
      name: String(customer.name ?? ""),
      email: String(customer.email ?? ""),
      contact: String(customer.contact ?? ""),
    },
    payments: payments.length > 0 ? payments : undefined,
    notes,
    reminder_enable: Boolean(r.reminder_enable),
  };
}

export function normalizePaymentLinksList(
  data: unknown,
): PaymentLinksListResult {
  const d = asRecord(data);
  const itemsRaw = Array.isArray(d.items)
    ? d.items
    : Array.isArray(d.payment_links)
      ? d.payment_links
      : Array.isArray(data)
        ? data
        : [];

  const items = itemsRaw
    .map(normalizePaymentLink)
    .filter((l) => l.id !== "");

  return {
    entity: String(d.entity ?? "collection"),
    count: Number(d.count ?? items.length),
    items,
  };
}

/** Invoice / reference display for table */
export function paymentLinkInvoiceLabel(link: RazorpayPaymentLink): string {
  if (link.reference_id?.trim()) return link.reference_id.trim();
  const paid = link.payments?.[link.payments.length - 1];
  if (paid?.payment_id) return paid.payment_id;
  return link.id ? link.id.replace(/^plink_/, "INV-") : "—";
}

export function paymentLinkReferralCode(
  link: RazorpayPaymentLink,
): string {
  return (
    link.notes?.crm_referral ??
    link.notes?.referral_code ??
    ""
  );
}

export function paymentLinkSalespersonId(
  link: RazorpayPaymentLink,
): string {
  return (link.notes?.salesperson_id ?? "").trim();
}

export interface PaymentLinkCreatorInfo {
  id: string;
  full_name: string;
  email: string;
  referral_code: string;
  role: string;
}

export interface TeamMemberLookup {
  id: string;
  full_name: string;
  email?: string;
  referral_code?: string;
  role?: string;
}

/** Resolve CRM member who created the link (notes.salesperson_id or referral match). */
export function resolvePaymentLinkCreator(
  link: RazorpayPaymentLink,
  team: TeamMemberLookup[],
): PaymentLinkCreatorInfo {
  const byId = new Map(team.map((m) => [String(m.id), m]));
  const salespersonId = paymentLinkSalespersonId(link);

  if (salespersonId && byId.has(salespersonId)) {
    const m = byId.get(salespersonId)!;
    return {
      id: String(m.id),
      full_name: m.full_name || m.email || "Team member",
      email: m.email ?? "",
      referral_code: m.referral_code ?? paymentLinkReferralCode(link),
      role: m.role ?? "",
    };
  }

  const ref = paymentLinkReferralCode(link);
  if (ref) {
    const byRef = team.find(
      (m) => (m.referral_code ?? "").trim().toUpperCase() === ref.toUpperCase(),
    );
    if (byRef) {
      return {
        id: String(byRef.id),
        full_name: byRef.full_name || byRef.email || "Team member",
        email: byRef.email ?? "",
        referral_code: byRef.referral_code ?? ref,
        role: byRef.role ?? "",
      };
    }
  }

  const noteName = (link.notes?.salesperson_name ?? "").trim();
  return {
    id: salespersonId,
    full_name: noteName || (salespersonId ? "Former member" : "—"),
    email: "",
    referral_code: ref,
    role: "",
  };
}

export interface PaymentRecordRow {
  link: RazorpayPaymentLink;
  creator: PaymentLinkCreatorInfo;
}

export function buildPaymentRecords(
  links: RazorpayPaymentLink[],
  team: TeamMemberLookup[],
): PaymentRecordRow[] {
  return links.map((link) => ({
    link,
    creator: resolvePaymentLinkCreator(link, team),
  }));
}

/** Aggregated payment-link stats per team member. */
export interface MemberPaymentSummary {
  creator: PaymentLinkCreatorInfo;
  totalLinks: number;
  paidCount: number;
  partialCount: number;
  /** Links that received at least one payment (amount_paid > 0). */
  paymentsReceivedCount: number;
  totalCollectedPaise: number;
}

export function buildMemberPaymentSummaries(
  records: PaymentRecordRow[],
): MemberPaymentSummary[] {
  const map = new Map<string, MemberPaymentSummary>();

  for (const { link, creator } of records) {
    const key = creator.id || creator.full_name || "unknown";
    const cur =
      map.get(key) ??
      ({
        creator,
        totalLinks: 0,
        paidCount: 0,
        partialCount: 0,
        paymentsReceivedCount: 0,
        totalCollectedPaise: 0,
      } satisfies MemberPaymentSummary);

    cur.totalLinks += 1;
    if (link.status === "paid") cur.paidCount += 1;
    if (link.status === "partially_paid") cur.partialCount += 1;
    if (link.amount_paid > 0) {
      cur.paymentsReceivedCount += 1;
      cur.totalCollectedPaise += link.amount_paid;
    }
    map.set(key, cur);
  }

  return [...map.values()].sort((a, b) => {
    if (b.totalCollectedPaise !== a.totalCollectedPaise) {
      return b.totalCollectedPaise - a.totalCollectedPaise;
    }
    return b.totalLinks - a.totalLinks;
  });
}
