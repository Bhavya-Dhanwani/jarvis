// Importing modules 
import express from "express";

// making the router
const router = express.Router();

// adding the health route
router.get("/health", (req, res) => {
    res.status(200).json({ message: "Server is healthy" });
})

// Exporting the router
export default router;