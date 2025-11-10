import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";

import { getSuggestions } from "../utils/suggestions.js";
import { fetchWithRetry } from "../utils/fetch.js";
import { respond } from "../utils/response.js";
import { saveConversation } from "../db.js";
import { logger } from "../utils/logger.js";

const router = Router();
const MODEL_ID = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const API_KEY = process.env.VITE_GOOGLE_API_KEY;
const ENV = process.env.NODE_ENV || "production";

// Zod schema with default values
const geminiSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "model"]),
      content: z.string().min(1, "Message content cannot be empty")
    })
  ).min(1, "Messages array cannot be empty"),
  temperature: z.number().min(0).max(1).optional().default(0.7),
  maxTokens: z.number().int().positive().optional().default(8192),
  stream: z.boolean().optional().default(false)
});

// POST /api/gemini
router.post("/", async (req, res) => {
  // Validate input
  const parsed = geminiSchema.safeParse(req.body);
  if (!parsed.success) {
    return respond(res, 400, {
      success: false,
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  const { messages, temperature, maxTokens, stream } = parsed.data;
  const conversationId = crypto.randomBytes(12).toString("hex");
  const startTime = Date.now();

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:${stream ? "streamGenerateContent" : "generateContent"}?key=${API_KEY}`;
    const payload = {
      contents: messages.map(m => ({ role: m.role, parts: [{ text: m.content }] })),
      generationConfig: { temperature, topP: 0.9, maxOutputTokens: maxTokens },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
      ]
    };

    // STREAM mode
    if (stream) {
      const apiResponse = await fetchWithRetry(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        return respond(res, apiResponse.status, {
          success: false,
          error: errorText.slice(0, 250),
          suggestions: getSuggestions(apiResponse.status)
        });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let buffer = "";
      let fullText = "";

      for await (const chunk of apiResponse.body) {
        buffer += chunk.toString();
        let boundary;
        while ((boundary = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 1);

          if (line.startsWith("data: ")) {
            try {
              const json = JSON.parse(line.slice(6));
              const text = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
              if (text) {
                fullText += text;
                res.write(`data: ${JSON.stringify({ text })}\n\n`);
              }
            } catch (e) {
              logger.warn({ err: e }, "Failed to parse stream chunk");
            }
          }
        }
      }

      res.end();

      try {
        await saveConversation({
          conversationId,
          request: { messages, temperature, maxTokens },
          response: { text: fullText },
          model: MODEL_ID,
          isStream: true,
          apiLatencyMs: Date.now() - startTime
        });
      } catch (err) {
        logger.error({ err }, "Failed to save streaming conversation");
      }

      return;
    }

    // NON-STREAM mode
    const apiResponse = await fetchWithRetry(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const latency = Date.now() - startTime;

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      return respond(res, apiResponse.status, {
        success: false,
        error: errorText.slice(0, 250),
        suggestions: getSuggestions(apiResponse.status)
      });
    }

    const data = await apiResponse.json();

    // Save conversation
    try {
      await saveConversation({
        conversationId,
        request: { messages, temperature, maxTokens },
        response: { text: data.candidates?.[0]?.content?.parts?.[0]?.text, fullJson: data },
        model: MODEL_ID,
        apiLatencyMs: latency
      });
    } catch (err) {
      logger.error({ err }, "Failed to save conversation");
    }

    respond(res, 200, { success: true, data, latency: `${latency}ms` });

  } catch (err) {
    logger.error({ err }, "❌ Gemini Proxy Error");
    respond(res, 500, {
      success: false,
      error: "Gemini request failed",
      details: ENV === "development" ? err.message : undefined
    });
  }
});

export default router;
