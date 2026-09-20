import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const script = path.resolve(__dirname, '../../scripts/dev-tunnel.sh');

describe('scripts/dev-tunnel.sh', () => {
  it('仓库里存在可执行脚本，并检查 cloudflared', () => {
    expect(existsSync(script)).toBe(true);
    const body = readFileSync(script, 'utf8');
    expect(body).toContain('cloudflared');
    expect(body).toContain('command -v cloudflared');
    expect(body).toContain('trycloudflare');
  });

  it('PATH 里没有 cloudflared 时以非零状态退出并给出安装提示', () => {
    const result = spawnSync('bash', [script], {
      env: { ...process.env, PATH: '/usr/bin:/bin', PORT: '3999' },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    const err = `${result.stdout}\n${result.stderr}`;
    expect(err).toMatch(/cloudflared/);
    expect(err).toMatch(/安装|install|brew/i);
  });
});
