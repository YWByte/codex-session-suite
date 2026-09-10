const messages = Object.freeze({
  en: Object.freeze({
    usage: `Usage: codex-session-suite [start] [options]\n       codex-session-suite doctor [options]\n\nOptions:\n  --config <path>       Load a TOML configuration file\n  --locale <locale>     Use en or zh-CN\n  --no-open             Do not open a browser\n  --help                Show help\n  --version             Show version`,
    starting: "Starting Codex Session Suite...",
    started: "Codex Session Suite is available at {url}",
    stopping: "Stopping Codex Session Suite...",
    configOk: "Configuration is valid.",
    codexOk: "Codex CLI {version} is ready at {path}.",
    doctorOk: "All required checks passed.",
    error: "Error: {message}",
    "error.config_not_found": "Configuration file not found: {path}",
    "error.config_root": "The TOML root must be a table.",
    "error.credential_key": "Credential-like configuration keys are not allowed: {key}",
    "error.unknown_section": "Unknown configuration section: {section}",
    "error.invalid_section": "Configuration section {section} must be a table.",
    "error.unknown_key": "Unknown configuration key: {key}",
    "error.invalid_integer": "{name} must be an integer from {min} to {max}.",
    "error.invalid_boolean": "{name} must be a boolean.",
    "error.duplicate_ports": "Service ports must be unique.",
    "error.invalid_locale": "ui.locale must be auto, en, or zh-CN.",
    "error.codex_not_found": "Codex CLI was not found on PATH; configure codex.bin or CODEX_BIN.",
    "error.codex_home_missing": "Codex home does not exist: {path}",
    "error.codex_version_parse": "Unable to parse the Codex CLI version.",
    "error.codex_version_mismatch": "Codex CLI {expected} is required, but {actual} was found at {path}.",
    "error.port_unavailable": "Port {port} is unavailable on {host}: {reason}",
    "error.service_exited": "A required service exited before becoming ready: {origin}",
    "error.service_timeout": "A required service did not become ready: {origin}",
    "error.startup_interrupted": "Suite startup was interrupted.",
    "error.service_stopped": "A required service exited unexpectedly ({reason}).",
  }),
  "zh-CN": Object.freeze({
    usage: `用法：codex-session-suite [start] [选项]\n      codex-session-suite doctor [选项]\n\n选项：\n  --config <路径>       加载 TOML 配置文件\n  --locale <语言>       使用 en 或 zh-CN\n  --no-open             不自动打开浏览器\n  --help                显示帮助\n  --version             显示版本`,
    starting: "正在启动 Codex Session Suite…",
    started: "Codex Session Suite 已在 {url} 启动",
    stopping: "正在停止 Codex Session Suite…",
    configOk: "配置有效。",
    codexOk: "Codex CLI {version} 已就绪：{path}",
    doctorOk: "所有必需检查均已通过。",
    error: "错误：{message}",
    "error.config_not_found": "找不到配置文件：{path}",
    "error.config_root": "TOML 根节点必须是表。",
    "error.credential_key": "不允许使用疑似凭据的配置项：{key}",
    "error.unknown_section": "未知配置分区：{section}",
    "error.invalid_section": "配置分区 {section} 必须是表。",
    "error.unknown_key": "未知配置项：{key}",
    "error.invalid_integer": "{name} 必须是 {min} 到 {max} 之间的整数。",
    "error.invalid_boolean": "{name} 必须是布尔值。",
    "error.duplicate_ports": "服务端口不能重复。",
    "error.invalid_locale": "ui.locale 必须是 auto、en 或 zh-CN。",
    "error.codex_not_found": "在 PATH 中找不到 Codex CLI；请配置 codex.bin 或 CODEX_BIN。",
    "error.codex_home_missing": "Codex 主目录不存在：{path}",
    "error.codex_version_parse": "无法解析 Codex CLI 版本。",
    "error.codex_version_mismatch": "需要 Codex CLI {expected}，但 {path} 的版本为 {actual}。",
    "error.port_unavailable": "{host} 上的端口 {port} 不可用：{reason}",
    "error.service_exited": "必需服务在就绪前退出：{origin}",
    "error.service_timeout": "必需服务未能按时就绪：{origin}",
    "error.startup_interrupted": "套件启动已中断。",
    "error.service_stopped": "必需服务意外退出（{reason}）。",
  }),
});

export function normalizeLocale(value, fallback = "en") {
  if (!value || value === "auto") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (/^zh(?:$|(?:[-_](?:hans|cn))(?:[._-]|$))/.test(normalized)) return "zh-CN";
  return /^en(?:[._-]|$)/.test(normalized) ? "en" : fallback;
}

export function systemLocale(env = process.env) {
  return normalizeLocale(env.LC_ALL || env.LC_MESSAGES || env.LANG || "en");
}

export function translator(locale) {
  const selected = messages[normalizeLocale(locale)] || messages.en;
  return (key, values = {}) => {
    const template = selected[key] ?? messages.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
  };
}

export function localizeError(error, t) {
  const key = error?.code ? `error.${error.code}` : null;
  const translated = key ? t(key, error.details || {}) : null;
  return translated && translated !== key ? translated : error?.message || String(error);
}
