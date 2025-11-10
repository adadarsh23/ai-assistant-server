/**
 * Send a standardized JSON response
 * @param {import('express').Response} res - Express response object
 * @param {number} status - HTTP status code
 * @param {object} payload - Response payload
 * @param {object} [options] - Optional extra metadata
 * @param {string} [options.requestId] - Request ID for tracing
 * @param {string} [options.path] - Request path
 */
export function respond(res, status, payload = {}, options = {}) {
  const success = payload.success !== undefined ? payload.success : status >= 200 && status < 400;

  const responseBody = {
    status,
    success,
    timestamp: new Date().toISOString(),
    path: options.path || res.req?.originalUrl,
    requestId: options.requestId || res.req?.id || null,
    ...payload
  };

  // Optional: remove null values for cleaner responses
  Object.keys(responseBody).forEach(key => responseBody[key] === null && delete responseBody[key]);

  return res.status(status).json(responseBody);
}
