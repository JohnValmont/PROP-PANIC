// Runs the game server (with reload) and the Vite dev client together.
import { spawn } from 'node:child_process';

const run = (cmd, args) => spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
const procs = [run('npx', ['tsx', 'watch', 'server/index.ts']), run('npx', ['vite'])];
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
