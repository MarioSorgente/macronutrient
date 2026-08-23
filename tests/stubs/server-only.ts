/**
 * Stand-in for the `server-only` package inside tests.
 *
 * The real module throws when it is resolved outside a React Server context,
 * which is exactly what keeps the Admin SDK and its credentials out of any
 * client bundle. The integration tests import those server modules on purpose,
 * so this replaces it with nothing. Aliased in vitest.config.ts only — the
 * real guard is untouched in the app build.
 */
export {};
