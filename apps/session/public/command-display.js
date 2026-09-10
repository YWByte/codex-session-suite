const COMMAND_ENV = "/bin/zsh -lc";

export function commandPresentation(value) {
  const text = typeof value === "string" ? value : "";
  if (!text.startsWith(`${COMMAND_ENV} `)) return { env: null, command: text };
  const wrapped = text.slice(COMMAND_ENV.length).trimStart();
  const quote = wrapped[0];
  if ((quote === '"' || quote === "'") && wrapped.at(-1) === quote) {
    const command = wrapped.slice(1, -1);
    return {
      env: COMMAND_ENV,
      command: quote === '"' ? command.replace(/\\(["\\$`])/g, "$1") : command,
    };
  }
  return { env: COMMAND_ENV, command: wrapped };
}
