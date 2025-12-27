// server/config.js
import dotenv from "dotenv";
import { URL } from "url";

dotenv.config();

function validateEnvVar(key, value, required = true) {
  if (required && (!value || value.trim() === "")) {
    throw new Error(`❌ Missing required environment variable: ${key}`);
  }
  return value;
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  return ["true", "1"].includes(value.toString().toLowerCase());
}

function parseIntEnv(value, defaultValue) {
  const n = parseInt(value, 10);
  return isNaN(n) ? defaultValue : n;
}

function parseUrl(value, defaultValue = null) {
  if (!value) return defaultValue;
  try {
    return new URL(value).toString();
  } catch (err) {
    console.warn(`⚠️ Invalid URL in environment variable: ${value}. Using default.`);
    return defaultValue;
  }
}

// ==============================
// ✅ CONFIGURATION
// ==============================
const config = Object.freeze({
  env: process.env.NODE_ENV || "production",
  port: parseIntEnv(process.env.PORT, 5000),
  apiKey: validateEnvVar("VITE_GOOGLE_API_KEY", process.env.VITE_GOOGLE_API_KEY),
  modelId: process.env.GEMINI_MODEL || "gemini-1.5-flash",
  mongoUri: validateEnvVar("MONGO_URI", process.env.MONGO_URI),
  frontendUrl: parseUrl(process.env.FRONTEND_URL),
  logLevel: process.env.LOG_LEVEL || "info",
  enableDebug: parseBoolean(process.env.ENABLE_DEBUG, false),
  maxRequestSize: process.env.MAX_REQUEST_SIZE || "1tb",
  retryAttempts: parseIntEnv(process.env.RETRY_ATTEMPTS, 3),
});

export const getConfig = (key, defaultValue = undefined) => {
  return config[key] ?? defaultValue;
};

export default config;
