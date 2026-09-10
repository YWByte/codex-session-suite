import { AppError } from "../errors.js";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/;
const IMAGE_DETAILS = new Set(["auto", "low", "high", "original"]);

function invalidImage() {
  return new AppError(400, "invalid_image", "图片必须是有效的内嵌图片数据");
}

function decodedByteLength(base64) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

function base64Value(character) {
  const code = character.charCodeAt(0);
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26;
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52;
  if (code === 0x2b) return 62;
  if (code === 0x2f) return 63;
  return -1;
}

function isStrictBase64(base64) {
  if (!base64 || base64.length % 4 !== 0) return false;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  for (let index = 0; index < base64.length - padding; index += 1) {
    if (base64Value(base64[index]) === -1) return false;
  }
  for (let index = base64.length - padding; index < base64.length; index += 1) {
    if (base64[index] !== "=") return false;
  }
  if (padding === 2 && (base64Value(base64.at(-3)) & 0x0f) !== 0) return false;
  if (padding === 1 && (base64Value(base64.at(-2)) & 0x03) !== 0) return false;
  return true;
}

function hasMagicBytes(bytes, mimeType) {
  if (mimeType === "image/png") {
    return bytes.length >= 8
      && bytes[0] === 0x89
      && bytes[1] === 0x50
      && bytes[2] === 0x4e
      && bytes[3] === 0x47
      && bytes[4] === 0x0d
      && bytes[5] === 0x0a
      && bytes[6] === 0x1a
      && bytes[7] === 0x0a;
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/gif") {
    return bytes.length >= 6
      && (bytes.subarray(0, 6).toString("ascii") === "GIF87a"
        || bytes.subarray(0, 6).toString("ascii") === "GIF89a");
  }
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function sourceUrl(image) {
  if (!image || typeof image !== "object" || Array.isArray(image) || "path" in image || "input" in image) {
    throw invalidImage();
  }
  const hasUrl = Object.hasOwn(image, "url");
  const hasDataUrl = Object.hasOwn(image, "dataUrl");
  if (hasUrl === hasDataUrl) throw invalidImage();
  const url = hasUrl ? image.url : image.dataUrl;
  if (typeof url !== "string") throw invalidImage();
  return url;
}

function detailOf(image) {
  const detail = image.detail === undefined ? "high" : image.detail;
  if (!IMAGE_DETAILS.has(detail)) {
    throw new AppError(400, "invalid_image_detail", "图片 detail 必须是 auto、low、high 或 original");
  }
  return detail;
}

export function normalizeImageInputs(images) {
  if (images === undefined || images === null) return [];
  if (!Array.isArray(images)) {
    throw new AppError(400, "invalid_images", "images 必须是图片数组");
  }
  if (images.length > MAX_IMAGES) {
    throw new AppError(400, "too_many_images", "单条消息最多包含 4 张图片");
  }

  let totalBytes = 0;
  return images.map((image) => {
    const url = sourceUrl(image);
    const match = DATA_URL_PATTERN.exec(url);
    if (!match) throw invalidImage();

    const [, mimeType, base64] = match;
    if (!isStrictBase64(base64)) throw invalidImage();

    const byteLength = decodedByteLength(base64);
    if (byteLength > MAX_IMAGE_BYTES) {
      throw new AppError(413, "image_too_large", "单张图片不能超过 5 MiB");
    }
    totalBytes += byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new AppError(413, "images_too_large", "图片总大小不能超过 16 MiB");
    }

    const bytes = Buffer.from(base64, "base64");
    if (bytes.length !== byteLength || !hasMagicBytes(bytes, mimeType)) throw invalidImage();

    return { type: "image", url, detail: detailOf(image) };
  });
}

export function hasMessageContent(text, images) {
  return (typeof text === "string" && text.trim().length > 0)
    || (Array.isArray(images) && images.length > 0);
}
