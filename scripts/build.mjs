import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "lib");

const inlineCss = {
  name: "inline-css",
  setup(builder) {
    builder.onResolve({ filter: /\.css\?inline$/ }, (args) => ({
      path: args.path.slice(0, -"?inline".length),
      namespace: "inline-css",
      pluginData: { sourcePath: resolve(args.resolveDir, args.path.slice(0, -"?inline".length)) }
    }));
    builder.onLoad({ filter: /.*/, namespace: "inline-css" }, async (args) => ({
      contents: await readFile(args.pluginData.sourcePath, "utf8"),
      loader: "text"
    }));
  }
};

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await build({
  entryPoints: [resolve(root, "src/index.ts")],
  outfile: resolve(output, "index.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  treeShaking: true,
  external: ["@deepseek-ai/*"]
});

await build({
  entryPoints: [resolve(root, "src/client/index.tsx")],
  outfile: resolve(output, "client.js"),
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: ["chrome120", "safari17"],
  sourcemap: true,
  treeShaking: true,
  define: { "process.env.NODE_ENV": '"production"' },
  minifySyntax: true,
  external: ["@deepseek-ai/*", "react", "react/jsx-runtime", "react-dom", "react-dom/client"],
  plugins: [inlineCss],
  banner: {
    js: "window.__ModuleLoader__.load({id:\"@cylunex/shadow-nexus\",factory:(require)=>{var module={exports:{}};var exports=module.exports;"
  },
  footer: { js: ";return module.exports;}});" }
});
