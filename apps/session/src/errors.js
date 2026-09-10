export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asAppError(error) {
  if (error instanceof AppError) return error;
  if (error?.code === "RPC_TIMEOUT") {
    return new AppError(504, "app_server_timeout", "Codex app-server 请求超时");
  }
  if (error?.code === "APP_SERVER_OFFLINE") {
    return new AppError(503, "app_server_offline", "Codex app-server 当前不可用");
  }
  if (error?.code === "CODEX_INCOMPATIBLE") {
    return new AppError(409, "codex_version_incompatible", "当前 Codex 版本与 Viewer 不兼容");
  }
  if (error?.name === "RpcError") {
    if (error.code === -32601) return new AppError(501, "app_server_method_unsupported", "当前 Codex 不支持该操作");
    if (error.code === -32001) return new AppError(503, "app_server_overloaded", "Codex app-server 当前繁忙");
    if (error.code === -32600 || error.code === -32602) {
      return new AppError(409, "app_server_rejected", "Codex 拒绝了当前操作");
    }
    return new AppError(502, "app_server_error", "Codex app-server 执行失败");
  }
  return new AppError(500, "internal_error", "服务器内部错误");
}
