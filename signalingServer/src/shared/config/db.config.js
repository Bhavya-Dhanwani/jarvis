// Importing modules
import mongoose from "mongoose";
import env from "./env.config.js";

// function to connect to the MongoDB database
async function connectDB() {

    // trying to connect using the url from the env
    try {

        // connecting to the database
        await mongoose.connect(env.MONGO_URL);

        // logging the success message
        console.log("Connected to the database");

    }

    // catching any error that happens while connecting
    catch (err) {

        // logging the error message
        console.error("Failed to connect to the database:", err.message);

        // exiting the process since the app cannot run without the database
        process.exit(1);

    }

}

export default connectDB;
