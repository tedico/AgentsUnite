import { parseMentions } from './mentions.js';
import { buildPrompt } from './deltas.js';
import { appendMessage, readTranscript, loadState, saveState, appendErrorLog } from './transcript.js';

export class RoundControl {
  constructor() {
    this.drained = false;
    this.turnController = null;
  }
  skipTurn() { this.turnController?.abort(); }
  drain() { this.drained = true; this.turnController?.abort(); }
}

async function invokeSafely(adapter, args) {
  try {
    return await adapter.invoke(args);
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

export async function runRound({ humanText, dir, adapters, config, ui, control }) {
  const roster = config.roster.filter((s) => adapters[s]);
  const now = () => new Date().toISOString();

  appendMessage(dir, { ts: now(), from: 'ted', text: humanText, mentions: parseMentions(humanText, roster) });

  const state = loadState(dir, roster);
  const queue = [...parseMentions(humanText, roster)];
  let turns = 0;

  while (queue.length > 0 && !control.drained) {
    const seat = queue.shift();
    turns++;
    const isFinal = turns >= config.turnCap;
    const messages = readTranscript(dir);
    const agent = state.agents[seat];

    control.turnController = new AbortController();
    const signal = control.turnController.signal;
    const stopStatus = ui.startStatus(seat, turns, turns + queue.length);

    let res;
    try {
      res = await invokeSafely(adapters[seat], {
        prompt: buildPrompt({ messages, cursor: agent.cursor, seat, roster, firstTurn: agent.sessionRef === null, budgetNotice: isFinal }),
        sessionRef: agent.sessionRef,
        signal,
      });

      if (!res.ok && res.sessionLost && agent.sessionRef !== null && !signal.aborted) {
        // self-healing: fresh session + full-transcript replay
        res = await invokeSafely(adapters[seat], {
          prompt: buildPrompt({ messages, cursor: 0, seat, roster, firstTurn: true, budgetNotice: isFinal }),
          sessionRef: null,
          signal,
        });
      }
    } finally {
      // F5: guarantee the spinner is always stopped, even if prompt-building
      // (or anything else in this block) throws instead of resolving.
      stopStatus();
      control.turnController = null;
    }

    let suppressed = false;
    if (res.ok) {
      appendMessage(dir, { ts: now(), from: seat, text: res.replyText, mentions: parseMentions(res.replyText, roster) });
      agent.sessionRef = res.sessionRef ?? agent.sessionRef;
      agent.cursor = messages.length + 1; // everything it was shown + its own reply
      ui.printReply(seat, res.replyText);
      if (!res.sessionRef) {
        ui.printSystem(`@${seat} returned no session ref — later turns will not resume this native session`);
      }
      const newMentions = parseMentions(res.replyText, roster).filter((m) => m !== seat && !queue.includes(m));
      if (!isFinal) {
        for (const m of newMentions) queue.push(m);
      } else if (newMentions.length > 0) {
        suppressed = true; // cap truncated a hand-off this reply would have made
      }
    } else {
      const reason = signal.aborted ? 'skipped' : (res.error ?? 'unknown');
      if (res.stderr) appendErrorLog(dir, seat, res.stderr);
      appendMessage(dir, { ts: now(), from: 'system', text: `@${seat} offline: ${reason}`, mentions: [] });
      ui.printSystem(`${seat}> [offline: ${reason} — /last-error for details]`);
    }

    saveState(dir, state);

    if (isFinal && (queue.length > 0 || suppressed)) {
      ui.printSystem(`turn budget (${config.turnCap}) reached — back to you`);
      queue.length = 0;
    }
  }
}
