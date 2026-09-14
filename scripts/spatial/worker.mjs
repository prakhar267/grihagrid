import { runJob } from './run.mjs';
const controller = new AbortController();
const report = message => new Promise(resolve => {
  if (!process.connected) { resolve(); return; }
  process.send(message, () => resolve());
});
process.once('disconnect', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
process.once('message', async ({ options }) => {
  try {
    const result = await runJob({ ...options, signal: controller.signal, onProgress: progress => {
      void report({ type: 'progress', progress });
    } });
    await report({ type: 'complete', output: result.output });
  } catch (error) {
    await report({ type: 'failed', cancelled: error.name === 'AbortError', error: error.message.slice(0, 1200) });
  } finally { if (process.connected) process.disconnect(); process.exitCode = 0; }
});
