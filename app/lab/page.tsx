'use client';

import { useEffect, useState } from 'react';
import { loadSettings, browserStorage, buildStartRequestBody, validateSettings } from '@/lib/client/settings-storage';
import { PRESET_LABELS, type ExperimentPreset } from '@/lib/experiments/presets';
import { STRATEGY_LABELS } from '@/lib/agents/strategy';
import type { ExperimentReport } from '@/lib/experiments/runner';

export default function ThinkingLabPage() {
  const [id, setId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<ExperimentReport | null>(null);
  useEffect(() => {
    const saved = new URL(window.location.href).searchParams.get('id');
    if (saved) { setId(saved); setBusy(true); }
  }, []);
  useEffect(() => {
    if (!id || !busy) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/experiments?id=${id}`);
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error);
        setReport(data.report);
        if (data.status !== 'running') { setBusy(false); if (data.status === 'error') setError('实验中断，已完成的记录保留在报告里。'); }
        else timer = setTimeout(poll, 2000);
      } catch { if (!cancelled) { setError('读取实验进度失败，请重新打开报告链接。'); setBusy(false); } }
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, busy]);

  async function start(preset: ExperimentPreset) {
    const settings = loadSettings(browserStorage());
    const invalid = validateSettings(settings);
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError(''); setReport(null); setId(null);
    try {
      const response = await fetch('/api/experiments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...buildStartRequestBody(settings), preset }) });
      const data = await response.json();
      if (response.status === 409 && data.id) {
        window.history.replaceState(null, '', `/lab?id=${encodeURIComponent(data.id)}`);
        setId(data.id); setError('已有实验正在运行，已恢复进度。'); return;
      }
      if (!response.ok) throw new Error(data.error);
      window.history.replaceState(null, '', `/lab?id=${encodeURIComponent(data.id)}`);
      setId(data.id);
    } catch (e) { setError(e instanceof Error ? e.message : '实验启动失败'); setBusy(false); }
  }
  return <main className="page">
    <div className="panel"><a href="/">← 返回游戏</a><h1>思考对照实验</h1>
      <p>相同场景、相同模型，比较不同思考方式。每组包含两轮发言和一次投票，采用匿名评分；重复测试会交换展示顺序。</p>
      <p className="muted">使用首页保存的模型设置。每次实验 24 次玩家行动，另含私人判断和评分调用，会产生用量。失败也计入报告；分数是同模型的主观评估，不代表整局胜率。需开启上帝视角。</p>
      {Object.entries(PRESET_LABELS).map(([preset, label]) => <p key={preset}><button disabled={busy} onClick={() => void start(preset as ExperimentPreset)}>{label}</button></p>)}
      {error && <p className="danger">{error}</p>}
      {id && <p><a href={`/api/experiments?id=${id}`} target="_blank" rel="noreferrer">打开完整 JSON 报告</a></p>}
      {busy && <p aria-live="polite">正在比较：{report?.completedPairs ?? 0} / {report?.totalPairs ?? 12} 组</p>}
      {report && <><p>{report.status === 'complete' ? '比较完成' : '比较记录'} · 调用 {report.calls.length} 次 · 已报告 token {report.calls.reduce((n, c) => n + (c.usage?.totalTokens ?? 0), 0).toLocaleString()} · 评分失败 {report.judgeFailures} 次</p>
        <table><thead><tr><th>场景 / 步骤</th><th>版本</th><th>公开行动</th><th>均分 / 4</th></tr></thead><tbody>
          {report.rows.map((r, i) => <tr key={i}><td>{r.caseId} / {r.stage + 1}</td><td>{STRATEGY_LABELS[r.strategy]}</td><td>{r.output}{!r.valid && '（无效）'}</td><td>{r.scores ? (Object.values(r.scores).reduce((a, b) => a + b, 0) / 5).toFixed(1) : '未评分'}</td></tr>)}
        </tbody></table></>}
    </div>
  </main>;
}
