
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import hpp from "hpp";
import compression from "compression";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import pinoHttp from "pino-http";
import { logger } from "./utils/logger.js";
import chalk from "chalk";
import mongoose from "mongoose";
import os from "os";

import geminiRoute from "./routes/gemini.js";
import { respond } from "./utils/response.js";
import { getSuggestions } from "./utils/suggestions.js";
import { fetchWithRetry } from "./utils/fetch.js";
import { connectToDatabase } from "./db.js";

dotenv.config();

// ===== CONFIG =====
const ENV = process.env.NODE_ENV || "production";
const PORT = process.env.PORT || 5000;
const API_KEY = process.env.VITE_GOOGLE_API_KEY;
const MODEL_ID = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const FRONTEND_URLS = [
  "https://adadarsh23.netlify.app", // Your frontend URL
  ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(",") : [])
];
const MONGO_URI = process.env.MONGO_URI;

if (!API_KEY) {
  logger.error("❌ Missing VITE_GOOGLE_API_KEY. Exiting...");
  process.exit(1);
}

// ===== EXPRESS APP =====
const app = express();

// Trust the first proxy in front of the app (e.g., on Render, Heroku)
// This is required for express-rate-limit to work correctly.
app.set("trust proxy", 1);

// ===== SECURITY & PERFORMANCE =====
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(hpp());
app.use(cors({
  origin: FRONTEND_URLS,
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"]
}));
app.use(compression());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// ===== LOGGER =====
app.use(pinoHttp({
  logger,
  genReqId: () => crypto.randomBytes(8).toString("hex"),
}));

// ===== RATE LIMITING =====
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests. Slow down.", retryAfter: "60s" }
});
const geminiLimiter = rateLimit({
  windowMs: 30 * 1000,
  max: 100000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Gemini API rate limit exceeded. Wait a bit." }
});

app.use("/api", globalLimiter);
app.use("/api/gemini", geminiLimiter);

// ===== HEALTH & DIAGNOSTICS =====
app.get("/", (req, res) => respond(res, 200, {
  success: true,
  message: "🚀 Gemini Proxy Active",
  version: "2.5.0",
  environment: ENV,
  endpoints: { health: "/health", status: "/api/status", gemini: "/api/gemini" }
}));

app.get("/health", (req, res) => {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const cpus = os.cpus();

  respond(res, 200, {
    success: true,
    uptime: `${Math.floor(uptime)}s`,
    memory: {
      rss: `${Math.round(mem.rss / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)} MB`
    },
    loadAverage: process.platform !== "win32" ? process.loadavg() : "N/A on Windows",
    cpuCores: cpus.length,
    cpuModel: cpus[0]?.model || "N/A",
    dbStatus: MONGO_URI ? (mongoose.connection.readyState === 1 ? "connected" : "disconnected") : "disabled",
    timestamp: new Date().toISOString()
  });
});

// ===== API STATUS CHECK =====
app.get("/api/status", async (req, res) => {
  const start = Date.now();
  try {
    const test = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}?key=${API_KEY}`);
    const latency = Date.now() - start;

    if (!test.ok) {
      const errTxt = await test.text();
      return respond(res, 503, {
        success: false,
        geminiApi: "disconnected",
        latency: `${latency}ms`,
        error: errTxt.slice(0, 300),
        suggestions: getSuggestions(test.status)
      });
    }

    respond(res, 200, {
      success: true,
      geminiApi: "connected",
      model: MODEL_ID,
      latency: `${latency}ms`
    });
  } catch (err) {
    respond(res, 503, { success: false, geminiApi: "error", error: err.message });
  }
});

// ===== GEMINI ROUTE =====
app.use("/api/gemini", geminiRoute);

// ===== 404 HANDLER =====
app.use((req, res) => respond(res, 404, {
  success: false,
  error: "Route not found",
  method: req.method,
  path: req.originalUrl,
  message: "This endpoint does not exist.",
  available: ["GET /", "GET /health", "GET /api/status", "POST /api/gemini"]
}));

// ===== GLOBAL ERROR HANDLER =====
app.use((err, req, res, next) => {
  req.log?.error({ err }, "🔥 Uncaught Error");
  respond(res, err.status || 500, {
    success: false,
    error: "Unexpected server error",
    details: ENV === "development" ? err.message : undefined
  });
});

// ===== GRACEFUL SHUTDOWN =====
let server;
const shutdown = async (signal) => {
  logger.info(`⚠️ ${signal} received. Cleaning up...`);
  server.close(async () => {
    logger.info("✅ HTTP server closed");
    if (MONGO_URI) {
      try { await mongoose.connection.close(); logger.info("✅ MongoDB closed"); }
      catch (err) { logger.error({ err }, "❌ Error closing DB"); }
    }
    process.exit(0);
  });
};
["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"].forEach(sig => {
  process.on(sig, (err) => shutdown(sig));
});

// ===== START SERVER =====
(async () => {
  await connectToDatabase();

  server = app.listen(PORT, () => {
    const banner = [
      "🚀 Gemini Proxy Server",
      `Mode: ${ENV}`,
      `URL: http://localhost:${PORT}`,
      `Model: ${MODEL_ID}`,
      `Database: ${MONGO_URI ? "Connected" : "Disabled"}`,
      "Endpoints: GET /health | GET /api/status | POST /api/gemini"
    ];

    console.log(chalk.cyan("╔" + "═".repeat(65) + "╗"));
    banner.forEach(line => console.log(chalk.cyan("║ ") + line.padEnd(63) + chalk.cyan(" ║")));
    console.log(chalk.cyan("╚" + "═".repeat(65) + "╝"));

    // Performance tuning
    server.keepAliveTimeout = 61 * 1000;
    server.headersTimeout = 65 * 1000;
  });
})();
