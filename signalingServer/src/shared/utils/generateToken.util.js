// Importing modules
import jwt from "jsonwebtoken";
import env from "../config/env.config.js";

// function to generate a JWT token for a given user id
function generateToken(userId) {

    // signing the user id with the secret and setting an expiry time
    return jwt.sign({ id: userId }, env.JWT_SECRET, {
        expiresIn: env.JWT_EXPIRY,
    });

}

export default generateToken;
