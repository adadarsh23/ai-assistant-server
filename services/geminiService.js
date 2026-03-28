import config from "../config.js";
import { AppError } from "../utils/errors.js";
import { fetchWithRetry } from "../utils/fetch.js";
import { getSuggestions } from "../utils/suggestions.js";

const upstreamModelCache = {
  value: null,
  expiresAt: 0,
};

function buildGeminiPayload({ messages, temperature, maxTokens }) {
  return {
    contents: messages.map((message) => ({
      role: message.role,
      parts: [{ text: message.content }],
    })),
    generationConfig: {
      temperature,
      topP: 0.9,
      maxOutputTokens: maxTokens,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  };
}

async function parseUpstreamError(response) {
  const rawText = await response.text();

  try {
    return {
      code: "UPSTREAM_ERROR",
      status: response.status,
      upstream: JSON.parse(rawText),
      suggestions: getSuggestions(response.status),
    };
  } catch {
    return {
      code: "UPSTREAM_ERROR",
      status: response.status,
      upstream: rawText.slice(0, 300),
      suggestions: getSuggestions(response.status),
    };
  }
}

export async function getModelStatus() {
  const now = Date.now();
  if (upstreamModelCache.value && upstreamModelCache.expiresAt > now) {
    return { ...upstreamModelCache.value, cached: true };
  }

  const startedAt = Date.now();
  const response = await fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.modelId}?key=${config.apiKey}`,
  );
  const latencyMs = Date.now() - startedAt;

  if (!response.ok) {
    throw new AppError(503, "Gemini API is unavailable", {
      code: "GEMINI_STATUS_CHECK_FAILED",
      details: await parseUpstreamError(response),
    });
  }

  const data = {
    geminiApi: "connected",
    model: config.modelId,
    latencyMs,
  };

  upstreamModelCache.value = data;
  upstreamModelCache.expiresAt = now + 30000;

  return { ...data, cached: false };
}

export async function generateGeminiResponse({ messages, temperature, maxTokens, stream }) {
  const startedAt = Date.now();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${config.modelId}:${
    stream ? "streamGenerateContent" : "generateContent"
  }?key=${config.apiKey}`;

  const response = await fetchWithRetry(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildGeminiPayload({ messages, temperature, maxTokens })),
  });

  const latencyMs = Date.now() - startedAt;

  if (!response.ok) {
    throw new AppError(response.status, "Gemini request failed", {
      code: "GEMINI_REQUEST_FAILED",
      details: await parseUpstreamError(response),
    });
  }

  return { response, latencyMs };
}
