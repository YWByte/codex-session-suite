import { pathToFileURL } from "node:url";

const [, , appModulePath, repositoryPath] = process.argv;

try {
  if (!appModulePath || !repositoryPath) throw new Error("Difgraph 启动参数不完整");
  const module = await import(pathToFileURL(appModulePath).href);
  if (typeof module.startApplication !== "function") throw new Error("Difgraph 未导出 startApplication");
  const application = await module.startApplication({
    repositoryPath,
    host: "127.0.0.1",
    port: 0,
    open: false,
  });
  process.stdout.write(`${JSON.stringify({ url: application.url, pid: process.pid })}\n`);
} catch (error) {
  process.stderr.write(`Difgraph 启动失败：${error?.message || "未知错误"}\n`);
  process.exitCode = 1;
}
