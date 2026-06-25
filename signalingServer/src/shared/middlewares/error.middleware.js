// importing modules
import ApiError from "../utils/ApiError.util.js";

// middleware to handle the errors thrown anywhere in the app
function errorHandler(err, req, res, next) {

    // using the status code from our custom ApiError, otherwise defaulting to 500
    const statusCode = err instanceof ApiError ? err.statusCode : 500;

    // using the error message, otherwise a generic one
    const message = err.message || "Internal Server Error";

    // logging the error to the console for debugging
    console.error("Error:", message);

    // sending a structured error response to the client
    return res.status(statusCode).json({
        success: false,
        message,
        data: null
    });

}

export default errorHandler;
