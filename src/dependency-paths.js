import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

export function resolvePackageDirectory(packageName, baseUrl = import.meta.url) {
  let directory = path.dirname(createRequire(baseUrl).resolve(packageName));
  while (true) {
    const manifestPath = path.join(directory, "package.json");
    if (existsSync(manifestPath)) {
      try {
        if (JSON.parse(readFileSync(manifestPath, "utf8")).name === packageName) return directory;
      } catch {}
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Unable to locate package directory for ${packageName}`);
    directory = parent;
  }
}

export function resolvePackageFile(packageName, relativePath, baseUrl = import.meta.url) {
  const require = createRequire(baseUrl);
  try { return require.resolve(`${packageName}/${relativePath}`); } catch {}
  return path.join(resolvePackageDirectory(packageName, baseUrl), relativePath);
}
