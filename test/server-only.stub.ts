/**
 * `server-only` under the test runner.
 *
 * The real package throws on import so a server module can never be pulled into
 * a client bundle. That guard is correct and stays in the modules — it is
 * neutralised HERE, in the harness, rather than weakened there, so the thing
 * being tested is the same code that ships.
 */
export {};
