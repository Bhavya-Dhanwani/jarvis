// Importing modules
import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import applyMiddlewares from "./shared/middlewares/index.middleware.js";
import indexRouter from "./shared/routes/index.router.js";
import errorHandler from "./shared/middlewares/error.middleware.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicPath = join(__dirname, "..", "public");

function createApp() {

    // making the app
    const app = express();

    // adding the middewares
    applyMiddlewares(app);

    // adding the routes
    app.use("/api", indexRouter);

    // serving the hosted frontend build
    app.use(express.static(publicPath));

    // keeping client-side routes on the React app in Express 5
    app.get("/", (_req, res) => {
        res.sendFile(join(publicPath, "index.html"));
    });

    app.get("/*name", (_req, res) => {
        res.sendFile(join(publicPath, "index.html"));
    });

    // adding the error handler (must be last so it catches errors from the routes)
    app.use(errorHandler);

    // returning the app
    return app;

}

export default createApp;
