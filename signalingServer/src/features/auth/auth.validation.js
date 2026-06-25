// Importing modules
import z from "zod";

// schema to validate the body when a user registers
export const registerSchema = z.object({

    // the name must be a string of at least 2 characters
    name: z.string().min(2, "Name must be at least 2 characters long"),

    // the email must be a valid email address
    email: z.string().email("Please provide a valid email"),

    // the password must be a string of at least 6 characters
    password: z.string().min(6, "Password must be at least 6 characters long"),
});

// schema to validate the body when a user logs in
export const loginSchema = z.object({

    // the email must be a valid email address
    email: z.string().email("Please provide a valid email"),

    // the password is required
    password: z.string().min(1, "Password is required"),
});
