// Importing modules
import express from "express";
import applyMiddlewares from "./shared/middlewares/index.middleware.js";
import indexRouter from "./shared/routes/index.router.js";

function createApp() {

    // making the app
    const app = express();

    // adding the middewares
    applyMiddlewares(app);

    // adding the routes
    app.use("/api", indexRouter);

    // returning the app
    return app;

}

export default createApp;