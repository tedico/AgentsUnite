import { runHeadless, extractJson, makeLineSplitter } from '../proc.js';
import { makeTracker } from '../progress.js';

export function cursorAdapter({ binary = 'cursor-agent', model, timeoutMs = 300000 }) {
  return {
    seat: 'cursor',
    async invoke({ prompt, sessionRef, signal, onProgress }) {
      // --trust: headless has no TTY to answer cursor-agent's interactive
      // workspace-trust prompt (exit 1 otherwise, live-verified 2026-09-03).
      // Safe here — --mode plan is the load-bearing read-only guarantee,
      // same as the agy seat; --trust only skips the confirmation dialog.
      // stream-json: json mode is silent until the end (verified ~10s of
      // nothing), so structured events are the only liveness signal.
      const args = ['-p', '--trust', '--mode', 'plan', '--output-format', 'stream-json'];
      if (model) args.push('--model', model);
      if (sessionRef) args.push('--resume', sessionRef);
      args.push('--', prompt); // -- guard + trailing positional

      const track = makeTracker(onProgress);
      let result = null;
      const lines = makeLineSplitter((line) => {
        let evt;
        try { evt = JSON.parse(line); } catch { return; }
        if (evt.type === 'system' && evt.subtype === 'init') track.phase('connected');
        else if (evt.type === 'thinking' || evt.type === 'assistant') track.phase('thinking');
        else if (evt.type === 'tool_call' && evt.subtype === 'started') {
          // tool_call: { "<name>ToolCall": {...}, toolCallId, ... }
          const key = Object.keys(evt.tool_call ?? {}).find((k) => k.endsWith('ToolCall'));
          track.tool(key ? key.replace(/ToolCall$/, '') : 'tool');
        } else if (evt.type === 'result') { result = evt; track.phase('replying'); }
      });
      const onData = (chunk, stream) => {
        track.heartbeat();
        if (stream === 'stdout') lines.push(chunk);
      };

      const r = await runHeadless({ cmd: binary, args, timeoutMs, signal, onData });
      lines.flush();
      if (r.timedOut) return { ok: false, error: 'timeout', stderr: r.stderr };
      if (r.spawnError) return { ok: false, error: 'binary not found', stderr: r.stderr };
      const resultText = result?.result ?? result?.response ?? result?.text;
      const stderr = [r.stderr, resultText].filter((text) => typeof text === 'string' && text.trim()).join('\n')
        || r.stdout.slice(-2000);
      if (r.code !== 0) {
        return { ok: false, error: `exit ${r.code}`, stderr, sessionLost: sessionRef != null };
      }
      // Only the result event is a reply. cursor-agent's thinking events carry
      // a top-level "text" key, so an any-of scan over the whole stream would
      // hand back the first thinking fragment. Fallback keys are "result" only.
      const j = result ?? extractJson(r.stdout, ['result']);
      const replyText = j?.result ?? j?.response ?? j?.text;
      if (j?.is_error === true) {
        return { ok: false, error: 'error result', stderr: stderr || replyText };
      }
      if (typeof replyText !== 'string') {
        return { ok: false, error: 'bad json from cursor-agent', stderr: `${r.stderr}\n${r.stdout.slice(0, 2000)}` };
      }
      if (!replyText.trim()) return { ok: false, error: 'empty reply', stderr };
      return { ok: true, replyText, sessionRef: j.chatId ?? j.chat_id ?? j.session_id ?? sessionRef ?? null };
    },
  };
}
