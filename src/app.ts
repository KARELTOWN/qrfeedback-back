import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.routes.js';
import companyRoutes from './routes/company.routes.js';
import reviewRoutes from './routes/review.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import adminRoutes from './routes/admin.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import planRoutes from './routes/plan.routes.js';
import secretRoutes from './routes/secret.routes.js';
import qrCodeRoutes from './routes/qrcode.routes.js';
import whatsappConfigRoutes from './routes/whatsappConfig.routes.js';
import whatsappWebhookRoutes from './routes/whatsappWebhook.routes.js';
import segmentRoutes from './routes/segment.routes.js';
import inboxRoutes from './routes/inbox.routes.js';
import automationRoutes from './routes/automation.routes.js';

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.frontendUrl, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/secrets', secretRoutes);
app.use('/api/qrcodes', qrCodeRoutes);
app.use('/api/whatsapp', whatsappConfigRoutes);
app.use('/api/webhooks/whatsapp', whatsappWebhookRoutes);
app.use('/api/segments', segmentRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/automations', automationRoutes);

app.use(errorHandler);
