// Change 6: dictation and pastes land as a burst of keystrokes that can carry
// newlines at pauses. readline emits one 'line' per newline, which would send
// each fragment to the seats as its own message. Lines that arrive within
// windowMs of each other are merged into one message.
export function makeBurstMerger(onMessage, { windowMs = 300 } = {}) {
  let pending = [];
  let timer = null;
  return (line) => {
    pending.push(line);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const text = pending.join('\n');
      pending = [];
      onMessage(text);
    }, windowMs);
  };
}
