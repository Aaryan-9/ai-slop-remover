interface Logger {
  error(message: unknown): void;
}

declare const logger: Logger;

export async function runNightlyJob(job: () => Promise<void>) {
  try {
    await job();
  } catch (error) {}
}

export async function runWeeklyJob(job: () => Promise<void>) {
  try {
    await job();
  } catch (error) {
    console.log(error);
  }
}

export async function runAuditedJob(job: () => Promise<void>) {
  try {
    await job();
  } catch (error) {
    logger.error(error);
    throw error;
  }
}
