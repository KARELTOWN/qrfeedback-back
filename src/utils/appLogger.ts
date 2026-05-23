type LogData = Record<string, unknown>;

function serialize(data?: LogData) {
  if (!data) return '';
  try {
    return ` ${JSON.stringify(data)}`;
  } catch {
    return ` ${String(data)}`;
  }
}

export const appLogger = {
  info(scope: string, message: string, data?: LogData) {
    console.log(`[${new Date().toISOString()}] [${scope}] ${message}${serialize(data)}`);
  },
  warn(scope: string, message: string, data?: LogData) {
    console.warn(`[${new Date().toISOString()}] [${scope}] ${message}${serialize(data)}`);
  },
  error(scope: string, message: string, data?: LogData) {
    console.error(`[${new Date().toISOString()}] [${scope}] ${message}${serialize(data)}`);
  }
};
