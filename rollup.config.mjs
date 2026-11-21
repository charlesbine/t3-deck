import { builtinModules } from "node:module";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default {
  input: "src/plugin.ts",
  output: {
    file: "com.charlesbine.t3-deck.sdPlugin/bin/plugin.js",
    format: "esm",
    sourcemap: true
  },
  external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
  plugins: [
    nodeResolve({ exportConditions: ["node"] }),
    commonjs(),
    typescript({ tsconfig: "./tsconfig.json" })
  ]
};
