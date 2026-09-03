import { runHeadless, extractJson } from '../proc.js';

export function claudeAdapter({ binary = 'claude', model, timeoutMs = 300000 }) {
  return {
    seat: 'claude',
    async invoke({ prompt, sessionRef, signal }) {
      const args = ['-p', '--permission-mode', 'plan', '--output-format', 'json'];
      if (model) args.push('--model', model);
      if (sessionRef) args.push('--resume', sessionRef);
      const r = await runHeadless({ cmd: binary, args, stdinText: prompt, timeoutMs, signal });
      if (r.timedOut) return { ok: false, error: 'timeout', stderr: r.stderr };
      if (r.spawnError) return { ok: false, error: 'binary not found', stderr: r.stderr };
      if (r.code !== 0) {
        return { ok: false, error: `exit ${r.code}`, stderr: r.stderr, sessionLost: sessionRef != null };
      }
      const j = extractJson(r.stdout, ['result']);
      if (!j || typeof j.result !== 'string') {
        return { ok: false, error: 'bad json from claude', stderr: `${r.stderr}\n${r.stdout.slice(0, 2000)}` };
      }
      return { ok: true, replyText: j.result, sessionRef: j.session_id ?? sessionRef ?? null };
    },
  };
}
