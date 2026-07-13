// Tiny logger. Everything diagnostic (progress, warnings, notices) goes to
// stderr so that stdout stays clean for piped/redirected result data.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export function createLogger({ level = 'info' } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const write = (lvl, prefix, args) => {
    if ((LEVELS[lvl] ?? 0) < threshold) return;
    process.stderr.write(`${prefix}${args.join(' ')}\n`);
  };

  return {
    level,
    debug: (...a) => write('debug', 'debug: ', a),
    info: (...a) => write('info', '', a),
    warn: (...a) => write('warn', 'warning: ', a),
    error: (...a) => write('error', 'error: ', a),
    // Transient status line on stderr (overwritten in place when TTY).
    status: (msg) => {
      if (threshold > LEVELS.info) return;
      if (process.stderr.isTTY) {
        process.stderr.write(`\r\x1b[2K${msg}`);
      } else {
        process.stderr.write(`${msg}\n`);
      }
    },
    // Clear the transient status line.
    statusDone: () => {
      if (threshold > LEVELS.info) return;
      if (process.stderr.isTTY) process.stderr.write('\r\x1b[2K');
    },
  };
}
