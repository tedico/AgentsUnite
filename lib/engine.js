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

    let res = await adapters[seat].invoke({
      prompt: buildPrompt({ messages, cursor: agent.cursor, seat, roster, firstTurn: agent.sessionRef === null, budgetNotice: isFinal }),
      sessionRef: agent.sessionRef,
      signal,
    });

    if (!res.ok && res.sessionLost && agent.sessionRef !== null && !signal.aborted) {
      // self-healing: fresh session + full-transcript replay
      res = await adapters[seat].invoke({
        prompt: buildPrompt({ messages, cursor: 0, seat, roster, firstTurn: true, budgetNotice: isFinal }),
        sessionRef: null,
        signal,
      });
    }
    stopStatus();
    control.turnController = null;

    if (res.ok) {
      appendMessage(dir, { ts: now(), from: seat, text: res.replyText, mentions: parseMentions(res.replyText, roster) });
      agent.sessionRef = res.sessionRef ?? agent.sessionRef;
      agent.cursor = messages.length + 1; // everything it was shown + its own reply
      ui.printReply(seat, res.replyText);
      if (!isFinal) {
        for (const m of parseMentions(res.replyText, roster)) {
          if (m !== seat && !queue.includes(m)) queue.push(m);
        }
      }
    } else {
      const reason = signal.aborted ? 'skipped' : (res.error ?? 'unknown');
      if (res.stderr) appendErrorLog(dir, seat, res.stderr);
      appendMessage(dir, { ts: now(), from: 'system', text: `@${seat} offline: ${reason}`, mentions: [] });
      ui.printSystem(`${seat}> [offline: ${reason} — /last-error for details]`);
    }

    saveState(dir, state);

    if (isFinal && queue.length > 0) {
      ui.printSystem(`turn budget (${config.turnCap}) reached — back to you`);
      queue.length = 0;
    }
  }
}
