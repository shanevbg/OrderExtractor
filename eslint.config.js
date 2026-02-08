import js from "@eslint/js";
import globals from "globals";

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                messenger: "readonly",
                browser: "readonly"
            }
        },
        rules: {
            "no-unused-vars": "warn",
            "no-console": "off",
            "max-len": "off", // Keeps your compressed style intact
            "no-prototype-builtins": "off"
        }
    }
];