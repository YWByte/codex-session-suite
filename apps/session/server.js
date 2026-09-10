import { loadConfig } from "./src/config.js";
import { AppServerClient } from "./src/app-server/client.js";
import { EventBus } from "./src/http/event-bus.js";
import { createApp } from "./src/http/app.js";
import { NavigationService } from "./src/services/navigation.js";
import { RequestRegistry } from "./src/services/request-registry.js";
import { SessionService } from "./src/services/session-service.js";
import { RolloutTokenUsageReader } from "./src/services/rollout-token-usage.js";
import { connectProtocolEvents } from "./src/services/protocol-events.js";
import { DifgraphService } from "./src/services/difgraph-service.js";

const config = loadConfig();
const eventBus = new EventBus();
const client = new AppServerClient(config);
const navigation = new NavigationService(client, config);
const tokenUsageReader = new RolloutTokenUsageReader({ codexHome: config.codexHome });
const sessions = new SessionService(client, navigation, { tokenUsageReader });
const requests = new RequestRegistry(client, eventBus);
const difgraph = new DifgraphService();
connectProtocolEvents(client, navigation, sessions, requests, eventBus);

function safeDiagnostic(message) {
  return String(message)
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/(["']?(?:access_token|refresh_token|api_key|token)["']?\s*[:=]\s*)[^\s,}]+/gi, "$1[redacted]")
    .replace(/[^\s"']*\/auth\.json/gi, "[redacted-auth-path]")
    .trimEnd();
}

client.on("diagnostic", (message) => console.error(`[codex app-server] ${safeDiagnostic(message)}`));
client.on("permissionAudit", (event) => {
  console.log(`[codex-session] permission ${JSON.stringify({
    timestamp: new Date().toISOString(),
    ...event,
  })}`);
});
let reconnectTimer = null;
client.on("state", (health) => {
  if (health.state !== "offline" || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void client.start();
  }, 3_000);
  reconnectTimer.unref?.();
});

const app = createApp({ config, client, navigation, sessions, requests, eventBus, difgraph });
const server = app.listen(config.port, config.host, () => {
  console.log(`[codex-session] http://${config.host}:${config.port}`);
  void client.start().then((health) => {
    if (!health.ready) console.error(`[codex-session] app-server unavailable: ${health.error}`);
  });
});

let shuttingDown = false;

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  client.stop();
  const forceExit = setTimeout(() => process.exit(1), 5_000);
  forceExit.unref();
  await Promise.allSettled([
    difgraph.stopAll(),
    new Promise((resolve) => server.close(resolve)),
  ]);
  clearTimeout(forceExit);
  process.exit(exitCode);
}

server.on("error", (error) => {
  console.error(`[codex-session] listen failed: ${error.message}`);
  void shutdown(1);
});

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
