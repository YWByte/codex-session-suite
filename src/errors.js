export class SuiteError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SuiteError";
    this.code = code;
    this.details = details;
  }
}
