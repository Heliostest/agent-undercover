import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/lib/experiments/runner', () => ({ runExperiment: run }));
vi.mock('@/lib/llm/create-client', async (original) => ({
  ...await original<typeof import('@/lib/llm/create-client')>(),
  createLlmClient: () => ({ provider: 'deepseek', model: 'test', complete: vi.fn() }),
}));
beforeEach(() => { vi.resetModules(); vi.stubGlobal('__thinkingJobs', new Map()); vi.stubEnv('ENABLE_GOD_VIEW', 'true'); run.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const request = (preset = 'first') => new Request('http://localhost/api/experiments', { method: 'POST', body: JSON.stringify({ provider: 'deepseek', model: 'test', apiKey: 'sk-private-key', preset }) });

it('requires the local experiment flag and validates presets before any calls', async () => {
  const { POST, GET } = await import('@/app/api/experiments/route');
  expect((await POST(request('unbounded'))).status).toBe(400);
  vi.stubEnv('ENABLE_GOD_VIEW', 'false');
  expect((await POST(request())).status).toBe(404);
  expect((await GET(new Request('http://localhost/api/experiments?id=x'))).status).toBe(404);
  expect(run).not.toHaveBeenCalled();
});
it('concurrent starts share a recoverable job ID and never expose config in GET', async () => {
  let finish!: () => void;
  run.mockImplementation((_llm, _options, progress) => {
    progress({ status: 'running', rows: [], calls: [] });
    return new Promise<void>((resolve) => { finish = resolve; });
  });
  const { POST, GET } = await import('@/app/api/experiments/route');
  const responses = await Promise.all([POST(request()), POST(request())]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  const payloads = await Promise.all(responses.map((r) => r.json()));
  expect(payloads[0].id).toBe(payloads[1].id);
  expect(run).toHaveBeenCalledTimes(1);
  const response = await GET(new Request(`http://localhost/api/experiments?id=${payloads[0].id}`));
  expect(await response.text()).not.toContain('sk-private-key');
  finish();
  await Promise.resolve();
  const completed = await GET(new Request(`http://localhost/api/experiments?id=${payloads[0].id}`));
  expect((await completed.json()).status).toBe('complete');
});
