import type { Request, Response } from "express";
import { createStandardPaymentLink } from "../../services/paymentLinkService";

/**
 * POST /api/payment-links/create
 * Body matches Razorpay Standard Payment Link (amount in paise).
 */
export async function handleCreatePaymentLink(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const body = req.body ?? {};
    const errors: string[] = [];

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 100) {
      errors.push("amount must be at least ₹1 (100 paise)");
    }

    const customer = body.customer ?? {};
    const name = typeof customer.name === "string" ? customer.name.trim() : "";
    if (!name) errors.push("customer.name is required");

    const email =
      typeof customer.email === "string" ? customer.email.trim() : "";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push("customer.email is invalid");
    }

    const acceptPartial = body.accept_partial === true;
    const minPartial = Number(body.first_min_partial_amount);
    if (acceptPartial) {
      if (!Number.isFinite(minPartial) || minPartial < 100) {
        errors.push("first_min_partial_amount must be at least ₹1");
      } else if (minPartial >= amount) {
        errors.push("minimum partial amount must be less than total amount");
      }
    }

    const expireBy = body.expire_by != null ? Number(body.expire_by) : undefined;
    if (expireBy != null && Number.isFinite(expireBy)) {
      if (expireBy <= Math.floor(Date.now() / 1000)) {
        errors.push("expire_by must be a future date");
      }
    }

    const userNotes =
      body.notes && typeof body.notes === "object"
        ? (body.notes as Record<string, string>)
        : {};

    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const link = await createStandardPaymentLink({
      amount,
      currency: "INR",
      description:
        typeof body.description === "string" ? body.description : undefined,
      customer: {
        name,
        email: email || undefined,
        contact:
          typeof customer.contact === "string"
            ? customer.contact
            : undefined,
      },
      notify: {
        sms: body.notify?.sms === true,
        email: body.notify?.email === true,
      },
      reminder_enable: body.reminder_enable === true,
      expire_by: expireBy,
      reference_id:
        typeof body.reference_id === "string"
          ? body.reference_id.trim() || undefined
          : undefined,
      accept_partial: acceptPartial,
      first_min_partial_amount: acceptPartial ? minPartial : undefined,
      notes: userNotes,
    });

    return res.status(201).json({ success: true, data: link });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[API] POST /payment-links/create", message);
    return res.status(500).json({ success: false, error: message });
  }
}
