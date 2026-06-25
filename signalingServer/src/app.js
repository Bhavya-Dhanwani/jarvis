// Importing modules
import express from "express";
import applyMiddlewares from "./shared/middlewares/index.middleware.js";

function createApp() {

    // making the app
    const app = express();

    // adding the middewares
    applyMiddlewares(app);

    // returning the app
    return app;

}

export default createApp;