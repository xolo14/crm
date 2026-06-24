import crypto from "crypto";
import type { Request, Response } from "express";

/** Augment Express Request with rawBody used by the webhook route. */
declare module "express-serve-static-core" {
  interface Request {
    rawBody?: string;
  }
}

function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

export async function handleRazorpayWebhook(req: Request, res: Response) {
  const signature = String(req.headers["x-razorpay-signature"] ?? "");
  const rawBody = req.rawBody ?? "";

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn("[WEBHOOK] Invalid signature");
    return res.status(400).json({ error: "Invalid signature" });
  }

  const event = req.body as {
    event?: string;
    payload?: {
      payment_link?: { entity?: Record<string, unknown> };
      payment?: { entity?: Record<string, unknown> };
    };
  };
  console.log("[WEBHOOK] Event:", event.event);

  switch (event.event) {
    case "payment_link.paid": {
      const pl = event.payload?.payment_link?.entity ?? {};
      console.log(
        `[WEBHOOK] Payment link PAID: ${pl.id} ` +
          `INR${Number(pl.amount_paid ?? 0) / 100} ` +
          `by ${(pl.customer as { name?: string } | undefined)?.name ?? "-"}`,
      );
      // TODO: persist to DB if/when DB is wired in.
      break;
    }
    case "payment_link.expired": {
      const pl = event.payload?.payment_link?.entity ?? {};
      console.log(`[WEBHOOK] Payment link EXPIRED: ${pl.id}`);
      break;
    }
    case "payment_link.cancelled": {
      const pl = event.payload?.payment_link?.entity ?? {};
      console.log(`[WEBHOOK] Payment link CANCELLED: ${pl.id}`);
      break;
    }
    case "payment.captured": {
      const p = event.payload?.payment?.entity ?? {};
      console.log(
        `[WEBHOOK] Payment CAPTURED: ${p.id} INR${Number(p.amount ?? 0) / 100}`,
      );
      break;
    }
    default:
      console.log(`[WEBHOOK] Unhandled event: ${event.event}`);
  }

  return res.status(200).json({ received: true });
}
