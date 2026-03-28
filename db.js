import mongoose from "mongoose";
import config from "./config.js";
import { logger } from "./utils/logger.js";

let Conversation;
let connectionAttempted = false;

const conversationSchema = new mongoose.Schema({
  conversationId: { type: String, unique: true, required: true, index: true },
  request: {
    messages: [
      {
        role: { type: String, required: true },
        content: { type: String, required: true },
      },
    ],
    temperature: Number,
    maxTokens: Number,
  },
  response: {
    text: String,
    fullJson: mongoose.Schema.Types.Mixed,
  },
  model: { type: String, required: true, index: true },
  isStream: { type: Boolean, default: false, index: true },
  apiLatencyMs: Number,
  createdAt: { type: Date, default: Date.now, index: true },
});

export async function connectToDatabase(retries = 5, delay = 3000) {
  if (!config.enableDbPersistence || !config.mongoUri) {
    logger.warn("MongoDB persistence disabled; continuing without database");
    return null;
  }

  if (mongoose.connection.readyState === 1) {
    return Conversation || mongoose.models.Conversation;
  }

  if (connectionAttempted) {
    return Conversation || null;
  }

  connectionAttempted = true;
  mongoose.set("strictQuery", true);
  mongoose.set("autoIndex", true);

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await mongoose.connect(config.mongoUri, {
        dbName: config.mongoDbName,
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 10,
      });

      Conversation = mongoose.models.Conversation || mongoose.model("Conversation", conversationSchema);
      logger.info({ dbName: config.mongoDbName }, "MongoDB connected");
      return Conversation;
    } catch (error) {
      logger.error({ err: error, attempt }, "MongoDB connection attempt failed");

      if (attempt < retries) {
        logger.info({ delay, attempt }, "Retrying MongoDB connection");
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      logger.error("All MongoDB connection attempts failed; continuing without persistence");
      return null;
    }
  }

  return null;
}

export async function saveConversation(data) {
  if (!Conversation || mongoose.connection.readyState !== 1) {
    logger.warn("Conversation persistence skipped because MongoDB is unavailable");
    return;
  }

  try {
    await Conversation.create(data);
    logger.info({ conversationId: data.conversationId }, "Conversation persisted");
  } catch (error) {
    logger.error({ err: error, conversationId: data.conversationId }, "Failed to save conversation");
  }
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState === 1) {
    try {
      await mongoose.connection.close();
      logger.info("MongoDB disconnected gracefully");
    } catch (error) {
      logger.error({ err: error }, "Error disconnecting MongoDB");
    }
  }
}
