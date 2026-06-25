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

export function generateAccessToken(userId) {
    return jwt.sign({ id: userId }, env.JWT_SECRET, {
        expiresIn: env.JWT_EXPIRY,
    });
}

export function generateRefreshToken(userId) {
    return jwt.sign({ id: userId }, env.JWT_REFRESH_SECRET, {
        expiresIn: env.JWT_REFRESH_EXPIRY,
    });
}

export function generateTokenPair(userId) {
    return {
        accessToken: generateAccessToken(userId),
        refreshToken: generateRefreshToken(userId),
    };
}
