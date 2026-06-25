// Importing modules
import z from "zod";
import { envConstants } from "../constants/env.constants.js";

// Defining the schema for environment variables
const envSchema = z.object({
    MONGO_URL: z.string().default(envConstants.MONGO_URL),
    PORT: z.coerce.number().default(envConstants.PORT),
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