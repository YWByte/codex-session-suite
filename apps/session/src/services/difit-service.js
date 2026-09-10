import { launchDifit } from "./difit-launcher.js";

export class DifitService {
  #launch;
  #inFlight = new Map();

  constructor({ launch = launchDifit } = {}) {
    this.#launch = launch;
  }

  launch(request) {
    const key = `${request.threadId}\0${request.mode}`;
    const current = this.#inFlight.get(key);
    if (current) return current;

    const operation = Promise.resolve().then(() => this.#launch(request));
    this.#inFlight.set(key, operation);
    operation.then(
      () => { if (this.#inFlight.get(key) === operation) this.#inFlight.delete(key); },
      () => { if (this.#inFlight.get(key) === operation) this.#inFlight.delete(key); },
    );
    return operation;
  }
}
