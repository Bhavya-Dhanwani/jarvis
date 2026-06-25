// Importing modules
import express from "express";
import ApiResponse from "../utils/ApiResponse.util.js";
import authRouter from "../../features/auth/auth.router.js";

// making the router
const router = express.Router();

// adding the health route
router.get("/health", (req, res) => {
    return ApiResponse(res, 200, "Server is healthy", { status: "healthy" });
})

// adding the auth routes
router.use("/auth", authRouter);

// Exporting the router
export default router;