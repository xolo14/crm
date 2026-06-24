import { Router, Request, Response } from "express";
import { sendPhaseEmail } from "../services/emailService";
import type { SendEmailRequest } from "../types/emailTypes";

const router = Router();

router.post("/phase-update", async (req: Request, res: Response) => {
  const { payload } = req.body as SendEmailRequest;

  if (!payload?.memberEmail) {
    return res.status(400).json({
      success: false,
      message: "Missing memberEmail in payload",
    });
  }

  const result = await sendPhaseEmail(payload);
  return res.status(result.success ? 200 : 500).json(result);
});

router.post("/test", async (_req: Request, res: Response) => {
  const hrEmail = process.env.SMTP_USER;
  if (!hrEmail) {
    return res.status(500).json({
      success: false,
      message: "SMTP_USER is not configured",
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const result = await sendPhaseEmail({
    memberName: "Test User",
    memberEmail: hrEmail,
    memberRole: "Sales Executive",
    joiningDate: today,
    phase: {
      phaseNumber: 1,
      phaseName: "Training",
      dayInPhase: 10,
      totalDaysInPhase: 15,
      startDate: today,
      endDate: today,
      isPhaseComplete: false,
    },
    target: {
      monthlyTarget: 160_000,
      achieved: 80_000,
      remaining: 80_000,
      achievementPct: 50,
    },
    totalCalls: 45,
    totalDemos: 12,
    totalFollowUps: 30,
    totalEnrolled: 3,
    triggerDay: 10,
    sentAt: new Date().toISOString(),
  });

  return res.status(result.success ? 200 : 500).json(result);
});

export default router;
