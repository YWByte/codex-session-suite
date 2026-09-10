import assert from "node:assert/strict";
import test from "node:test";
import { commandPresentation } from "../public/command-display.js";

test("commandPresentation separates the fixed zsh environment from its command", () => {
  assert.deepEqual(commandPresentation('/bin/zsh -lc "sed -n \'1,20p\' file.js"'), {
    env: "/bin/zsh -lc",
    command: "sed -n '1,20p' file.js",
  });
  assert.deepEqual(commandPresentation(String.raw`/bin/zsh -lc "printf \"done\""`), {
    env: "/bin/zsh -lc",
    command: 'printf "done"',
  });
});

test("commandPresentation keeps commands without the fixed wrapper unchanged", () => {
  assert.deepEqual(commandPresentation("git status --short"), {
    env: null,
    command: "git status --short",
  });
});
