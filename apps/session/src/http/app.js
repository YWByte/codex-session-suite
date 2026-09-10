import express from "express";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asAppError, AppError } from "../errors.js";
import { resolvePackageFile } from "../../../../src/dependency-paths.js";
import { assertOpaqueId, enforceLocalRequest } from "./security.js";
import { writeSseEvent } from "./event-bus.js";
import { readGitContext } from "../services/git-context.js";
import { DifitService } from "../services/difit-service.js";
import { DifgraphService } from "../services/difgraph-service.js";
import { FolderPicker } from "../services/folder-picker.js";
import { PathOpener } from "../services/path-opener.js";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicDirectory = path.join(projectDirectory, "public");
const vendorFiles = Object.freeze({
  "/vendor/marked.js": resolvePackageFile("marked", "lib/marked.umd.js", import.meta.url),
  "/vendor/purify.js": resolvePackageFile("dompurify", "dist/purify.min.js", import.meta.url),
  "/vendor/highlight.js": resolvePackageFile("@highlightjs/cdn-assets", "highlight.min.js", import.meta.url),
  "/vendor/highlight.css": resolvePackageFile("@highlightjs/cdn-assets", "styles/github.min.css", import.meta.url),
  "/vendor/mermaid.js": resolvePackageFile("mermaid", "dist/mermaid.min.js", import.meta.url),
});

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response)).catch(next);
}

export function createApp({
  config,
  client,
  navigation,
  sessions,
  requests,
  eventBus,
  difit = new DifitService(),
  difgraph = new DifgraphService(),
  folderPicker = new FolderPicker({ timeout: config.folderPickerTimeoutMs }),
  pathOpener = new PathOpener(),
  gitContextReader = readGitContext,
  statFile = stat,
}) {
  const viewerOrigins = config.viewerOrigins || Object.freeze({
    session: config.origin,
    plan: "http://127.0.0.1:3458",
    arch: "http://127.0.0.1:3459",
    collect: "http://127.0.0.1:3461",
  });
  const collectUrl = new URL(viewerOrigins.collect);
  const collectLocalhostOrigin = `http://localhost:${collectUrl.port}`;
  const app = express();
  app.disable("x-powered-by");
  app.use(enforceLocalRequest);
  app.use((_request, response, next) => {
    response.set({
      "Content-Security-Policy": `default-src 'self'; connect-src 'self' ${viewerOrigins.collect} ${collectLocalhostOrigin}; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    next();
  });
  app.use(express.json({ limit: config.maxRequestBytes, type: "application/json" }));

  for (const [route, relativePath] of Object.entries(vendorFiles)) {
    app.get(route, (_request, response) => response.sendFile(relativePath));
  }

  app.get("/api/config", (_request, response) => {
    response.json({ locale: config.locale || "auto", viewerOrigins });
  });

  app.get("/runtime-config.js", (_request, response) => {
    response.type("text/javascript").send(`globalThis.__CODEX_SUITE_CONFIG__ = ${JSON.stringify({ locale: config.locale || "auto", viewerOrigins })};`);
  });

  app.get("/health", (_request, response) => {
    response.json({
      viewer: { name: "codex-session-viewer", version: "0.5.0" },
      appServer: client.health(),
    });
  });

  app.post("/api/app-server/restart", asyncRoute(async (_request, response) => {
    sessions.assertRestartSafe();
    if (requests.pending().length) {
      throw new AppError(409, "restart_blocked", "当前仍有待处理请求，请处理后再重启");
    }
    const appServer = await client.restart();
    if (!appServer.ready) {
      throw new AppError(503, "app_server_restart_failed", "Codex app-server 重启失败", {
        state: appServer.state,
        expectedVersion: appServer.expectedVersion,
        actualVersion: appServer.actualVersion,
      });
    }
    response.json({ appServer });
  }));

  app.get("/api/models", asyncRoute(async (_request, response) => {
    response.json({ models: await sessions.models() });
  }));

  app.get("/api/projects", asyncRoute(async (_request, response) => {
    response.json({
      projects: await navigation.refresh(),
      currentSubagentIds: sessions.currentSubagentIds?.() || [],
    });
  }));

  app.get("/api/projects/:projectId/sessions", asyncRoute(async (request, response) => {
    response.json({ sessions: navigation.sessions(assertOpaqueId(request.params.projectId, "projectId")) });
  }));

  app.get("/api/sessions/search", asyncRoute(async (request, response) => {
    const query = String(request.query.q || "");
    if (query.length > 500) throw new AppError(400, "invalid_query", "搜索词过长");
    response.json({ sessions: navigation.search(query) });
  }));

  app.get("/api/sessions/archived", asyncRoute(async (_request, response) => {
    response.json({ sessions: await navigation.refreshArchived() });
  }));

  app.get("/api/sessions/:threadId", asyncRoute(async (request, response) => {
    response.json({ session: await sessions.read(assertOpaqueId(request.params.threadId, "threadId")) });
  }));

  app.get("/api/sessions/:threadId/relations", asyncRoute(async (request, response) => {
    const threadId = assertOpaqueId(request.params.threadId, "threadId");
    navigation.requireAnyThread(threadId);
    const [children, descendants] = await Promise.all([
      navigation.listChildren(threadId),
      navigation.listDescendants(threadId),
    ]);
    response.json({ threadId, children, descendants });
  }));

  app.get("/api/sessions/:threadId/git-context", asyncRoute(async (request, response) => {
    const thread = navigation.requireThread(assertOpaqueId(request.params.threadId, "threadId"));
    if (!thread.cwd) throw new AppError(409, "git_context_unavailable", "该会话没有可用的工作目录");
    response.json(await gitContextReader(thread.cwd));
  }));

  app.post("/api/sessions/:threadId/difit", asyncRoute(async (request, response) => {
    const thread = navigation.requireThread(assertOpaqueId(request.params.threadId, "threadId"));
    if (!thread.cwd) throw new AppError(409, "git_context_unavailable", "该会话没有可用的工作目录");
    const mode = request.body?.mode;
    if (mode !== "staged" && mode !== "committed") throw new AppError(400, "invalid_difit_mode", "不支持的 Difit 查看模式");
    try {
      if (!(await statFile(config.difitCli)).isFile()) throw new Error("not a file");
    } catch {
      throw new AppError(503, "difit_unavailable", "本地 Difit 尚未构建");
    }
    const context = await gitContextReader(thread.cwd);
    if (!context.available) throw new AppError(409, "git_context_unavailable", context.reason);
    if (mode === "staged" && context.stagedFiles === 0) throw new AppError(409, "no_staged_changes", "暂存区没有改动");
    if (mode === "committed" && (!context.base || context.committedCommits === 0)) {
      throw new AppError(409, "no_committed_changes", context.base ? "当前分支相对基线没有新提交" : "无法确定当前分支的远程基线");
    }
    const launched = await difit.launch({ threadId: thread.id, cliPath: config.difitCli, cwd: thread.cwd, mode, context });
    response.json({ ok: true, url: launched.url });
  }));

  app.post("/api/sessions/:threadId/difgraph", asyncRoute(async (request, response) => {
    const thread = navigation.requireThread(assertOpaqueId(request.params.threadId, "threadId"));
    if (!thread.cwd) throw new AppError(409, "git_context_unavailable", "该会话没有可用的工作目录");
    try {
      if (!(await statFile(config.difgraphApp)).isFile()) throw new Error("not a file");
    } catch {
      throw new AppError(503, "difgraph_unavailable", "本地 Difgraph 尚未安装");
    }
    const context = await gitContextReader(thread.cwd);
    if (!context.available || !context.root) throw new AppError(409, "git_context_unavailable", context.reason || "无法确定 Git 仓库根目录");
    const launched = await difgraph.launch({ appModulePath: config.difgraphApp, repositoryPath: thread.cwd });
    response.json({ ok: true, url: launched.url, reused: launched.reused });
  }));

  app.post("/api/open-path", asyncRoute(async (request, response) => {
    const result = await pathOpener.open(request.body?.path, {
      application: request.body?.application,
      line: request.body?.line,
      column: request.body?.column,
    });
    response.json({ ok: true, ...result });
  }));

  app.get("/api/sessions/:threadId/turns", asyncRoute(async (request, response) => {
    response.json(await sessions.turns(assertOpaqueId(request.params.threadId, "threadId"), request.query));
  }));

  app.get("/api/sessions/:threadId/items", asyncRoute(async (request, response) => {
    if (request.query.turnId) assertOpaqueId(request.query.turnId, "turnId");
    response.json(await sessions.items(assertOpaqueId(request.params.threadId, "threadId"), request.query));
  }));

  app.post("/api/projects/:projectId/sessions", asyncRoute(async (request, response) => {
    const result = await sessions.create(assertOpaqueId(request.params.projectId, "projectId"), request.body?.name);
    response.status(201).json(result);
  }));

  app.post("/api/sessions/from-folder", asyncRoute(async (_request, response) => {
    const selected = await folderPicker.choose();
    if (selected.cancelled) {
      response.json({ cancelled: true });
      return;
    }
    const result = await sessions.createForCwd(selected.cwd);
    response.status(201).json({ cancelled: false, ...result });
  }));

  app.patch("/api/sessions/:threadId", asyncRoute(async (request, response) => {
    const threadId = assertOpaqueId(request.params.threadId, "threadId");
    const session = await sessions.rename(threadId, request.body?.name);
    eventBus.publish("navigation.invalidated", { threadId });
    response.json({ session });
  }));

  app.post("/api/sessions/:threadId/unsubscribe", asyncRoute(async (request, response) => {
    const threadId = assertOpaqueId(request.params.threadId, "threadId");
    const result = await sessions.unsubscribe(threadId);
    eventBus.publish("navigation.invalidated", { threadId });
    response.json({ ok: true, result });
  }));

  app.post("/api/sessions/:threadId/archive", asyncRoute(async (request, response) => {
    const threadId = assertOpaqueId(request.params.threadId, "threadId");
    const result = await sessions.archive(threadId);
    eventBus.publish("navigation.invalidated", { threadId });
    response.json({ ok: true, result });
  }));

  app.post("/api/sessions/:threadId/unarchive", asyncRoute(async (request, response) => {
    const threadId = assertOpaqueId(request.params.threadId, "threadId");
    const session = await sessions.unarchive(threadId);
    eventBus.publish("navigation.invalidated", { threadId });
    response.json({ session });
  }));

  app.delete("/api/sessions/:threadId", asyncRoute(async (request, response) => {
    const threadId = assertOpaqueId(request.params.threadId, "threadId");
    const result = await sessions.delete(threadId);
    eventBus.publish("navigation.invalidated", { threadId });
    response.json({ ok: true, result });
  }));

  app.post("/api/sessions/:threadId/resume", asyncRoute(async (request, response) => {
    const session = await sessions.resume(assertOpaqueId(request.params.threadId, "threadId"));
    response.json({ session });
  }));

  app.post("/api/sessions/:threadId/compact", asyncRoute(async (request, response) => {
    response.status(202).json(await sessions.compact(assertOpaqueId(request.params.threadId, "threadId")));
  }));

  app.post("/api/sessions/:threadId/turns/reconcile", asyncRoute(async (request, response) => {
    response.json(await sessions.reconcileTurn(assertOpaqueId(request.params.threadId, "threadId")));
  }));

  app.post("/api/sessions/:threadId/turns", asyncRoute(async (request, response) => {
    const result = await sessions.startTurn(assertOpaqueId(request.params.threadId, "threadId"), request.body);
    response.status(201).json(result);
  }));

  app.post("/api/sessions/:threadId/turns/:turnId/interrupt", asyncRoute(async (request, response) => {
    const result = await sessions.interrupt(
      assertOpaqueId(request.params.threadId, "threadId"),
      assertOpaqueId(request.params.turnId, "turnId")
    );
    response.json({ ok: true, result });
  }));

  app.get("/api/requests", (_request, response) => response.json({ requests: requests.pending() }));

  app.post("/api/requests/:requestId/resolve", asyncRoute(async (request, response) => {
    const result = requests.resolve(assertOpaqueId(request.params.requestId, "requestId"), request.body);
    response.json(result);
  }));

  app.get("/api/events", (request, response, next) => {
    try {
      const origin = request.get("origin");
      if (origin) {
        const originUrl = new URL(origin);
        const hostUrl = new URL(`http://${request.get("host")}`);
        if (originUrl.hostname !== hostUrl.hostname || originUrl.port !== hostUrl.port) {
          throw new AppError(403, "invalid_origin", "拒绝跨站 SSE 连接");
        }
      }
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.write("retry: 1500\n\n");
      writeSseEvent(response, { type: "connection.state", data: client.health() });
      for (const pending of requests.pending()) writeSseEvent(response, { type: "request.pending", data: pending });

      let blocked = false;
      const queue = [];
      const flush = () => {
        blocked = false;
        while (queue.length && !blocked) blocked = !writeSseEvent(response, queue.shift());
      };
      const listener = (event) => {
        if (blocked) {
          if (queue.length >= 256) {
            response.end();
            return;
          }
          queue.push(event);
          return;
        }
        blocked = !writeSseEvent(response, event);
      };
      const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 15_000);
      heartbeat.unref?.();
      eventBus.on("event", listener);
      response.on("drain", flush);
      request.on("close", () => {
        clearInterval(heartbeat);
        eventBus.off("event", listener);
      });
    } catch (error) {
      next(error);
    }
  });

  app.use(express.static(publicDirectory, { index: "index.html", fallthrough: true }));

  app.use((_request, response) => response.status(404).json({ error: { code: "not_found", message: "资源或接口不存在" } }));

  app.use((error, _request, response, _next) => {
    const normalized = error?.type === "entity.too.large"
      ? new AppError(413, "request_too_large", "请求体过大")
      : error instanceof SyntaxError && error?.status === 400
        ? new AppError(400, "invalid_json", "JSON 请求体无效")
        : asAppError(error);
    if (normalized.status >= 500) console.error(`[codex-session] ${normalized.code}: ${error.message}`);
    response.status(normalized.status).json({
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details === undefined ? {} : { details: normalized.details }),
      },
    });
  });

  return app;
}
