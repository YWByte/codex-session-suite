import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skippedDirectories = new Set([".git", "node_modules", "coverage", "playwright-report", "test-results"]);
const textExtensions = new Set([".js", ".mjs", ".cjs", ".json", ".md", ".html", ".css", ".toml", ".yml", ".yaml", ".txt"]);
const forbiddenFilePatterns = [/auth\.json$/i, /\.pem$/i, /\.key$/i, /\.jsonl$/i, /\.db$/i, /config\.toml$/i, /\.png$/i, /\.jpe?g$/i];
const sensitiveContentPatterns = [
  { name: "personal absolute path", pattern: /\/Users\/wondery(?:\/|\b)/ },
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { name: "OpenAI key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

const findings = [];
for (const file of await walk(root)) {
  const relative = path.relative(root, file);
  const documentationScreenshot = /^docs\/screenshots\/[a-z0-9-]+\.png$/i.test(relative);
  if (forbiddenFilePatterns.some((pattern) => pattern.test(relative)) && !relative.endsWith("config.example.toml") && !documentationScreenshot) {
    findings.push(`${relative}: forbidden publish file type`);
  }
  if (!textExtensions.has(path.extname(file))) continue;
  const content = await readFile(file, "utf8");
  for (const check of sensitiveContentPatterns) {
    if (check.pattern.test(content)) findings.push(`${relative}: ${check.name}`);
  }
  if (/\.(?:js|mjs|cjs|css|html)$/.test(file)) {
    content.split(/\r?\n/).forEach((line, index) => {
      const commentLine = /^\s*(?:\/\/|\*|\/\*|<!--)/.test(line);
      if (commentLine && /[\u3400-\u9fff]/.test(line)) findings.push(`${relative}:${index + 1}: non-English code comment`);
    });
  }
}

try {
  const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  const report = JSON.parse(stdout)[0];
  for (const entry of report.files || []) {
    if (/(^|\/)(test|\.github)(\/|$)|config\.toml$|\.DS_Store$|\.(?:jsonl|db|pem|key)$/i.test(entry.path)) {
      findings.push(`${entry.path}: forbidden tarball entry`);
    }
  }
} catch (error) {
  findings.push(`npm pack audit failed: ${error.message}`);
}

if (findings.length) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Release audit passed.");
}
