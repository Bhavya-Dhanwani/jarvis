import assert from "node:assert/strict";
import test from "node:test";
import { claimOllamaUrl, publishOllamaUrl } from "../src/modules/private/ollamaUrl/ollamaUrl.controller.js";

test("published Ollama URL can be fetched repeatedly", async () => {
    await call(publishOllamaUrl, {
        body: {
            url: "https://host.trycloudflare.com",
        },
        user: {
            id: "user-1",
        },
    });

    const firstClaim = await call(claimOllamaUrl, {});
    const secondClaim = await call(claimOllamaUrl, {});

    assert.equal(firstClaim.body.data.available, true);
    assert.equal(firstClaim.body.data.url, "https://host.trycloudflare.com");
    assert.equal(secondClaim.body.data.available, true);
    assert.equal(secondClaim.body.data.url, "https://host.trycloudflare.com");
});

async function call(handler, req) {
    const result = {};
    const res = {
        status(statusCode) {
            result.statusCode = statusCode;
            return this;
        },
        json(body) {
            result.body = body;
            return this;
        },
    };

    await handler(req, res, (error) => {
        if (error) {
            throw error;
        }
    });

    return result;
}
