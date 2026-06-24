import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import emailRoutes from "./routes/email.routes";
import paymentLinksRoutes from "./routes/paymentLinks.routes";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(
  cors({
    origin: process.env.CLIENT_URL ?? "http://localhost:5173",
  }),
);
app.use(express.json());

app.use("/api/email", emailRoutes);
app.use("/api/payment-links", paymentLinksRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "SYNCPedia Email API" });
});

app.listen(PORT, () => {
  console.log(`[SERVER] Email API running on port ${PORT}`);
});
