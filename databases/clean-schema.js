/**
 * Sanitizes a pg_dump .sql file so it can be executed by node-postgres (pg).
 *
 * `pg_dump` (v17/18) emits things the `pg` driver's simple-query protocol
 * cannot handle, and that newer servers reject when restoring onto an older one:
 *   - psql meta-commands (lines starting with `\`, e.g. \restrict / \unrestrict)
 *   - `SET transaction_timeout` (PostgreSQL 17+ only — fails on PG <= 16)
 *   - other timeout SETs that are noise for our purposes
 *   - `OWNER TO <role>` clauses (role may not exist on the target)
 *
 * Returns the cleaned SQL as a single string.
 */
const SKIP_SET_PARAMS = [
    'statement_timeout',
    'lock_timeout',
    'idle_in_transaction_session_timeout',
    'transaction_timeout',
];
const SKIP_SET_RE = new RegExp(`^\\s*SET\\s+(${SKIP_SET_PARAMS.join('|')})\\b`, 'i');

function cleanSchema(sql) {
    return sql
        .split('\n')
        .filter((line) => {
            const t = line.trim();
            if (t.startsWith('\\')) return false;          // psql meta-commands
            if (SKIP_SET_RE.test(line)) return false;       // incompatible timeout SETs
            if (/\bOWNER TO\b/i.test(line)) return false;   // role may not exist on target
            return true;
        })
        .join('\n');
}

/**
 * True when an error from re-applying a schema means "schema is already there"
 * rather than a real failure — lets init be idempotent on a populated DB.
 */
function isAlreadyAppliedError(message = '') {
    return /already exists|multiple primary keys/i.test(message);
}

module.exports = { cleanSchema, isAlreadyAppliedError };
