// WebSocket relay that connects one host (running Ollama) with clients.
//
// Both sides authenticate with the same JWT access token used by the REST API and
// connect to /relay?role=host|client&token=<accessToken>. The relay forwards model
// "call" frames from a client to the host, and streams the host's "token"/"result"/
// "error" frames back to the client that made the call. This replaces the public
// tunnel: traffic rides a single WebSocket each way through the signaling server.
import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import env from "../shared/config/env.config.js";

// Mirrors the single-host model of ollamaUrl.controller.js: one active host at a time.
let hostSocket = null;
// Every connected client socket, so host-online/offline status reaches waiters.
const clients = new Set();
// Maps an in-flight request id to the client socket that issued it, so host replies
// route back to the right client.
const pendingRequests = new Map();

export function attachRelay(server) {
    const wss = new WebSocketServer({ server, path: "/relay" });

    wss.on("connection", (socket, request) => {
        const auth = authenticate(request);

        if (!auth.ok) {
            closeSocket(socket, 4401, auth.reason);
            return;
        }

        // Flush each frame immediately so streamed tokens are not batched by Nagle.
        socket._socket?.setNoDelay?.(true);

        const { role, userId } = auth;

        if (role === "host") {
            registerHost(socket, userId);
        } else {
            registerClient(socket, userId);
        }
    });

    return wss;
}

function registerHost(socket, userId) {
    // A new host replaces any previous one (latest publisher wins).
    if (hostSocket && hostSocket !== socket) {
        closeSocket(hostSocket, 4000, "Replaced by a newer host");
    }

    hostSocket = socket;
    socket.meta = { role: "host", userId };
    broadcastHostStatus(true);

    socket.on("message", (raw) => handleHostMessage(socket, raw));

    socket.on("close", () => {
        if (hostSocket === socket) {
            hostSocket = null;
            // Fail every in-flight request; the host is gone.
            for (const [id, clientSocket] of pendingRequests) {
                sendJson(clientSocket, { type: "error", id, message: "Host disconnected" });
            }
            pendingRequests.clear();
            broadcastHostStatus(false);
        }
    });
}

function registerClient(socket, userId) {
    socket.meta = { role: "client", userId };
    clients.add(socket);
    // Tell the client immediately whether a host is available.
    sendJson(socket, { type: "host-status", online: Boolean(hostSocket) });

    socket.on("message", (raw) => handleClientMessage(socket, raw));

    socket.on("close", () => {
        clients.delete(socket);
        // Drop any of this client's in-flight requests.
        for (const [id, clientSocket] of pendingRequests) {
            if (clientSocket === socket) {
                pendingRequests.delete(id);
            }
        }
    });
}

// Client -> host: forward model calls, tagging them so replies can be routed back.
function handleClientMessage(socket, raw) {
    const frame = parseJson(raw);

    if (!frame || frame.type !== "call" || !frame.id) {
        return;
    }

    if (!hostSocket) {
        sendJson(socket, { type: "error", id: frame.id, message: "No host is online" });
        return;
    }

    pendingRequests.set(frame.id, socket);
    sendJson(hostSocket, {
        type: "call",
        id: frame.id,
        method: frame.method,
        args: frame.args,
    });
}

// Host -> client: stream tokens and deliver the final result/error to the caller.
function handleHostMessage(_socket, raw) {
    const frame = parseJson(raw);

    if (!frame || !frame.id || !frame.type) {
        return;
    }

    const clientSocket = pendingRequests.get(frame.id);

    if (!clientSocket) {
        return;
    }

    sendJson(clientSocket, frame);

    // A result or error completes the request; tokens keep it open.
    if (frame.type === "result" || frame.type === "error") {
        pendingRequests.delete(frame.id);
    }
}

function broadcastHostStatus(online) {
    for (const clientSocket of clients) {
        sendJson(clientSocket, { type: "host-status", online });
    }
}

function authenticate(request) {
    let url;

    try {
        url = new URL(request.url, "http://localhost");
    } catch {
        return { ok: false, reason: "Bad request URL" };
    }

    const token = url.searchParams.get("token");
    const role = url.searchParams.get("role") === "host" ? "host" : "client";

    if (!token) {
        return { ok: false, reason: "Authentication required" };
    }

    try {
        const payload = jwt.verify(token, env.JWT_SECRET);
        return { ok: true, role, userId: payload.id };
    } catch {
        return { ok: false, reason: "Invalid or expired access token" };
    }
}

function parseJson(raw) {
    try {
        return JSON.parse(raw.toString());
    } catch {
        return null;
    }
}

function sendJson(socket, value) {
    if (socket && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(value));
    }
}

function closeSocket(socket, code, reason) {
    try {
        socket.close(code, reason);
    } catch {
        // Ignore errors closing an already-broken socket.
    }
}

// Exposed for tests so they can assert/reset relay state.
export function __resetRelayState() {
    hostSocket = null;
    clients.clear();
    pendingRequests.clear();
}
