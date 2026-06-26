import z from "zod";
import ApiResponse from "../../../shared/utils/ApiResponse.util.js";
import ApiError from "../../../shared/utils/ApiError.util.js";
import asyncWrapper from "../../../shared/utils/asyncWrapper.util.js";

const publishSchema = z.object({
    url: z.string().url("Please provide a valid Ollama URL"),
});

let currentOllamaUrl = null;

export const publishOllamaUrl = asyncWrapper(async (req, res) => {
    const parsed = publishSchema.safeParse(req.body);

    if (!parsed.success) {
        throw new ApiError(400, parsed.error.issues[0].message);
    }

    currentOllamaUrl = {
        url: parsed.data.url,
        userId: req.user.id,
        publishedAt: new Date().toISOString(),
    };

    return ApiResponse(res, 200, "Ollama URL published", {
        available: true,
        url: currentOllamaUrl.url,
        publishedAt: currentOllamaUrl.publishedAt,
    });
});

export const claimOllamaUrl = asyncWrapper(async (_req, res) => {
    if (!currentOllamaUrl?.url) {
        return ApiResponse(res, 200, "URL not available. Waiting for the host to provide one.", {
            available: false,
            url: null,
        });
    }

    return ApiResponse(res, 200, "Ollama URL available", {
        available: true,
        url: currentOllamaUrl.url,
        publishedAt: currentOllamaUrl.publishedAt,
    });
});
