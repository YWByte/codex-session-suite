export class JsonlDecoder {
  #decoder = new TextDecoder("utf-8", { fatal: true });
  #buffer = "";

  push(chunk) {
    this.#buffer += this.#decoder.decode(chunk, { stream: true });
    return this.#drain(false);
  }

  finish() {
    this.#buffer += this.#decoder.decode();
    return this.#drain(true);
  }

  #drain(final) {
    const lines = this.#buffer.split("\n");
    const trailing = lines.pop();
    this.#buffer = final ? "" : trailing;
    const messages = [];

    for (const rawLine of lines) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!line.trim()) continue;
      messages.push(this.#parse(line));
    }

    if (final && trailing.trim()) messages.push(this.#parse(trailing));
    return messages;
  }

  #parse(line) {
    const message = JSON.parse(line);
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new TypeError("app-server JSONL message must be an object");
    }
    return message;
  }
}
