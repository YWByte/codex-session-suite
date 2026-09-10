import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

export class EventBus extends EventEmitter {
  #prefix = randomUUID();
  #sequence = 0;

  publish(type, data = {}) {
    this.emit("event", {
      id: `${this.#prefix}:${++this.#sequence}`,
      type,
      data,
      emittedAt: new Date().toISOString(),
    });
  }
}

export function writeSseEvent(response, event) {
  const id = event.id ? `id: ${event.id}\n` : "";
  return response.write(`${id}event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
}
