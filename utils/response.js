function buildBody(res, status, payload) {
  return {
    success: payload.success ?? (status >= 200 && status < 400),
    message: payload.message || "",
    ...(payload.data !== undefined ? { data: payload.data } : {}),
    ...(payload.error !== undefined ? { error: payload.error } : {}),
    ...(payload.meta !== undefined ? { meta: payload.meta } : {}),
    requestId: res.req?.id,
    timestamp: new Date().toISOString(),
  };
}

export function respond(res, status, payload = {}) {
  return res.status(status).json(buildBody(res, status, payload));
}

export function sendSuccess(res, status, message, data, meta) {
  return respond(res, status, { success: true, message, data, meta });
}

export function sendError(res, status, message, { error, meta } = {}) {
  return respond(res, status, { success: false, message, error, meta });
}
