const COLORS = {
  ted: '\x1b[36m',      // cyan
  claude: '\x1b[35m',   // magenta
  gemini: '\x1b[34m',   // blue
  cursor: '\x1b[33m',   // yellow
  system: '\x1b[90m',   // dim
};
const RESET = '\x1b[0m';
const CLEAR = '\r\x1b[2K';
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function formatStatus(frame, seat, elapsedSec, pos, total) {
  return `${FRAMES[frame % FRAMES.length]} @${seat} is thinking… (${elapsedSec}s) — turn ${pos}/${total}`;
}

export function makeUi(out = process.stdout) {
  return {
    startStatus(seat, pos, total) {
      const t0 = Date.now();
      let frame = 0;
      out.write(CLEAR + formatStatus(frame, seat, 0, pos, total));
      const timer = setInterval(() => {
        frame++;
        out.write(CLEAR + formatStatus(frame, seat, Math.round((Date.now() - t0) / 1000), pos, total));
      }, 250);
      return () => { clearInterval(timer); out.write(CLEAR); };
    },
    printReply(seat, text) {
      out.write(`${COLORS[seat] ?? ''}${seat}>${RESET} ${text}\n\n`);
    },
    printSystem(text) {
      out.write(`${COLORS.system}${text}${RESET}\n`);
    },
    prompt() {
      return `${COLORS.ted}ted>${RESET} `;
    },
  };
}
