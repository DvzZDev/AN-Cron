import globals from "globals"
import pluginJs from "@eslint/js"

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    files: ["**/*.{js,mjs}"],
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
      eqeqeq: "error",
    },
    parserOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
    },
  },
  pluginJs.configs.recommended,
]
