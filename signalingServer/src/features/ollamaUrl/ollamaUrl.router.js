import express from "express";
import requireAuth from "../../shared/middlewares/auth.middleware.js";
import { claimOllamaUrl, publishOllamaUrl } from "./ollamaUrl.controller.js";

const router = express.Router();

router.post("/", requireAuth, publishOllamaUrl);
router.post("/claim", requireAuth, claimOllamaUrl);

export default router;
