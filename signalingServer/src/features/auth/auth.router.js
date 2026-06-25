// Importing modules
import express from "express";
import { register } from "./auth.controller.js";

// making the router
const router = express.Router();

// adding the register route
router.post("/register", register);

// Exporting the router
export default router;
