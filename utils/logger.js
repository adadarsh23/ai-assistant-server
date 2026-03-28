import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pino } from "pino";
import config from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logFilePath = process.env.LOG_FILE_PATH || path.join(__dirname, "../logs/app.log");

if (config.isProduction && !fs.existsSync(path.dirname(logFilePath))) {
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
}

const baseOptions = {
  level: config.logLevel,
  base: { pid: process.pid, env: config.env },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body.password",
      "req.body.token",
      "error.details",
    ],
    remove: true,
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: (req) => ({
      method: req.method,
      url: req.url,
      id: req.id,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
};

const transport = !config.isProduction
  ? {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    }
  : undefined;

const destination = config.isProduction
  ? pino.destination({ dest: logFilePath, sync: false })
  : undefined;

export const logger = pino({ ...baseOptions, transport }, destination);
export const createLogger = (context) => logger.child({ context });
