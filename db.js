import mongoose from "mongoose";
import { logger } from "./utils/logger.js";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.MONGO_DB_NAME || "defaultDB";
let Conversation;

/**
 * Connects to MongoDB with retry logic.
 * Retries up to 5 times if connection fails.
 */
export async function connectToDatabase(retries = 5, delay = 3000) {
  if (!MONGO_URI) {
    logger.error("❌ MONGO_URI not set in environment. Cannot connect to MongoDB.");
    throw new Error("MONGO_URI missing");
  }

  mongoose.set("strictQuery", true); // recommended by Mongoose 7+
  mongoose.set("autoIndex", true);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mongoose.connect(MONGO_URI, {
        dbName: DB_NAME,
        // useNewUrlParser: false,
        // useUnifiedTopology: false,
      });
      logger.info(`✅ MongoDB connected (DB: ${DB_NAME})`);

      const conversationSchema = new mongoose.Schema({
        conversationId: { type: String, unique: true, required: true },
        request: {
          messages: [{ role: String, content: String }],
          temperature: Number,
          maxTokens: Number,
        },
        response: {
          text: String,
          fullJson: mongoose.Schema.Types.Mixed,
        },
        model: { type: String, required: true },
        isStream: { type: Boolean, default: false },
        apiLatencyMs: Number,
        createdAt: { type: Date, default: Date.now },
      });

      Conversation = mongoose.model("Conversation", conversationSchema);

      return Conversation; // return the model for use elsewhere
    } catch (err) {
      logger.error({ err, attempt }, `❌ MongoDB connection attempt ${attempt} failed.`);
      if (attempt < retries) {
        logger.info(`🔁 Retrying in ${delay}ms...`);
        await new Promise((res) => setTimeout(res, delay));
      } else {
        logger.error("❌ All MongoDB connection attempts failed. Exiting.");
        process.exit(1);
      }
    }
  }
}

/**
 * Saves a conversation to MongoDB.
 * Throws error if DB is not connected.
 */
export async function saveConversation(data) {
  if (!Conversation) {
    logger.warn("⚠️ MongoDB model not initialized. Cannot save conversation.");
    return;
  }
  try {
    const c = new Conversation(data);
    await c.save();
    logger.info("✅ Conversation saved to MongoDB");
  } catch (err) {
    logger.error({ err }, "❌ Error saving conversation");
  }
}

/**
 * Graceful disconnect
 */
export async function disconnectDatabase() {
  if (mongoose.connection.readyState === 1) {
    try {
      await mongoose.connection.close();
      logger.info("✅ MongoDB disconnected gracefully");
    } catch (err) {
      logger.error({ err }, "❌ Error disconnecting MongoDB");
    }
  }
}

// Handle shutdown signals
["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"].forEach((sig) =>
  process.on(sig, async (err) => {
    if (err) logger.error({ err }, `❌ Signal received: ${sig}`);
    await disconnectDatabase();
    process.exit(0);
  })
);
