import z from "zod";
import ApiResponse from "../../../shared/utils/ApiResponse.util.js";
import ApiError from "../../../shared/utils/ApiError.util.js";
import asyncWrapper from "../../../shared/utils/asyncWrapper.util.js";

const publishSchema = z.object({
    url: z.string().url("Please provide a valid Ollama URL"),
});

const OLLAMA_URL_TTL_MS = 45000;

let currentOllamaUrl = null;
let lastClientRequestAt = null;

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
        lastClientRequestAt,
    });
});

export const claimOllamaUrl = asyncWrapper(async (_req, res) => {
    lastClientRequestAt = new Date().toISOString();

    if (!currentOllamaUrl?.url || isExpired(currentOllamaUrl.publishedAt)) {
        return ApiResponse(res, 200, "URL not available. Waiting for the host to provide one.", {
            available: false,
            url: null,
            needsHost: true,
            expired: Boolean(currentOllamaUrl?.url),
            requestedAt: lastClientRequestAt,
        });
    }

    return ApiResponse(res, 200, "Ollama URL available", {
        available: true,
        url: currentOllamaUrl.url,
        publishedAt: currentOllamaUrl.publishedAt,
        requestedAt: lastClientRequestAt,
    });
});

function isExpired(publishedAt) {
    if (!publishedAt) {
        return true;
    }

    return Date.now() - Date.parse(publishedAt) > OLLAMA_URL_TTL_MS;
}