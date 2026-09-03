export function parseArgv(argv) {
  const [cmd, name] = argv;
  switch (cmd) {
    case 'new': return { cmd: 'new', name: name ?? 'main' };
    case 'resume': return { cmd: 'resume', name: name ?? null };
    case 'ls': return { cmd: 'ls', name: null };
    case 'digest': return { cmd: 'digest', name: name ?? null };
    default: return { cmd: 'open', name: null };
  }
}
