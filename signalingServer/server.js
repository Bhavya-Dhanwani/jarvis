// Importing modules
import createApp from "./src/app.js";
import env from "./src/shared/config/env.config.js";

// function to start the server
function startServer() {

    // making the app 
    const app = createApp();

    // starting the server
    app.listen(env.PORT, () => {
        void console.log(`Server started on http://localhost:${env.PORT}`);
    })

}

// starting the server
startServer();