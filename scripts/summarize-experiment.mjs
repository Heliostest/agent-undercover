import { readFileSync } from 'node:fs';

export function summarize(report) {
  const versions = [...new Set(report.rows.map((r) => r.strategy))];
  const dimensions = ['grounded', 'information', 'concealment', 'naturalness', 'updating'];
  const average = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const byVersion = Object.fromEntries(versions.map((version) => {
    const rows = report.rows.filter((r) => r.strategy === version);
    const scored = rows.filter((r) => r.scores);
    const calls = report.calls.filter((c) => c.strategy === version);
    return [version, {
      actions: rows.length, invalid: rows.filter((r) => !r.valid).length, scored: scored.length,
      mean: average(scored.map((r) => average(dimensions.map((d) => r.scores[d])))),
      dimensions: Object.fromEntries(dimensions.map((d) => [d, average(scored.map((r) => r.scores[d]))])),
      plannerFallbacks: rows.reduce((n, r) => n + r.plannerFallbacks, 0),
      meanActionMs: average(rows.map((r) => r.latencyMs)),
      calls: calls.length, reportedTokens: calls.reduce((n, c) => n + (c.usage?.totalTokens ?? 0), 0),
      unreportedCalls: calls.filter((c) => !c.usage?.usageReported).length,
    }];
  }));
  const paired = { firstHigher: 0, tied: 0, secondHigher: 0, unscored: 0 };
  for (let i = 0; i < report.rows.length; i += 2) {
    const [a, b] = report.rows.slice(i, i + 2);
    if (!a?.scores || !b?.scores) { paired.unscored++; continue; }
    const diff = dimensions.reduce((n, d) => n + a.scores[d] - b.scores[d], 0);
    if (diff > 0) paired.firstHigher++; else if (diff < 0) paired.secondHigher++; else paired.tied++;
  }
  return { status: report.status, provider: report.provider, model: report.model, versions, byVersion, paired,
    totalCalls: report.calls.length, reportedTokens: report.calls.reduce((n, c) => n + (c.usage?.totalTokens ?? 0), 0), judgeFailures: report.judgeFailures,
    seconds: report.completedAt ? (Date.parse(report.completedAt) - Date.parse(report.startedAt)) / 1000 : null };
}

if (process.argv[2]) {
  const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(summarize(report), null, 2));
}
