import assert from "node:assert/strict";
import test from "node:test";
import { hasMessageContent, normalizeImageInputs } from "../src/services/image-input.js";

const MAGIC_BYTES = {
  "image/png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": Buffer.from([0xff, 0xd8, 0xff]),
  "image/gif": Buffer.from("GIF89a", "ascii"),
  "image/webp": Buffer.from("RIFF\x00\x00\x00\x00WEBP", "ascii"),
};

function dataUrl(mimeType = "image/png", bytes = MAGIC_BYTES[mimeType]) {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function image(mimeType, detail) {
  return { dataUrl: dataUrl(mimeType), ...(detail === undefined ? {} : { detail }) };
}

function assertImageError(callback, code) {
  assert.throws(callback, (error) => error.code === code);
}

test("normalizes supported data URL images into Codex inputs", () => {
  const inputs = normalizeImageInputs([
    image("image/png"),
    image("image/jpeg", "auto"),
    image("image/gif", "low"),
    image("image/webp", "original"),
  ]);

  assert.deepEqual(inputs, [
    { type: "image", url: dataUrl("image/png"), detail: "high" },
    { type: "image", url: dataUrl("image/jpeg"), detail: "auto" },
    { type: "image", url: dataUrl("image/gif"), detail: "low" },
    { type: "image", url: dataUrl("image/webp"), detail: "original" },
  ]);
});

test("accepts the Viewer url field but never passes source DTO fields through", () => {
  const url = dataUrl();
  assert.deepEqual(normalizeImageInputs([{ url, detail: "high" }]), [{ type: "image", url, detail: "high" }]);
});

test("rejects unsupported image sources and does not echo a data URL", () => {
  const secretUrl = `${dataUrl()}secret-image-payload`;
  const invalidSources = [
    { dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" },
    { dataUrl: "https://example.test/image.png" },
    { dataUrl: "blob:https://example.test/image" },
    { dataUrl: "file:///tmp/image.png" },
    { path: "/tmp/image.png" },
    { input: { type: "localImage", path: "/tmp/image.png" } },
    { dataUrl: secretUrl },
  ];

  for (const source of invalidSources) {
    assertImageError(() => normalizeImageInputs([source]), "invalid_image");
  }
  assert.throws(
    () => normalizeImageInputs([{ dataUrl: secretUrl }]),
    (error) => error.code === "invalid_image" && !error.message.includes(secretUrl)
  );
});

test("rejects malformed base64 and MIME signatures that do not match", () => {
  for (const url of [
    "data:image/png;base64,abc",
    "data:image/png;base64,AAAA=",
    "data:image/png;base64,AAAA!===",
    "data:image/png;base64,iVBORw0KGgp=",
    dataUrl("image/png", MAGIC_BYTES["image/jpeg"]),
    dataUrl("image/webp", Buffer.from("RIFF\x00\x00\x00\x00NOPE", "ascii")),
  ]) {
    assertImageError(() => normalizeImageInputs([{ dataUrl: url }]), "invalid_image");
  }
});

test("rejects invalid detail values and non-array image payloads", () => {
  for (const detail of ["medium", "HIGH", null, 1]) {
    assertImageError(() => normalizeImageInputs([image("image/png", detail)]), "invalid_image_detail");
  }
  assertImageError(() => normalizeImageInputs({ dataUrl: dataUrl() }), "invalid_images");
  assert.deepEqual(normalizeImageInputs(), []);
  assert.deepEqual(normalizeImageInputs(null), []);
});

test("enforces image count and decoded image size boundaries", () => {
  const png = MAGIC_BYTES["image/png"];
  const exactlyFiveMiB = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024 - png.length)]);
  const overFiveMiB = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024 - png.length + 1)]);

  assert.equal(normalizeImageInputs(Array.from({ length: 4 }, () => ({ dataUrl: dataUrl("image/png", png) }))).length, 4);
  assertImageError(() => normalizeImageInputs(Array.from({ length: 5 }, () => ({ dataUrl: dataUrl() }))), "too_many_images");
  assert.equal(normalizeImageInputs([{ dataUrl: dataUrl("image/png", exactlyFiveMiB) }]).length, 1);
  assertImageError(() => normalizeImageInputs([{ dataUrl: dataUrl("image/png", overFiveMiB) }]), "image_too_large");
});

test("enforces the total decoded image size boundary", () => {
  const png = MAGIC_BYTES["image/png"];
  const fourMiB = Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024 - png.length)]);
  const overFourMiB = Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024 - png.length + 1)]);

  assert.equal(normalizeImageInputs(Array.from({ length: 4 }, () => ({ dataUrl: dataUrl("image/png", fourMiB) }))).length, 4);
  assertImageError(
    () => normalizeImageInputs([
      { dataUrl: dataUrl("image/png", fourMiB) },
      { dataUrl: dataUrl("image/png", fourMiB) },
      { dataUrl: dataUrl("image/png", fourMiB) },
      { dataUrl: dataUrl("image/png", overFourMiB) },
    ]),
    "images_too_large"
  );
});

test("recognizes a non-empty text or image message", () => {
  assert.equal(hasMessageContent("", []), false);
  assert.equal(hasMessageContent("  ", []), false);
  assert.equal(hasMessageContent("text", []), true);
  assert.equal(hasMessageContent("  ", [image("image/png")]), true);
  assert.equal(hasMessageContent(null, [image("image/png")]), true);
});
