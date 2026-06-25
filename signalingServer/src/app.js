// Importing modules
import express from "express";
import applyMiddlewares from "./shared/middlewares/index.middleware.js";
import indexRouter from "./shared/routes/index.router.js";
import errorHandler from "./shared/middlewares/error.middleware.js";

function createApp() {

    // making the app
    const app = express();

    // adding the middewares
    applyMiddlewares(app);

    // adding the routes
    app.use("/api", indexRouter);

    // adding the error handler (must be last so it catches errors from the routes)
    app.use(errorHandler);

    // returning the app
    return app;

}

export default createApp;
