import nodemailer from "nodemailer";
import dotenv from "dotenv";
import type { PhaseEmailPayload, SendEmailResponse } from "../types/emailTypes";
import { getEmailSubject, getEmailHTML } from "../templates/phaseEmailTemplates";

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendPhaseEmail(
  payload: PhaseEmailPayload,
): Promise<SendEmailResponse> {
  try {
    await transporter.verify();

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: payload.memberEmail,
      cc: process.env.SMTP_USER,
      subject: getEmailSubject(payload),
      html: getEmailHTML(payload),
    });

    console.log(
      `[EMAIL SENT] to:${payload.memberEmail} id:${info.messageId}`,
    );

    return {
      success: true,
      message: "Email sent successfully",
      messageId: info.messageId,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to send email";
    console.error("[EMAIL ERROR]", message);
    return {
      success: false,
      message,
    };
  }
}
