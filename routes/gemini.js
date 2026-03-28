import { Router } from "express";
import { createGeminiCompletion } from "../controllers/geminiController.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const router = Router();

router.post("/", asyncHandler(createGeminiCompletion));

export default router;
