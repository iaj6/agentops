import tseslint from "typescript-eslint";

// Shared flat ESLint config for the non-web TypeScript packages
// (core, db, cli, sdk). Intentionally light: the goal is to establish linting
// and catch real mistakes (unused vars, accidental `require`, debugger, etc.)
// without drowning previously-unlinted code in style nits. The web package has
// its own Next.js / React config.
//
// `eslint` and `typescript-eslint` are declared as root devDependencies (see
// the repo-root package.json), so this config resolves them reliably and is
// not coupled to the web package's lint toolchain.
export default tseslint.config(
  { ignores: ["dist/**", "**/*.js", "**/*.mjs", "**/*.cjs"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // require() of node built-ins shows up in a few tests — advisory only.
      "@typescript-eslint/no-require-imports": "warn",
      "prefer-const": "error",
    },
  },
);
