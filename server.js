import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import hpp from "hpp";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";

import config from "./config.js";
import { getApiStatus } from "./controllers/geminiController.js";
import { connectToDatabase, disconnectDatabase } from "./db.js";
import { asyncHandler } from "./middleware/asyncHandler.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestContext } from "./middleware/requestContext.js";
import geminiRoute from "./routes/gemini.js";
import { logger } from "./utils/logger.js";
import { sendError, sendSuccess } from "./utils/response.js";

const app = express();
let server;

if (config.trustProxy) {
  app.set("trust proxy", 1);
}

function corsOriginHandler(origin, callback) {
  if (!origin || config.allowedOrigins.includes(origin)) {
    return callback(null, true);
  }

  return callback(new Error("CORS origin denied"));
}

function rateLimitHandler(message, code) {
  return (req, res) =>
    sendError(res, 429, message, {
      error: { code },
      meta: {
        retryAfterSeconds:
          req.rateLimit?.resetTime instanceof Date
            ? Math.max(1, Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000))
            : 60,
      },
    });
}

function requireApiToken(req, res, next) {
  const publicOrigin = "https://adadarsh23.netlify.app";
  const requestOrigin = String(req.headers.origin || "").replace(/\/$/, "");

  // Allow browser requests from the trusted frontend without an API token.
  if (requestOrigin === publicOrigin) {
    return next();
  }

  if (!config.serverApiToken) {
    return next();
  }

  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const providedToken = bearerToken || req.headers["x-api-token"];

  if (!providedToken) {
    return sendError(res, 401, "Authentication is required", {
      error: { code: "AUTH_REQUIRED" },
    });
  }

  if (providedToken !== config.serverApiToken) {
    return sendError(res, 403, "You are not authorized to access this resource", {
      error: { code: "AUTH_FORBIDDEN" },
    });
  }

  return next();
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (value && typeof value === "object") {
    const sanitizedEntries = Object.entries(value)
      .filter(([key]) => !key.startsWith("$") && !key.includes("."))
      .map(([key, nestedValue]) => [key, sanitizeValue(nestedValue)]);

    return Object.fromEntries(sanitizedEntries);
  }

  return value;
}

function sanitizeRequest(req, res, next) {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeValue(req.body);
  }

  if (req.params && typeof req.params === "object") {
    req.params = sanitizeValue(req.params);
  }

  return next();
}

app.disable("x-powered-by");
app.use(requestContext);
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.id,
  }),
);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(hpp());
app.use(
  cors({
    origin: corsOriginHandler,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
  }),
);
app.use(compression());
app.use(express.json({ limit: config.maxRequestSize }));
app.use(express.urlencoded({ extended: true, limit: config.maxRequestSize }));
app.use(sanitizeRequest);

const globalLimiter = rateLimit({
  windowMs: config.globalRateLimitWindowMs,
  max: config.globalRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("Too many requests", "RATE_LIMIT_EXCEEDED"),
});

const geminiLimiter = rateLimit({
  windowMs: config.geminiRateLimitWindowMs,
  max: config.geminiRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("Gemini rate limit reached", "GEMINI_RATE_LIMIT_EXCEEDED"),
});

app.use("/api", globalLimiter);
app.use("/api", requireApiToken);
app.use("/api/gemini", geminiLimiter);

app.get("/", (req, res) =>
  sendSuccess(res, 200, "Gemini proxy server is running", {
    environment: config.env,
    version: "3.0.0",
    endpoints: {
      health: "/health",
      status: "/api/status",
      gemini: "/api/gemini",
    },
  }),
);

app.get("/health", (req, res) => {
  const memory = process.memoryUsage();

  return sendSuccess(res, 200, "Server is healthy", {
    uptimeSeconds: Math.floor(process.uptime()),
    memory: {
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
    },
    database: config.mongoUri && config.enableDbPersistence ? "configured" : "disabled",
  });
});

app.get("/api/status", asyncHandler(getApiStatus));
app.use("/api/gemini", geminiRoute);

app.use((error, req, res, next) => {
  if (error?.message === "CORS origin denied") {
    return sendError(res, 403, "Origin is not allowed", {
      error: { code: "CORS_DENIED" },
    });
  }

  return next(error);
});

app.use(notFoundHandler);
app.use(errorHandler);

async function shutdown(signal, error) {
  if (error) {
    logger.error({ err: error, signal }, "Fatal signal received");
  } else {
    logger.info({ signal }, "Shutdown signal received");
  }

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  await disconnectDatabase();
}

async function startServer() {
  await connectToDatabase();

  server = app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        environment: config.env,
        model: config.modelId,
        dbEnabled: Boolean(config.mongoUri && config.enableDbPersistence),
        renderServiceId: config.renderServiceId || undefined,
        renderOutboundIpCount: config.renderOutboundIps.length,
      },
      "Server started",
    );
  });

  // Keep connections alive without an idle timeout so upstream clients can reuse them.
  server.keepAliveTimeout = 0;
  server.headersTimeout = 0;
  server.requestTimeout = 0;
  server.timeout = 0;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await shutdown(signal);
    process.exit(0);
  });
}

process.on("uncaughtException", async (error) => {
  await shutdown("uncaughtException", error);
  process.exit(1);
});

process.on("unhandledRejection", async (error) => {
  await shutdown("unhandledRejection", error);
  process.exit(1);
});

startServer().catch(async (error) => {
  logger.error({ err: error }, "Server failed to start");
  await shutdown("startup_failure", error);
  process.exit(1);
});
