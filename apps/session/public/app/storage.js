export function storedArray(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function storedObject(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
