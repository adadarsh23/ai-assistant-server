import dotenv from "dotenv";

dotenv.config();

function requireString(name, { defaultValue, allowEmpty = false } = {}) {
  const value = process.env[name] ?? defaultValue;

  if (value === undefined || (!allowEmpty && String(value).trim() === "")) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return String(value).trim();
}

function optionalString(name, defaultValue = "") {
  const value = process.env[name];
  return value === undefined ? defaultValue : String(value).trim();
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseAllowedOrigins(rawOrigins) {
  const defaults = ["https://adadarsh23.netlify.app"];
  const configured = rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [...new Set([...defaults, ...configured])];
}

function parseCsv(rawValue) {
  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const env = optionalString("NODE_ENV", "development") || "development";

const config = Object.freeze({
  env,
  isDevelopment: env === "development",
  isProduction: env === "production",
  port: parseNumber(process.env.PORT, 5000),
  apiKey: requireString("VITE_GOOGLE_API_KEY"),
  serverApiToken: optionalString("SERVER_API_TOKEN", ""),
  renderServiceId: optionalString("RENDER_SERVICE_ID", ""),
  renderOutboundIps: parseCsv(optionalString("RENDER_OUTBOUND_IPS", "")),
  modelId: optionalString("GEMINI_MODEL", "gemini-1.5-flash"),
  mongoUri: optionalString("MONGO_URI", ""),
  mongoDbName: optionalString("MONGO_DB_NAME", "defaultDB"),
  logLevel: optionalString("LOG_LEVEL", env === "production" ? "info" : "debug"),
  maxRequestSize: optionalString("MAX_REQUEST_SIZE", "1mb"),
  requestTimeoutMs: parseNumber(process.env.REQUEST_TIMEOUT_MS, 30000),
  retryAttempts: parseNumber(process.env.RETRY_ATTEMPTS, 3),
  allowedOrigins: parseAllowedOrigins(optionalString("FRONTEND_URL", "")),
  trustProxy: parseBoolean(process.env.TRUST_PROXY, true),
  globalRateLimitWindowMs: parseNumber(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS, 60000),
  globalRateLimitMax: parseNumber(process.env.GLOBAL_RATE_LIMIT_MAX, 120),
  geminiRateLimitWindowMs: parseNumber(process.env.GEMINI_RATE_LIMIT_WINDOW_MS, 60000),
  geminiRateLimitMax: parseNumber(process.env.GEMINI_RATE_LIMIT_MAX, 30),
  enableDbPersistence: parseBoolean(process.env.ENABLE_DB_PERSISTENCE, true),
});

export default config;
