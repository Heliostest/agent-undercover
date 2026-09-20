import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
    // 空 PATH + 绝对路径调 bash，避免本机 /usr/bin 里的 cloudflared 让脚本真去开 tunnel。
    const emptyPath = mkdtempSync(path.join(tmpdir(), 'no-cloudflared-'));
    const result = spawnSync('/bin/bash', [script], {
      env: { ...process.env, PATH: emptyPath, PORT: '3999' },
      encoding: 'utf8',
      timeout: 5_000,
    });
    expect(result.status).not.toBe(0);
    const err = `${result.stdout}\n${result.stderr}`;
    expect(err).toMatch(/cloudflared/);
    expect(err).toMatch(/安装|install|brew/i);
  });
});
