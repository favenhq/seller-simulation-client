import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import typescript from "typescript";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && specifier.endsWith(".js")) {
    const typescriptUrl = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);

    try {
      await readFile(typescriptUrl);
      return { url: typescriptUrl.href, shortCircuit: true };
    } catch {
      // The import may refer to a JavaScript file rather than TypeScript.
    }
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith(".ts")) return nextLoad(url, context);

  const source = await readFile(fileURLToPath(url), "utf8");
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2023,
    },
    fileName: fileURLToPath(url),
  });

  return { format: "module", source: output.outputText, shortCircuit: true };
}
