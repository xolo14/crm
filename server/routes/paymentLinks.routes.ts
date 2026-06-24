import express, { Router, type Request, type Response } from "express";
import {
  cancelPaymentLink,
  createPaymentLink,
  fetchAllPaymentLinks,
  fetchPaymentLink,
  sendReminder,
} from "../services/paymentLinkService";
import { handleRazorpayWebhook } from "../webhooks/razorpay.webhook";
import { handleCreatePaymentLink } from "./payment-links/create";

const router = Router();

/**
 * NOTE: This router is mounted at /api/payment-links in server/index.ts.
 * There is intentionally NO auth on these endpoints — wire in your auth
 * middleware here (e.g. `router.use(authMiddleware)`) once it exists.
 */

// ── GET /api/payment-links — list with filters ──────────────
router.get("/", async (req: Request, res: Response) => {
  try {
    const { from, to, status, count, skip } = req.query;
    const result = await fetchAllPaymentLinks({
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
      status: typeof status === "string" && status ? status : undefined,
      count: count ? Number(count) : 25,
      skip: skip ? Number(skip) : 0,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[API] GET /payment-links", message);
    return res.status(500).json({ success: false, error: message });
  }
});

// ── POST /api/payment-links — create ───────────────────────
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      amount,
      description,
      customerName,
      customerEmail,
      customerPhone,
      referenceId,
      expireBy,
      referralCode,
      notes,
    } = req.body ?? {};

    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "amount is required and must be > 0",
      });
    }
    if (!customerName || !customerEmail) {
      return res.status(400).json({
        success: false,
        error: "customerName and customerEmail required",
      });
    }

    const mergedNotes =
      notes && typeof notes === "object"
        ? { ...(notes as Record<string, string>) }
        : {};
    if (typeof referralCode === "string" && referralCode.trim()) {
      mergedNotes.crm_referral = referralCode.trim();
    }

    const link = await createPaymentLink({
      amount,
      description,
      customerName,
      customerEmail,
      customerPhone,
      referenceId: referenceId || `SYNC-${Date.now()}`,
      expireBy,
      notes: mergedNotes,
    });
    return res.status(201).json({ success: true, data: link });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[API] POST /payment-links", message);
    return res.status(500).json({ success: false, error: message });
  }
});

// ── POST /api/payment-links/create — Standard Payment Link ──
router.post("/create", handleCreatePaymentLink);

// ── POST /api/payment-links/webhook ─ raw body for signature ─
// Mounted BEFORE the parameterised "/:id" routes so it isn't shadowed.
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req: Request, res: Response) => {
    const buf = req.body as Buffer;
    req.rawBody = buf.toString("utf8");
    try {
      req.body = JSON.parse(req.rawBody);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
    return handleRazorpayWebhook(req, res);
  },
);

// ── GET /api/payment-links/:id ─────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const link = await fetchPaymentLink(String(req.params.id));
    return res.json({ success: true, data: link });
  } catch {
    return res
      .status(404)
      .json({ success: false, error: "Payment link not found" });
  }
});

// ── POST /api/payment-links/:id/cancel ─────────────────────
router.post("/:id/cancel", async (req: Request, res: Response) => {
  try {
    const result = await cancelPaymentLink(String(req.params.id));
    return res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: message });
  }
});

// ── POST /api/payment-links/:id/remind ─────────────────────
router.post("/:id/remind", async (req: Request, res: Response) => {
  try {
    const mediumRaw = (req.body?.medium ?? "email") as string;
    const medium: "sms" | "email" =
      mediumRaw === "sms" ? "sms" : "email";
    const result = await sendReminder(String(req.params.id), medium);
    return res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
