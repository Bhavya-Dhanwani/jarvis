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

    // starting the server
    app.listen(env.PORT, () => {
        void console.log(`Server started on http://localhost:${env.PORT}`);
    })

}

// starting the server
startServer();