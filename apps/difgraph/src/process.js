import { spawn } from 'node:child_process';

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', code => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr).toString('utf8').trim();
      if (code === 0) resolve(out);
      else reject(new Error(err || `${command} exited with code ${code}`));
    });
    child.stdin.end(options.input);
  });
}
