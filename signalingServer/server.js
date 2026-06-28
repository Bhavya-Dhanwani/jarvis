// Importing modules
import createApp from "./src/app.js";
import env from "./src/shared/config/env.config.js";
import connectDB from "./src/shared/config/db.config.js";

// function to start the server
async function startServer() {

    // connecting to the database before starting the server
    await connectDB();

    // making the app
    const app = createApp();

    // The signaling server now only handles auth + the publish/claim link exchange.
    // Hosts run their own WebSocket server and clients connect to it directly, so there
    // is no longer a /relay WebSocket in the data path.
    app.listen(env.PORT, () => {
        void console.log(`Server started on http://localhost:${env.PORT} (auth + link exchange only)`);
    })

}

// starting the server
startServer();