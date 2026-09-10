import { AppError } from "../errors.js";

function stripIpv6Brackets(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isLoopback(hostname) {
  const normalized = stripIpv6Brackets(hostname).toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

export function enforceLocalRequest(request, _response, next) {
  try {
    const hostHeader = request.get("host");
    if (!hostHeader) throw new AppError(400, "invalid_host", "缺少 Host 请求头");
    const hostUrl = new URL(`http://${hostHeader}`);
    if (!isLoopback(hostUrl.hostname)) {
      throw new AppError(403, "invalid_host", "仅允许通过本机回环地址访问");
    }

    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.get("origin");
      if (origin) {
        const originUrl = new URL(origin);
        if (!isLoopback(originUrl.hostname) || originUrl.port !== hostUrl.port) {
          throw new AppError(403, "invalid_origin", "拒绝跨站写请求");
        }
      }
      if (!request.is("application/json")) {
        throw new AppError(415, "unsupported_media_type", "写请求必须使用 application/json");
      }
    }
    next();
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(400, "invalid_request_origin", "无效的来源请求头"));
  }
}

export function assertOpaqueId(value, name) {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new AppError(400, "invalid_identifier", `${name} 格式无效`);
  }
  return value;
}
