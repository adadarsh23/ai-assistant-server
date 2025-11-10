// server/utils/logger.js
import { pino } from "pino";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import pkg from 'lodash';
const { parseInt } = pkg;

// Resolve __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read env variables
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const ENV = process.env.NODE_ENV || "production";
const LOG_FILE_PATH = process.env.LOG_FILE_PATH || path.join(__dirname, "../logs/app.log");

// Ensure logs folder exists
if (ENV === "production" && !fs.existsSync(path.dirname(LOG_FILE_PATH))) {
  fs.mkdirSync(path.dirname(LOG_FILE_PATH), { recursive: true });
}

// Base pino options
const baseOptions = {
  level: LOG_LEVEL,
  base: { pid: process.pid, env: ENV },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  redact: ["req.headers.authorization", "req.headers.cookie"], // hide sensitive info
  serializers: {
    err: pino.stdSerializers.err,
    req: (req) => ({
      method: req.method,
      url: req.url,
      headers: req.headers,
      id: req.id
    }),
    res: (res) => ({
      statusCode: res.statusCode,
      headers: res.getHeaders()
    })
  }
};

// Transport options for development
const transport = ENV !== "production" ? {
  target: "pino-pretty",
  options: {
    colorize: true,
    translateTime: "SYS:standard",
    ignore: "pid,hostname"
  }
} : undefined;

// Optional file logging in production
const destination = ENV === "production" ? pino.destination({ dest: LOG_FILE_PATH, sync: false }) : undefined;

// Create the logger
export const logger = pino({ ...baseOptions, transport }, destination);

// Helper to create child loggers for modules
export const createLogger = (context) => logger.child({ context });

