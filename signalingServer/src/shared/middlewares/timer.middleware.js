import chalk from "chalk";

function requestTimer(req, res, next) {

    // Store the high-resolution start time for this request
    const start = process.hrtime.bigint();

    // This event is fired once the response has been completely sent
    res.on("finish", () => {

        // Capture the end time
        const end = process.hrtime.bigint();

        // Calculate the total time taken in milliseconds
        const timeMs = Number(end - start) / 1_000_000;

        // Color the HTTP method (GET, POST, PUT, DELETE, etc.)
        const method = chalk.cyan(req.method);

        // Color the requested API endpoint
        const url = chalk.yellow(req.originalUrl);

        // Color the status code based on its type
        let status = chalk.green(res.statusCode);

        // Client errors (4xx)
        if (res.statusCode >= 400 && res.statusCode < 500) {
            status = chalk.yellow(res.statusCode);
        }

        // Server errors (5xx)
        else if (res.statusCode >= 500) {
            status = chalk.red(res.statusCode);
        }

        // Color the response time based on how long the request took
        let time = chalk.green(`${timeMs.toFixed(2)} ms`);

        // Slow request
        if (timeMs > 500) {
            time = chalk.red(`${timeMs.toFixed(2)} ms`);
        }

        // Moderately slow request
        else if (timeMs > 100) {
            time = chalk.yellow(`${timeMs.toFixed(2)} ms`);
        }

        // Log the request details to the console
        console.log(`${method} ${url} -> ${status} | ${time}`);
    });

    // Continue to the next middleware or route handler
    next();
}

export default requestTimer;