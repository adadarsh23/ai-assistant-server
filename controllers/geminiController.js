import crypto from "crypto";
import { z } from "zod";
import config from "../config.js";
import { saveConversation } from "../db.js";
import { logger } from "../utils/logger.js";
import { sendError, sendSuccess } from "../utils/response.js";
import { generateGeminiResponse, getModelStatus } from "../services/geminiService.js";

const geminiSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "model"]),
        content: z.string().trim().min(1).max(20000),
      }),
    )
    .min(1)
    .max(100),
  temperature: z.number().min(0).max(1).optional().default(0.7),
  maxTokens: z.number().int().positive().max(8192).optional().default(2048),
  stream: z.boolean().optional().default(false),
});

function sanitizeMessageText(value) {
  return value.replace(/\u0000/g, "").trim();
}

async function persistConversation(payload) {
  try {
    await saveConversation(payload);
  } catch (error) {
    logger.error({ err: error, conversationId: payload.conversationId }, "Conversation persistence failed");
  }
}

export async function getApiStatus(req, res) {
  const status = await getModelStatus();

  return sendSuccess(
    res,
    200,
    "Gemini API is reachable",
    {
      geminiApi: status.geminiApi,
      model: status.model,
    },
    {
      latencyMs: status.latencyMs,
      cached: status.cached,
    },
  );
}

export async function createGeminiCompletion(req, res) {
  const parsed = geminiSchema.safeParse(req.body);

  if (!parsed.success) {
    return sendError(res, 400, "Invalid request payload", {
      error: {
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
    });
  }

  const { temperature, maxTokens, stream } = parsed.data;
  const messages = parsed.data.messages.map((message) => ({
    ...message,
    content: sanitizeMessageText(message.content),
  }));

  if (messages.some((message) => !message.content)) {
    return sendError(res, 400, "Messages cannot be empty after sanitization", {
      error: { code: "EMPTY_MESSAGE_CONTENT" },
    });
  }

  const conversationId = crypto.randomUUID();
  const receivedAt = new Date().toISOString();

  req.log?.info?.(
    {
      conversationId,
      messageCount: messages.length,
      stream,
    },
    "Prompt received",
  );

  const { response, latencyMs } = await generateGeminiResponse({
    messages,
    temperature,
    maxTokens,
    stream,
  });

  if (stream) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.write(
      `data: ${JSON.stringify({
        success: true,
        message: "Prompt received",
        data: { conversationId, model: config.modelId },
        meta: { receivedAt },
      })}\n\n`,
    );

    let buffer = "";
    let aggregatedText = "";

    for await (const chunk of response.body) {
      buffer += chunk.toString();

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line.startsWith("data: ")) {
          const rawPayload = line.slice(6);

          if (rawPayload !== "[DONE]") {
            try {
              const parsedChunk = JSON.parse(rawPayload);
              const text = parsedChunk.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

              if (text) {
                aggregatedText += text;
                res.write(`data: ${JSON.stringify({ success: true, message: "Chunk received", data: { text } })}\n\n`);
              }
            } catch (error) {
              req.log?.warn?.({ err: error }, "Skipping malformed streaming payload");
            }
          }
        }

        newlineIndex = buffer.indexOf("\n");
      }
    }

    res.write(
      `data: ${JSON.stringify({
        success: true,
        message: "Stream completed",
        data: { conversationId, model: config.modelId },
        meta: { latencyMs, receivedAt },
      })}\n\n`,
    );
    res.end();

    await persistConversation({
      conversationId,
      request: { messages, temperature, maxTokens },
      response: { text: aggregatedText },
      model: config.modelId,
      isStream: true,
      apiLatencyMs: latencyMs,
    });

    return;
  }

  const data = await response.json();
  const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  await persistConversation({
    conversationId,
    request: { messages, temperature, maxTokens },
    response: { text: responseText, fullJson: data },
    model: config.modelId,
    isStream: false,
    apiLatencyMs: latencyMs,
  });

  return sendSuccess(
    res,
    200,
    "Prompt received and Gemini response generated",
    {
      conversationId,
      model: config.modelId,
      text: responseText,
      raw: data,
    },
    {
      latencyMs,
      receivedAt,
    },
  );
}
