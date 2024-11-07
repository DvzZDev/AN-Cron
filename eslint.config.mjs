import globals from "globals"
import pluginJs from "@eslint/js"

export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    env: {
      node: true,
      es2021: true,
    },
    rules: {},
  },
  pluginJs.configs.recommended,
]
