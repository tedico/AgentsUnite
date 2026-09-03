import { spawn } from 'node:child_process';

export function runHeadless({ cmd, args, stdinText, timeoutMs = 300000, signal }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError = false;
    let settled = false;

    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, spawnError });
    };

    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    signal?.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });

    child.on('error', (err) => { spawnError = true; stderr += String(err); finish(-1); });
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => finish(code ?? -1));

    // F4: a fast-failing child can close its stdin before we finish writing
    // (e.g. exits immediately), which turns the write into an EPIPE. With no
    // listener, that 'error' event is unhandled and kills the whole process.
    child.stdin.on('error', () => {});

    if (child.stdin.writable) {
      if (stdinText != null) child.stdin.write(stdinText);
      child.stdin.end();
    }
  });
}

export function extractJson(text) {
  let start = text.indexOf('{');
  while (start !== -1) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    let foundClose = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          foundClose = true;
          try { return JSON.parse(text.slice(start, i + 1)); } catch {}
          // Parse failed; try next candidate
          break;
        }
      }
    }
    // If we found a close but parse failed, or never found close, try next {
    start = text.indexOf('{', start + 1);
  }
  return null;
}
