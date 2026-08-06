// No-op stub for the `server-only` package under vitest (node env). `server-only` is a
// Next.js RSC guard: on the server it resolves to an empty module, and it only throws when
// bundled into a Client Component. It has no plain-node build, so vitest can't resolve the
// real package — this stub stands in (a no-op, matching server semantics) via the alias in
// vitest.config.ts, letting server modules that `import "server-only"` be unit-tested.
export {};
