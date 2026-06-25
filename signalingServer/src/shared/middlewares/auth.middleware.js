import jwt from "jsonwebtoken";
import env from "../config/env.config.js";
import ApiError from "../utils/ApiError.util.js";
import asyncWrapper from "../utils/asyncWrapper.util.js";

const requireAuth = asyncWrapper(async (req, _res, next) => {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
        throw new ApiError(401, "Authentication required");
    }

    try {
        req.user = jwt.verify(token, env.JWT_SECRET);
        next();
    } catch {
        throw new ApiError(401, "Invalid or expired access token");
    }
});

export default requireAuth;
