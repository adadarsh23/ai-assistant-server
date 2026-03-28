import config from "../config.js";
import { isOperationalError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { sendError } from "../utils/response.js";

export function notFoundHandler(req, res) {
  return sendError(res, 404, "Route not found", {
    error: {
      code: "ROUTE_NOT_FOUND",
      path: req.originalUrl,
      method: req.method,
    },
  });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  const exposeDetails = config.isDevelopment || isOperationalError(error);

  req.log?.error?.(
    {
      err: error,
      requestId: req.id,
      path: req.originalUrl,
      method: req.method,
    },
    "Request failed",
  );

  logger.error(
    {
      err: error,
      requestId: req.id,
      path: req.originalUrl,
      method: req.method,
    },
    "Unhandled application error",
  );

  return sendError(
    res,
    statusCode,
    statusCode >= 500 ? "Unexpected server error" : error.message,
    {
      error: {
        code: error.code || "INTERNAL_SERVER_ERROR",
        ...(exposeDetails && error.details ? { details: error.details } : {}),
        ...(config.isDevelopment && statusCode >= 500 ? { debug: error.message } : {}),
      },
    },
  );
}
