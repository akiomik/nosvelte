/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The one process between the ledger runner and an arm's Vitest.
 *
 *     node scripts/ledger-supervisor.ts <status file> <command> [args…]
 *
 * The runner starts it detached, so it leads a process group of its own, with
 * its standard input a pipe from the runner. It runs the command in that group
 * and stops the whole group, Vitest's workers included, when either of two
 * things happens:
 * - the command ends;
 * - the pipe closes.
 *
 * The runner closes the pipe to stop a run at its limit, and the operating
 * system closes it when the runner dies, however it dies. A termination
 * signal it can catch stops the group too. So nothing has to signal a process
 * by a number recorded earlier, which another process may have taken since.
 *
 * **What it cannot cover is itself being killed outright, or stopped.** The
 * runner covers that while it lives: past its limit and a grace period, it
 * kills the group itself, which is still its child's. If the runner and this
 * supervisor are both killed outright, the group runs on until it ends; only
 * the operating system could contain that.
 *
 * The command gets no standard input of its own, so the pipe stays the
 * runner's alone. Its exit is written to the status file before the group is
 * stopped, since stopping the group ends this process by a signal and leaves
 * the runner no exit code to read.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [status, command, ...args] = process.argv.slice(2);
if (status === undefined || command === undefined) process.exit(2);

const stopGroup = (): void => {
  try {
    process.kill(-process.pid, 'SIGKILL');
  } catch {
    process.exit(1);
  }
};

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, stopGroup);
process.stdin.on('end', stopGroup);
process.stdin.on('close', stopGroup);
process.stdin.on('error', stopGroup);
process.stdin.resume();

const child = spawn(command, args, { stdio: 'ignore' });
child.on('error', stopGroup);
child.on('exit', (code, signal) => {
  try {
    writeFileSync(status, JSON.stringify({ code, signal }));
  } finally {
    stopGroup();
  }
});
