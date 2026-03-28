import config from "../config.js";
import { logger } from "./logger.js";

function shouldRetry(status) {
  return status === 429 || status >= 500;
}

export async function fetchWithRetry(url, options = {}, retries = config.retryAttempts) {
  let lastError;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (shouldRetry(response.status) && attempt < retries - 1) {
        const delay = 2 ** attempt * 500;
        logger.warn({ status: response.status, attempt: attempt + 1, delay }, "Upstream request failed, retrying");
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;

      if (attempt === retries - 1) {
        throw error;
      }

      const delay = 2 ** attempt * 500;
      logger.warn({ err: error, attempt: attempt + 1, delay }, "Network call failed, retrying");
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
