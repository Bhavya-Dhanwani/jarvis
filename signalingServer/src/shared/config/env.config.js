// Importing modules
import { existsSync } from "fs";
import z from "zod";
import { envConstants } from "../constants/env.constants.js";

// loading the variables from the .env file into process.env (if the file exists)
if (existsSync(".env")) {
    process.loadEnvFile(".env");
}

// Defining the schema for environment variables
const envSchema = z.object({
    MONGO_URL: z.string().default(envConstants.MONGO_URL),
    PORT: z.coerce.number().default(envConstants.PORT),
    JWT_SECRET: z.string().default(envConstants.JWT_SECRET),
    JWT_EXPIRY: z.string().default(envConstants.JWT_EXPIRY),
});

// Parsing and validating the environment variables
const parsedEnv = envSchema.safeParse(process.env);

// Logging an error message if the environment variables are invalid
if (!parsedEnv.success) {
    console.error("Invalid environment variables:", parsedEnv.error.format());
}

// Exporting the validated environment variables or default values
const env = parsedEnv.success ? parsedEnv.data : envSchema.parse({});

export default env;