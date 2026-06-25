// Importing modules
import User from "./auth.model.js";
import { registerSchema, loginSchema } from "./auth.validation.js";
import ApiResponse from "../../shared/utils/ApiResponse.util.js";
import ApiError from "../../shared/utils/ApiError.util.js";
import asyncWrapper from "../../shared/utils/asyncWrapper.util.js";
import { generateAccessToken, generateTokenPair } from "../../shared/utils/generateToken.util.js";
import jwt from "jsonwebtoken";
import env from "../../shared/config/env.config.js";

// controller to register a new user
export const register = asyncWrapper(async (req, res) => {

    // validating the request body against the register schema
    const parsed = registerSchema.safeParse(req.body);

    // throwing an error if the body is not valid
    if (!parsed.success) {
        throw new ApiError(400, parsed.error.issues[0].message);
    }

    // pulling out the validated fields
    const { name, email, password } = parsed.data;

    // checking if a user with this email already exists
    const existingUser = await User.findOne({ email });

    // throwing an error if the email is already taken
    if (existingUser) {
        throw new ApiError(409, "A user with this email already exists");
    }

    // creating the new user (the password gets hashed by the model's pre-save hook)
    const user = await User.create({ name, email, password });

    // generating JWT tokens for the newly created user
    const tokens = generateTokenPair(user._id);

    // sending back the user details (without the password) and the token
    return ApiResponse(res, 201, "User registered successfully", {
        user: {
            id: user._id,
            name: user.name,
            email: user.email,
        },
        ...tokens,
    });
});

// controller to log in an existing user
export const login = asyncWrapper(async (req, res) => {

    // validating the request body against the login schema
    const parsed = loginSchema.safeParse(req.body);

    // throwing an error if the body is not valid
    if (!parsed.success) {
        throw new ApiError(400, parsed.error.issues[0].message);
    }

    // pulling out the validated fields
    const { email, password } = parsed.data;

    // finding the user by their email
    const user = await User.findOne({ email });

    // throwing an error if no user was found with this email
    if (!user) {
        throw new ApiError(401, "Invalid email or password");
    }

    // checking if the given password matches the stored hashed password
    const isPasswordValid = await user.comparePassword(password);

    // throwing an error if the password does not match
    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid email or password");
    }

    // generating JWT tokens for the logged in user
    const tokens = generateTokenPair(user._id);

    // sending back the user details (without the password) and the token
    return ApiResponse(res, 200, "Logged in successfully", {
        user: {
            id: user._id,
            name: user.name,
            email: user.email,
        },
        ...tokens,
    });
});

// controller to mint a new access token from a refresh token
export const refresh = asyncWrapper(async (req, res) => {

    const { refreshToken } = req.body;

    if (!refreshToken || typeof refreshToken !== "string") {
        throw new ApiError(400, "Refresh token is required");
    }

    try {
        const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
        const user = await User.findById(payload.id);

        if (!user) {
            throw new ApiError(401, "Invalid refresh token");
        }

        return ApiResponse(res, 200, "Access token refreshed", {
            accessToken: generateAccessToken(user._id),
        });
    } catch (error) {
        if (error instanceof ApiError) {
            throw error;
        }

        throw new ApiError(401, "Invalid or expired refresh token");
    }
});
