import { runHeadless, extractJson } from '../proc.js';

export function agyAdapter({ binary = 'agy', model, timeoutMs = 300000 }) {
  return {
    seat: 'gemini',
    async invoke({ prompt, sessionRef, signal }) {
      // agy's -p parses greedily; the prompt MUST be the value of --print.
      // Note: --disable-slash-commands conflicts with --mode plan and silently disables read-only mode.
      const args = ['--print', prompt, '--mode', 'plan', '--output-format', 'json'];
      if (model) args.push('--model', model);
      if (sessionRef) args.push('--conversation', sessionRef);
      const r = await runHeadless({ cmd: binary, args, timeoutMs, signal });
      if (r.timedOut) return { ok: false, error: 'timeout', stderr: r.stderr };
      if (r.spawnError) return { ok: false, error: 'binary not found', stderr: r.stderr };
      if (r.code !== 0) {
        return { ok: false, error: `exit ${r.code}`, stderr: r.stderr, sessionLost: sessionRef != null };
      }
      const j = extractJson(r.stdout, ['response']);
      if (!j || typeof j.response !== 'string') {
        return { ok: false, error: 'bad json from agy', stderr: `${r.stderr}\n${r.stdout.slice(0, 2000)}` };
      }
      return { ok: true, replyText: j.response, sessionRef: j.conversation_id ?? sessionRef ?? null };
    },
  };
}
