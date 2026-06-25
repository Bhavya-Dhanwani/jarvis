// Importing modules
import express from "express";
import { register, login } from "./auth.controller.js";

// making the router
const router = express.Router();

// adding the register route
router.post("/register", register);

// adding the login route
router.post("/login", login);

// Exporting the router
export default router;
