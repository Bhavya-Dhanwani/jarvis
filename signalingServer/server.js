// Importing modules
import { createServer } from "node:http";
import createApp from "./src/app.js";
import env from "./src/shared/config/env.config.js";
import connectDB from "./src/shared/config/db.config.js";
import { attachRelay } from "./src/relay/relay.js";

// function to start the server
async function startServer() {

    // connecting to the database before starting the server
    await connectDB();

    // making the app
    const app = createApp();

    // wrapping the app in an HTTP server so the WebSocket relay can share the port
    const server = createServer(app);

    // Host and client both connect OUT to this relay; it forwards model call/token frames
    // between them so no inbound tunnel is needed on either machine.
    attachRelay(server);

    // starting the server
    server.listen(env.PORT, () => {
        void console.log(`Server started on http://localhost:${env.PORT} (relay on /relay)`);
    })

}

// starting the server
startServer();
