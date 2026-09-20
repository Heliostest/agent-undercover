import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { CASES } from '@/lib/experiments/cases';
import { runExperiment, type ExperimentReport } from '@/lib/experiments/runner';
import { PRESET_LABELS } from '@/lib/experiments/presets';
import type { ThinkingStrategy } from '@/lib/agents/strategy';
import { createLlmClient, parseLlmConfig, InvalidLlmConfigError } from '@/lib/llm/create-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
interface Job { id: string; report: ExperimentReport | null; status: 'running' | 'complete' | 'error' }
const globalJobs = globalThis as typeof globalThis & { __thinkingJobs?: Map<string, Job> };
const jobs = globalJobs.__thinkingJobs ??= new Map<string, Job>();
function runningResponse() {
  const running = [...jobs.values()].find((job) => job.status === 'running');
  return running ? NextResponse.json({ error: '已有对照实验正在运行', id: running.id }, { status: 409 }) : null;
}

export async function POST(request: Request) {
  if (process.env.ENABLE_GOD_VIEW !== 'true') return NextResponse.json({ error: '实验入口未启用' }, { status: 404 });
  const active = runningResponse();
  if (active) return active;
  try {
    const body = await request.json();
    const config = parseLlmConfig(body);
    if (!Object.hasOwn(PRESET_LABELS, body.preset)) return NextResponse.json({ error: '未知实验预设' }, { status: 400 });
    // Recheck after awaiting JSON, so concurrent requests cannot start overlapping jobs.
    const concurrent = runningResponse();
    if (concurrent) return concurrent;
    while (jobs.size >= 10) jobs.delete(jobs.keys().next().value!);
    const job: Job = { id: randomUUID(), report: null, status: 'running' };
    jobs.set(job.id, job);
    const split = body.preset === 'holdout' ? 'holdout' : 'train';
    const strategies: [ThinkingStrategy, ThinkingStrategy] = body.preset === 'first' ? ['baseline', 'evidence'] : body.preset === 'second' ? ['evidence', 'deliberate'] : ['baseline', 'adaptive'];
    const llm = createLlmClient(config, { maxRetries: 0, timeoutMs: 20_000 });
    void runExperiment(llm, { caseIds: CASES.filter((c) => c.split === split).map((c) => c.id), strategies, repetitions: split === 'train' ? 1 : 2, sparse: body.preset === 'first' || body.preset === 'second' },
      (report) => { job.report = report; }).then(() => { job.status = 'complete'; }).catch(() => { job.status = 'error'; if (job.report) job.report.status = 'error'; });
    return NextResponse.json({ id: job.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof InvalidLlmConfigError ? error.message : '实验创建失败，请检查模型设置' }, { status: 400 });
  }
}

export async function GET(request: Request) {
  if (process.env.ENABLE_GOD_VIEW !== 'true') return NextResponse.json({ error: '实验入口未启用' }, { status: 404 });
  const id = new URL(request.url).searchParams.get('id');
  const job = id ? jobs.get(id) : undefined;
  return job ? NextResponse.json(job, { headers: { 'Cache-Control': 'no-store' } }) : NextResponse.json({ error: '实验不存在，服务重启后记录会清空' }, { status: 404 });
}
