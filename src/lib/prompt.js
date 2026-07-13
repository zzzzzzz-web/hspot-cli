// Interactive yes/no confirmation. The prompt is written to stderr so stdout
// stays clean for piped/redirected result data.
import readline from 'node:readline';

export function canPrompt() {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

export function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}
