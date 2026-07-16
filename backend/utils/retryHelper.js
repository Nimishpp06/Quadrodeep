async function withRetry(fn, maxRetries = 3, baseDelay = 1000) {
    let retries = 0;
    while (true) {
        try {
            return await fn();
        } catch (error) {
            if (retries >= maxRetries) {
                throw error;
            }
            retries++;
            // Exponential backoff with jitter
            const delay = baseDelay * Math.pow(2, retries - 1) + Math.random() * 500;
            console.log(`[RetryHelper] Action failed. Retrying (${retries}/${maxRetries}) in ${Math.round(delay)}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

module.exports = { withRetry };
