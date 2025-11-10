import fetch from "node-fetch";
import { logger } from "./logger.js";

export async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429 && i < retries - 1) {
        const delay = Math.pow(2, i) * 1000;
        logger.warn(`⚠️ 429 Too Many Requests, retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      const delay = Math.pow(2, i) * 1000;
      logger.warn(`⚠️ Fetch failed. Retry in ${delay}ms (${err.message})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
