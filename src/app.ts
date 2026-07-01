import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { getHealthStatus } from "./services/health.service.js";
import authRoutes from "./routes/auth.routes.js";
import companyRoutes from "./routes/company.routes.js";
import reviewRoutes from "./routes/review.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import planRoutes from "./routes/plan.routes.js";
import secretRoutes from "./routes/secret.routes.js";
import qrCodeRoutes from "./routes/qrcode.routes.js";
import telegramRoutes from "./routes/telegram.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import analysisRoutes from './routes/analysis.routes.js';
import testimonialsRoutes from './routes/testimonials.routes.js';

export const app = express();

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("CORS origin not allowed."));
  },
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/health/details", async (req, res) => {
  const health = await getHealthStatus();
  res.status(health.ok ? 200 : 503).json(health);
});

app.use("/api/auth", authRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/secrets", secretRoutes);
app.use("/api/qrcodes", qrCodeRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/webhooks/telegram", telegramRoutes);
app.use('/api/public/testimonials', testimonialsRoutes);
app.use('/api', analysisRoutes);

app.use(errorHandler);
