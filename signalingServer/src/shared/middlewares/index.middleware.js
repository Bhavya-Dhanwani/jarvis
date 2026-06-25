// importing modules
import express from "express";
import hpp from "hpp";
import helmet from "helmet";
import compression from "compression";

// Function to apply the middlewares to the Express app
function applyMiddlewares(app) {

    // Applying security-related middlewares
    app.use(helmet()); // Helps secure the app by setting various HTTP headers
    app.use(hpp()); // Protects against HTTP Parameter Pollution attacks
    app.use(compression()); // Compresses response bodies for better performance
    app.use(express.json()); // Parses incoming JSON requests and puts the parsed data in req.body
    app.use(express.urlencoded({ extended: true })); // Parses incoming requests with URL-encoded payloads

}

export default applyMiddlewares;