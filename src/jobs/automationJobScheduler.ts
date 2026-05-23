import cron from 'node-cron';
import { AutomationJob } from '../models/AutomationJob.js';
import { executeAutomationStep } from '../services/automationStepExecutor.service.js';
import { appLogger } from '../utils/appLogger.js';

function retryRunAt(attempts: number) {
  return new Date(Date.now() + Math.min(60_000 * attempts, 5 * 60_000));
}

export function startAutomationJobScheduler() {
  cron.schedule('* * * * *', () => {
    processDueAutomationJobs().catch((error) => console.error('Automation job scheduler error', error));
  });
  appLogger.info('automation:scheduler', 'started');
}

export async function processDueAutomationJobs(now = new Date()) {
  const jobs = await AutomationJob.find({
    status: 'queued',
    runAt: { $lte: now }
  }).sort({ runAt: 1 }).limit(25);
  if (jobs.length) appLogger.info('automation:scheduler', 'processing due jobs', { count: jobs.length });

  for (const job of jobs) {
    job.status = 'processing';
    job.lockedAt = new Date();
    job.attempts += 1;
    await job.save();

    try {
      const payload = (job.payload || {}) as Record<string, unknown>;
      appLogger.info('automation:job', 'execute', {
        jobId: String(job._id),
        executionId: String(job.execution),
        type: job.type,
        attempts: job.attempts,
        stepKey: payload.stepKey
      });
      await executeAutomationStep(String(job.execution), payload.stepKey ? String(payload.stepKey) : undefined);
      job.status = 'completed';
      job.completedAt = new Date();
      await job.save();
      appLogger.info('automation:job', 'completed', { jobId: String(job._id) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appLogger.error('automation:job', 'failed', { jobId: String(job._id), message });
      job.lastError = { message };
      if (job.attempts >= job.maxAttempts) {
        job.status = 'failed';
        job.failedAt = new Date();
      } else {
        job.status = 'queued';
        job.runAt = retryRunAt(job.attempts);
      }
      await job.save();
    }
  }
}
