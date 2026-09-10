import test from 'node:test';
import assert from 'node:assert/strict';
import { FolderPicker } from '../src/folder-picker.js';

const directory = () => ({ isDirectory: () => true });

test('opens the macOS directory chooser and validates its result', async () => {
  let invocation;
  const picker = new FolderPicker({
    execFileImpl(command, args, options, callback) {
      invocation = { command, args, options };
      callback(null, '/workspace/repository/\n');
    },
    statImpl: async () => directory(),
    platform: 'darwin',
  });
  assert.deepEqual(await picker.choose(), { cancelled: false, directory: '/workspace/repository' });
  assert.equal(invocation.command, '/usr/bin/osascript');
  assert.match(invocation.args[1], /choose folder/);
  assert.equal(invocation.options.shell, false);
});

test('reports cancellation without validating a path', async () => {
  let statCalls = 0;
  const picker = new FolderPicker({
    execFileImpl(_command, _args, _options, callback) { callback(null, '__DIFGRAPH_FOLDER_PICKER_CANCELLED__\n'); },
    statImpl: async () => { statCalls += 1; return directory(); },
    platform: 'darwin',
  });
  assert.deepEqual(await picker.choose(), { cancelled: true });
  assert.equal(statCalls, 0);
});
