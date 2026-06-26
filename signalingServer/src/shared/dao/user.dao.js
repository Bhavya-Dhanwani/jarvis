import User from "../models/user.model.js";

export function findUserByEmail(email) {
    return User.findOne({ email });
}

export function findUserById(id) {
    return User.findById(id);
}

export function createUser(userData) {
    return User.create(userData);
}
