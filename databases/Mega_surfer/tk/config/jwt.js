/**
 * Centralized JWT configuration.
 *
 * The secret MUST come from the environment. We deliberately fail fast at
 * startup rather than fall back to a hardcoded default — a guessable signing
 * key means anyone can forge tokens and bypass authentication entirely.
 */
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error(
        'FATAL: JWT_SECRET environment variable is not set. ' +
        'Refusing to start with an insecure default — set JWT_SECRET in your environment (.env).'
    );
}

const JWT_EXPIRES_IN = '7d';

module.exports = { JWT_SECRET, JWT_EXPIRES_IN };
