// Importing modules
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

// defining the schema for the user
const userSchema = new mongoose.Schema(
    {
        // the name of the user
        name: {
            type: String,
            required: true,
            trim: true,
        },

        // the email of the user (must be unique so no two users share one email)
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },

        // the hashed password of the user
        password: {
            type: String,
            required: true,
        },
    },

    // adding createdAt and updatedAt timestamps automatically
    { timestamps: true }
);

// running this function right before a user document is saved
userSchema.pre("save", async function () {

    // skipping hashing if the password was not changed (e.g. on profile updates)
    if (!this.isModified("password")) return;

    // generating a salt to make the hash stronger
    const salt = await bcrypt.genSalt(10);

    // replacing the plain password with its hashed version
    this.password = await bcrypt.hash(this.password, salt);

    // moving on to actually saving the document
    // next();
});

// adding a helper method to check if a given password matches the stored hash
userSchema.methods.comparePassword = async function (plainPassword) {

    // comparing the plain password with the hashed one
    return await bcrypt.compare(plainPassword, this.password);
};

// creating the model from the schema
const User = mongoose.model("User", userSchema);

export default User;
