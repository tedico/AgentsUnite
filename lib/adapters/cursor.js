import { runHeadless, extractJson } from '../proc.js';

export function cursorAdapter({ binary = 'cursor-agent', model, timeoutMs = 300000 }) {
  return {
    seat: 'cursor',
    async invoke({ prompt, sessionRef, signal }) {
      // --trust: headless has no TTY to answer cursor-agent's interactive
      // workspace-trust prompt (exit 1 otherwise, live-verified 2026-09-03).
      // Safe here — --mode plan is the load-bearing read-only guarantee,
      // same as the agy seat; --trust only skips the confirmation dialog.
      const args = ['-p', '--trust', '--mode', 'plan', '--output-format', 'json'];
      if (model) args.push('--model', model);
      if (sessionRef) args.push('--resume', sessionRef);
      args.push('--', prompt); // -- guard + trailing positional
      const r = await runHeadless({ cmd: binary, args, timeoutMs, signal });
      if (r.timedOut) return { ok: false, error: 'timeout', stderr: r.stderr };
      if (r.spawnError) return { ok: false, error: 'binary not found', stderr: r.stderr };
      if (r.code !== 0) {
        return { ok: false, error: `exit ${r.code}`, stderr: r.stderr, sessionLost: sessionRef != null };
      }
      const j = extractJson(r.stdout);
      const replyText = j?.result ?? j?.response ?? j?.text;
      if (typeof replyText !== 'string') {
        return { ok: false, error: 'bad json from cursor-agent', stderr: `${r.stderr}\n${r.stdout.slice(0, 2000)}` };
      }
      return { ok: true, replyText, sessionRef: j.chatId ?? j.chat_id ?? j.session_id ?? sessionRef ?? null };
    },
  };
}
