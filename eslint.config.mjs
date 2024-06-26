import globals from "globals";
import pluginJs from "@eslint/js";

export default [
  { files: ["**/*.js"], languageOptions: { sourceType: "module" } }, // Change this line
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
];
