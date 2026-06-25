// extending the error class to create custom error class
class ApiError extends Error {

    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }

}

export default ApiError;
