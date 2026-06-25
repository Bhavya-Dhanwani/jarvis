// Importing modules
import User from "./auth.model.js";
import { registerSchema } from "./auth.validation.js";
import ApiResponse from "../../shared/utils/ApiResponse.util.js";
import ApiError from "../../shared/utils/ApiError.util.js";
import asyncWrapper from "../../shared/utils/asyncWrapper.util.js";
import generateToken from "../../shared/utils/generateToken.util.js";

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

    // generating a JWT token for the newly created user
    const token = generateToken(user._id);

    // sending back the user details (without the password) and the token
    return ApiResponse(res, 201, "User registered successfully", {
        user: {
            id: user._id,
            name: user.name,
            email: user.email,
        },
        token,
    });
});
