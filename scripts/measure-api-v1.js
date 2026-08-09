const { performance } = require('node:perf_hooks');

const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:3000';
const requests = Number(process.env.API_BENCH_REQUESTS || 100);
const concurrency = Number(process.env.API_BENCH_CONCURRENCY || 10);

async function fetchMeasured(path) {
  const started = performance.now();
  const response = await fetch(baseUrl + path, { headers:{ Accept:'application/json' } });
  const body = await response.arrayBuffer();
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return { durationMs:performance.now() - started, bytes:body.byteLength };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function main() {
  for (let index = 0; index < 5; index += 1) {
    await fetchMeasured('/api/v1/screens/login');
  }
  let cursor = 0;
  const samples = [];
  await Promise.all(Array.from({ length:concurrency }, async () => {
    while (cursor < requests) {
      cursor += 1;
      samples.push(await fetchMeasured('/api/v1/screens/login'));
    }
  }));
  const legacy = await fetchMeasured('/api/state');
  const durations = samples.map(sample => sample.durationMs);
  const bytes = samples.reduce((sum, sample) => sum + sample.bytes, 0) / samples.length;
  process.stdout.write(`${JSON.stringify({
    measuredAt:new Date().toISOString(), endpoint:'/api/v1/screens/login',
    requests, concurrency,
    latencyMs:{ p50:percentile(durations, 0.5), p95:percentile(durations, 0.95),
      p99:percentile(durations, 0.99), max:Math.max(...durations) },
    payloadBytes:{ apiV1:Math.round(bytes), legacyState:legacy.bytes,
      reductionPercent:Math.round((1 - bytes / legacy.bytes) * 1000) / 10 },
  }, null, 2)}\n`);
}

void main().catch(error => {
  process.stderr.write(`${JSON.stringify({ error:error.message })}\n`);
  process.exitCode = 1;
});
