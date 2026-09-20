# 本地 OmniRoute 供应商 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增供应商 `omniroute`（本地 OmniRoute），默认连 `http://127.0.0.1:20128/v1`；开局面板免填 Key（上游 Key 留在 OmniRoute，服务端可选读 `OMNIROUTE_API_KEY`）；模型经 Next 代理 `GET /api/omniroute/models` 下拉选择；账单只记真实 token、`estimatedCostCny` 恒 `null`（与 OpenRouter 一致）。

**Architecture:** 沿用现有 OpenAI-compatible 客户端内核。新增 `lib/llm/omniroute.ts` 薄适配器；`LlmProvider` / `providers.ts` 增加 `omniroute`；`parseLlmConfig` 对 omniroute 允许空 apiKey；`createLlmClient` 对 omniroute **忽略**浏览器传来的 apiKey，改注入 `OMNIROUTE_BASE_URL` + `OMNIROUTE_API_KEY`（可空）。新增 `GET /api/omniroute/models` 服务端转发 `{BASE}/models`。Settings UI 选中 omniroute 时隐藏 Key、模型改下拉 + 刷新。`PricedProvider` 排除 `omniroute`，bill UI 已有 null 费用路径可复用。

**Tech Stack:** Next.js 15（App Router）、React 19、TypeScript 5.9（strict）、Vitest 3（node）。无新增运行时 npm 依赖。复用 `createOpenAiCompatibleClient`。

## Global Constraints

本节是全局约束，每个 Task 的要求都隐含包含它们。

- **Key 安全**：浏览器传来的 apiKey 对 omniroute **一律忽略**；错误文案 / 502 响应 / SSE / bill **不得**回显 `OMNIROUTE_API_KEY` 或任何 Key。
- **空 Key 合法**：仅 `provider === 'omniroute'` 时 `parseLlmConfig` / `validateSettings` 允许缺省或 `''`；其它 provider 仍要求非空 apiKey。
- **无金额**：`omniroute` 与 `openrouter` / `deepseek` 一样 `estimatedCostCny === null`；不编造费用、不改进价目表。
- **不直连浏览器**：模型列表与 chat 都经服务端；禁止在浏览器里 fetch `127.0.0.1:20128`。
- **本迭代非目标**：自动启动 OmniRoute、通用自定义端点面板、改智谱估价、浏览器 E2E。
- **测试纪律**：LLM / models 上游一律 mock；`npm test` 不发真实外网或本机 OmniRoute 请求；React 组件不写单测，靠 `typecheck` + 手工验收。
- **Node.js >= 20.9**；包管理 npm；不新增运行时依赖。
- **语言**：注释与用户可见文案中文，标识符与代码英文。
- **每个 Task 的收尾**：`npm test` 与 `npm run typecheck` 必须全绿后才提交。

---

## File Structure

### 新建

| 文件 | 职责 |
|------|------|
| `lib/llm/omniroute.ts` | OpenAI-compatible 客户端；默认 baseUrl / 可选 apiKey；导出 label、默认模型占位、`normalizeOmnirouteBaseUrl` |
| `app/api/omniroute/models/route.ts` | `GET`：服务端转发 `{BASE}/models` → `{ models: string[] }` 或 502 |
| `tests/llm/omniroute.test.ts` | 客户端默认 URL、空 Key 不带 Bearer、自定义 baseUrl |
| `tests/api/omniroute-models.test.ts` | models 路由成功 / 失败 / 去重排序 / 错误不回显 Key |

### 修改

| 文件 | 改动 |
|------|------|
| `lib/llm/types.ts` | `LlmProvider` 增加 `'omniroute'` |
| `lib/llm/providers.ts` | `PROVIDERS` / labels / default models 加入 omniroute |
| `lib/llm/openai-compatible.ts` | apiKey 为空时**不**设置 `Authorization` 头（供 omniroute 免 Key） |
| `lib/llm/create-client.ts` | parse：omniroute 允许空/缺 apiKey；create：omniroute 用 env baseUrl+apiKey，忽略 body apiKey |
| `lib/billing/prices.ts` | `PricedProvider` 排除 `omniroute` |
| `lib/client/settings-storage.ts` | `validateSettings`：omniroute 不要求 apiKey；`buildStartRequestBody`：omniroute 的 apiKey 固定 `''` |
| `components/SettingsForm.tsx` | omniroute：隐藏 Key/清除按钮；模型 `<select>` + 刷新；挂载/切换时拉 models |
| `app/globals.css` | 如需少量下拉/刷新行样式（尽量复用现有） |
| `.env.example` | `OMNIROUTE_BASE_URL`、`OMNIROUTE_API_KEY` |
| `README.md` | 环境变量表 + 一句「本地 OmniRoute 免填 Key，需本机 `omniroute serve`」 |
| `tests/llm/create-client.test.ts` | provider 列表、空 key、create 用默认 baseUrl |
| `tests/billing/prices.test.ts` / `estimate.test.ts` / `bill-emitter.test.ts` | omniroute → 非 priced / null cost |
| `tests/client/settings-storage.test.ts` | omniroute 校验与 body |
| `tests/api/routes.test.ts` | provider 错误文案含 omniroute；omniroute 空 key 开局 201 |

### 不动

`lib/game/judge.ts`、`rules.ts`、`word-bank.ts`、`lib/agents/*`、`BillPanel` / `BillHistory`（已支持 null 费用）、`UsagePanel`、cloudflared 脚本。不改智谱单价。

---

## Task 依赖顺序

```
Task 1  (types + providers + openai-compatible 空 Key)
  ├─ Task 2 (omniroute.ts 客户端)
  ├─ Task 3 (parseLlmConfig + createLlmClient env 注入)
  │    └─ Task 5 (POST /api/games 路由测试)
  ├─ Task 4 (GET /api/omniroute/models)
  ├─ Task 6 (billing：prices / estimate / bill null cost)
  ├─ Task 7 (settings-storage validate + body)
  │    └─ Task 8 (SettingsForm UI)
  └─ Task 9 (.env.example + README)
```

---

### Task 1: 类型、供应商常量、空 Key 时省略 Authorization

把 `omniroute` 接入供应商联合类型与常量表；让 OpenAI-compatible 内核在 apiKey 为空时不发 Bearer。

**Files:**
- Modify: `lib/llm/types.ts`
- Modify: `lib/llm/providers.ts`
- Modify: `lib/llm/openai-compatible.ts`
- Modify: `tests/llm/create-client.test.ts`（providers 常量断言；可暂 skip create 分发直到 Task 3）
- 先建空壳：`lib/llm/omniroute.ts` 仅导出常量（供 providers 引用），完整客户端在 Task 2

**Interfaces:**
- `LlmProvider = 'zhipu' | 'deepseek' | 'openrouter' | 'omniroute'`
- `OMNIROUTE_LABEL = '本地 OmniRoute'`
- `OMNIROUTE_DEFAULT_MODEL = 'omniroute-default'`（占位；UI 拉列表后覆盖）
- `OMNIROUTE_DEFAULT_BASE_URL = 'http://127.0.0.1:20128/v1'`

- [ ] **Step 1: 写失败测试**

在 `tests/llm/create-client.test.ts` 把 providers 断言改为包含 omniroute：

```ts
expect(PROVIDERS).toEqual(['zhipu', 'deepseek', 'openrouter', 'omniroute']);
expect(PROVIDER_LABELS).toEqual({
  zhipu: '智谱',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  omniroute: '本地 OmniRoute',
});
expect(DEFAULT_MODELS.omniroute).toBe('omniroute-default');
expect(isLlmProvider('omniroute')).toBe(true);
```

同步在 `tests/llm/omniroute.test.ts`（可先只测常量 + 空 Key 行为，客户端工厂在 Task 2 补全）或在 openai-compatible 相关测试里加：

```ts
it('apiKey 为空时请求头不带 authorization', async () => {
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }),
  );
  // 用 createOpenAiCompatibleClient 直接测，或等 Task 2 用 createOmnirouteClient
  ...
  const headers = init.headers as Record<string, string>;
  expect(headers.authorization).toBeUndefined();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/llm/create-client.test.ts`
Expected: FAIL（PROVIDERS 仍是三项）

- [ ] **Step 3: 最小实现**

1. `types.ts`：联合类型加 `'omniroute'`
2. `lib/llm/omniroute.ts`（常量先行）：

```ts
export const OMNIROUTE_DEFAULT_BASE_URL = 'http://127.0.0.1:20128/v1';
export const OMNIROUTE_DEFAULT_MODEL = 'omniroute-default';
export const OMNIROUTE_LABEL = '本地 OmniRoute';

export function normalizeOmnirouteBaseUrl(raw: string | undefined): string {
  const fallback = OMNIROUTE_DEFAULT_BASE_URL;
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  return trimmed === '' ? fallback : trimmed;
}
```

3. `providers.ts`：引入常量，数组末尾加 `'omniroute'`，补 labels / defaults
4. `openai-compatible.ts`：构建 headers 时：

```ts
const headers: Record<string, string> = {
  ...options.extraHeaders,
  'content-type': 'application/json',
};
if (options.apiKey.trim() !== '') {
  headers.authorization = `Bearer ${options.apiKey}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/llm/create-client.test.ts`
Expected: PASS（若 create 分发尚未支持 omniroute，先别在本 Task 加 create 断言）

- [ ] **Step 5: 提交**

```bash
git add lib/llm/types.ts lib/llm/providers.ts lib/llm/omniroute.ts lib/llm/openai-compatible.ts tests/llm/create-client.test.ts
git commit -m "$(cat <<'EOF'
feat(llm): add omniroute provider type and optional Bearer

EOF
)"
```

---

### Task 2: OmniRoute OpenAI-compatible 客户端

**Files:**
- Modify: `lib/llm/omniroute.ts`
- Create: `tests/llm/omniroute.test.ts`

**Interfaces:**
- `createOmnirouteClient(options)` → `LlmClient`，`provider: 'omniroute'`
- `baseUrl` 默认 `normalizeOmnirouteBaseUrl(undefined)`；`apiKey` 默认 `''`

- [ ] **Step 1: 写失败测试**

```ts
describe('createOmnirouteClient', () => {
  it('暴露 provider 与 model，默认打到本地 OmniRoute', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '嗨' } }] }), { status: 200 }),
    );
    const client = createOmnirouteClient({
      apiKey: '',
      model: 'gpt-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(client.provider).toBe('omniroute');
    expect(client.model).toBe('gpt-test');
    await client.complete([{ role: 'user', content: 'hi' }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:20128/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('非空 apiKey 时带 Bearer；自定义 baseUrl 去尾斜杠', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '嗨' } }] }), { status: 200 }),
    );
    const client = createOmnirouteClient({
      apiKey: 'or-local',
      model: 'm',
      baseUrl: 'http://127.0.0.1:20128/v1/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.complete([{ role: 'user', content: 'hi' }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:20128/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer or-local');
  });

  it('normalizeOmnirouteBaseUrl 空串回落默认', () => {
    expect(normalizeOmnirouteBaseUrl('')).toBe(OMNIROUTE_DEFAULT_BASE_URL);
    expect(normalizeOmnirouteBaseUrl('  http://host/v1/  ')).toBe('http://host/v1');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/llm/omniroute.test.ts`
Expected: FAIL（`createOmnirouteClient` 不存在）

- [ ] **Step 3: 最小实现**

```ts
export function createOmnirouteClient(options: OmnirouteClientOptions): LlmClient {
  return createOpenAiCompatibleClient({
    provider: 'omniroute',
    label: OMNIROUTE_LABEL,
    baseUrl: normalizeOmnirouteBaseUrl(options.baseUrl),
    apiKey: options.apiKey ?? '',
    model: options.model,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    maxRetries: options.maxRetries,
    timeoutMs: options.timeoutMs,
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/llm/omniroute.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/llm/omniroute.ts tests/llm/omniroute.test.ts
git commit -m "$(cat <<'EOF'
feat(llm): add OmniRoute OpenAI-compatible client

EOF
)"
```

---

### Task 3: parseLlmConfig 允许空 Key + createLlmClient 注入 env

**Files:**
- Modify: `lib/llm/create-client.ts`
- Modify: `tests/llm/create-client.test.ts`

**Interfaces:**
- `parseLlmConfig`：`provider === 'omniroute'` 时，`apiKey` 可缺省 / 非字符串当 `''` / 空白 trim 成 `''`；超长仍拒绝（若非空）
- `createLlmClient`：`case 'omniroute'` → `createOmnirouteClient({ apiKey: process.env.OMNIROUTE_API_KEY ?? '', baseUrl: process.env.OMNIROUTE_BASE_URL, model, ... })`，**不使用** `config.apiKey`

- [ ] **Step 1: 写失败测试**

```ts
it('omniroute 允许缺省或空 apiKey', () => {
  expect(parseLlmConfig({ provider: 'omniroute', model: 'm1' })).toEqual({
    provider: 'omniroute',
    model: 'm1',
    apiKey: '',
  });
  expect(parseLlmConfig({ provider: 'omniroute', model: 'm1', apiKey: '  ' })).toEqual({
    provider: 'omniroute',
    model: 'm1',
    apiKey: '',
  });
});

it('其它 provider 空 key 仍抛错', () => {
  expect(() => parseLlmConfig({ provider: 'zhipu', model: 'glm-4-flash' })).toThrow('缺少 apiKey');
});

it('createLlmClient(omniroute) 使用默认 baseUrl，忽略 config.apiKey', async () => {
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), { status: 200 }),
  );
  const prevKey = process.env.OMNIROUTE_API_KEY;
  const prevBase = process.env.OMNIROUTE_BASE_URL;
  delete process.env.OMNIROUTE_API_KEY;
  delete process.env.OMNIROUTE_BASE_URL;
  try {
    const client = createLlmClient(
      { provider: 'omniroute', model: 'm', apiKey: 'browser-should-ignore' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(client.provider).toBe('omniroute');
    await client.complete([{ role: 'user', content: 'hi' }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:20128/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  } finally {
    if (prevKey === undefined) delete process.env.OMNIROUTE_API_KEY;
    else process.env.OMNIROUTE_API_KEY = prevKey;
    if (prevBase === undefined) delete process.env.OMNIROUTE_BASE_URL;
    else process.env.OMNIROUTE_BASE_URL = prevBase;
  }
});

it('createLlmClient(omniroute) 使用 env 中的 Key 与 baseUrl', async () => {
  // 设 OMNIROUTE_API_KEY=env-secret、OMNIROUTE_BASE_URL=http://127.0.0.1:9/v1
  // 断言 authorization Bearer env-secret，url 含 :9/v1
});
```

同时更新未知 provider 错误文案期望为含 `omniroute`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/llm/create-client.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`parseLlmConfig` 中 apiKey 段：

```ts
const rawApiKey = raw.apiKey;
if (provider === 'omniroute') {
  const apiKey =
    typeof rawApiKey === 'string' ? rawApiKey.trim() : rawApiKey === undefined ? '' : '';
  // 若类型不是 string 且不是 undefined → 仍可当 ''（与「可缺省」一致）；或对非 string 抛错。推荐：非 string 且非 undefined 抛「apiKey 必须是字符串」，undefined/缺省/'' → ''。
  if (rawApiKey !== undefined && typeof rawApiKey !== 'string') {
    throw new InvalidLlmConfigError('apiKey 必须是字符串');
  }
  const apiKey = (typeof rawApiKey === 'string' ? rawApiKey : '').trim();
  if (apiKey.length > MAX_API_KEY_LENGTH) {
    throw new InvalidLlmConfigError(`apiKey 长度不能超过 ${MAX_API_KEY_LENGTH} 个字符`);
  }
  return { provider, model, apiKey };
}
// 原有非空校验...
```

`createLlmClient` switch 增加：

```ts
case 'omniroute':
  return createOmnirouteClient({
    ...shared,
    apiKey: process.env.OMNIROUTE_API_KEY?.trim() ?? '',
    baseUrl: process.env.OMNIROUTE_BASE_URL,
  });
```

注意 `shared` 里的 `apiKey: config.apiKey` 会被上面覆盖。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/llm/create-client.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/llm/create-client.ts tests/llm/create-client.test.ts
git commit -m "$(cat <<'EOF'
feat(llm): allow empty omniroute key and inject env credentials

EOF
)"
```

---

### Task 4: GET /api/omniroute/models 服务端代理

**Files:**
- Create: `app/api/omniroute/models/route.ts`
- Create: `tests/api/omniroute-models.test.ts`

**Interfaces:**
- 成功：`200 { models: string[] }`（从 `data[].id` 抽出，trim、去空、去重、排序）
- 失败：`502 { error: string }`（超时 / 连接拒绝 / 非 JSON / 非 2xx）；文案中文；**不得**含 Key
- 使用 `normalizeOmnirouteBaseUrl(process.env.OMNIROUTE_BASE_URL)` + 可选 Bearer
- 可注入 `fetchImpl` 不便时：用 `vi.stubGlobal('fetch', ...)` 测

- [ ] **Step 1: 写失败测试**

```ts
describe('GET /api/omniroute/models', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // 恢复 env
  });

  it('成功时抽出 id、去重排序', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }, { id: '  ' }],
      }), { status: 200 }),
    ));
    const { GET } = await import('@/app/api/omniroute/models/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ models: ['a', 'b'] });
  });

  it('上游拒绝连接时 502 且不回显 Key', async () => {
    process.env.OMNIROUTE_API_KEY = 'secret-should-not-leak';
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('fetch failed');
    }));
    const { GET } = await import('@/app/api/omniroute/models/route');
    const res = await GET();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/OmniRoute|模型|连/);
    expect(JSON.stringify(body)).not.toContain('secret-should-not-leak');
  });

  it('上游非 JSON 或非 2xx 时 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 200 })));
    ...
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    ...
  });
});
```

注意：动态 `import` 前若模块已缓存，可用 `vi.resetModules()`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/api/omniroute-models.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODELS_TIMEOUT_MS = 10_000;

export async function GET(): Promise<Response> {
  const baseUrl = normalizeOmnirouteBaseUrl(process.env.OMNIROUTE_BASE_URL);
  const apiKey = process.env.OMNIROUTE_API_KEY?.trim() ?? '';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (apiKey !== '') headers.authorization = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODELS_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/models`, { headers, signal: controller.signal });
    if (!response.ok) {
      return NextResponse.json(
        { error: `无法从 OmniRoute 拉取模型列表（HTTP ${response.status}）` },
        { status: 502 },
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return NextResponse.json({ error: 'OmniRoute 返回了无法解析的响应' }, { status: 502 });
    }
    const models = extractModelIds(payload);
    return NextResponse.json({ models });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return NextResponse.json(
      {
        error: aborted
          ? '连接 OmniRoute 超时，请确认本机已运行 omniroute serve'
          : '无法连接 OmniRoute，请确认本机已运行 omniroute serve',
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}

function extractModelIds(payload: unknown): string[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const ids = data
    .map((item) => (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
      ? (item as { id: string }).id.trim()
      : ''))
    .filter((id) => id !== '');
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/api/omniroute-models.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add app/api/omniroute/models/route.ts tests/api/omniroute-models.test.ts
git commit -m "$(cat <<'EOF'
feat(api): proxy OmniRoute model list via GET /api/omniroute/models

EOF
)"
```

---

### Task 5: POST /api/games 接受 omniroute 空 Key

**Files:**
- Modify: `tests/api/routes.test.ts`

实现已在 Task 3；本 Task 补路由级回归。

- [ ] **Step 1: 写失败测试**

```ts
it('omniroute 允许空 apiKey 开局', async () => {
  const res = await POST(jsonRequest({ provider: 'omniroute', model: 'm1', apiKey: '' }));
  expect(res.status).toBe(201);
});

it('未知 provider 错误文案含 omniroute', async () => {
  ...
  expect(body.error).toContain('omniroute');
});
```

（按现有 `routes.test.ts` 的 request helper / mock bootstrap 写法对齐。）

- [ ] **Step 2–4: 跑红 → 必要时微调 → 绿**

Run: `npx vitest run tests/api/routes.test.ts`

- [ ] **Step 5: 提交**

```bash
git add tests/api/routes.test.ts
git commit -m "$(cat <<'EOF'
test(api): allow omniroute game start without apiKey

EOF
)"
```

---

### Task 6: 账单 — omniroute 费用恒 null

**Files:**
- Modify: `lib/billing/prices.ts`（`PricedProvider` 排除 `'omniroute'`）
- Modify: `tests/billing/prices.test.ts`
- Modify: `tests/billing/estimate.test.ts`
- Modify: `tests/billing/bill-emitter.test.ts`（若有 provider 穷举）

`estimate.ts` 已按 `isPricedProvider` 分支，通常只需扩展 Exclude 与测试。

- [ ] **Step 1: 写失败测试**

```ts
expect(isPricedProvider('omniroute')).toBe(false);
expect(priceFor('omniroute', 'any')).toBeNull();

// estimate.test.ts
it('omniroute 账单金额为 null', () => {
  const bill = buildBill({
    provider: 'omniroute',
    model: 'm',
    records: [record({ provider: 'omniroute', model: 'm' })],
    ...
  });
  expect(bill.totals.estimatedCostCny).toBeNull();
  expect(bill.bySeat.map((s) => s.estimatedCostCny)).toEqual([null]);
  expect(bill.notes.some((n) => n.includes('费用暂不可用'))).toBe(true);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/billing/prices.test.ts tests/billing/estimate.test.ts`
Expected: FAIL（类型或 `provider in PRICE_TABLE` 仍把 omniroute 当 priced——若 Exclude 未改，`omniroute` 不在 PRICE_TABLE 里，`isPricedProvider` 可能已是 false。确认类型 `Exclude<..., 'omniroute'>` 编译通过；补测试即可。）

- [ ] **Step 3: 最小实现**

```ts
export type PricedProvider = Exclude<LlmProvider, 'deepseek' | 'openrouter' | 'omniroute'>;
```

注释里补一句 OmniRoute 本地聚合、费用不显示。

- [ ] **Step 4: 全绿**

Run: `npx vitest run tests/billing`

- [ ] **Step 5: 提交**

```bash
git add lib/billing/prices.ts tests/billing/
git commit -m "$(cat <<'EOF'
feat(billing): treat omniroute like openrouter with null cost

EOF
)"
```

---

### Task 7: settings-storage — omniroute 不要求 Key

**Files:**
- Modify: `lib/client/settings-storage.ts`
- Modify: `tests/client/settings-storage.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('omniroute 空 Key 可通过校验', () => {
  expect(validateSettings({ provider: 'omniroute', model: 'm1', apiKey: '' })).toBeNull();
});

it('omniroute 仍要求非空模型', () => {
  expect(validateSettings({ provider: 'omniroute', model: '  ', apiKey: '' })).toBe(
    '请先填写模型名再开局',
  );
});

it('buildStartRequestBody 对 omniroute 强制 apiKey 为空串', () => {
  expect(
    buildStartRequestBody({ provider: 'omniroute', model: ' m ', apiKey: 'should-clear' }),
  ).toEqual({ provider: 'omniroute', model: 'm', apiKey: '' });
});
```

更新「非法 provider」提示期望文案，加入「本地 OmniRoute」。

- [ ] **Step 2: 红**

Run: `npx vitest run tests/client/settings-storage.test.ts`

- [ ] **Step 3: 实现**

```ts
if (settings.provider !== 'omniroute' && settings.apiKey.trim() === '') {
  return '请先填写 API Key 再开局';
}

// buildStartRequestBody:
apiKey: settings.provider === 'omniroute' ? '' : settings.apiKey.trim(),
```

- [ ] **Step 4: 绿 → Step 5: 提交**

```bash
git add lib/client/settings-storage.ts tests/client/settings-storage.test.ts
git commit -m "$(cat <<'EOF'
feat(settings): skip apiKey requirement for omniroute

EOF
)"
```

---

### Task 8: SettingsForm UI — 隐藏 Key、模型下拉 + 刷新

**Files:**
- Modify: `components/SettingsForm.tsx`
- Modify: `app/globals.css`（仅必要时）
- 无组件单测；靠 `npm run typecheck`

**行为（spec §5）：**
- 供应商选项自动来自 `PROVIDERS`（已含「本地 OmniRoute」）
- `settings.provider === 'omniroute'` 时：
  - 不渲染 API Key 输入与「清除已保存的 Key」
  - 模型改为 `<select>`；旁挂「刷新」按钮
  - `useEffect`：provider 变为 omniroute 或挂载时为 omniroute → `fetch('/api/omniroute/models')`
  - 成功：保存 `models: string[]`；若当前 `settings.model` 在列表中则保留，否则选 `models[0]` 并 `onChange`
  - 失败：展示中文错误，`models=[]`；父级 `validateSettings` 仍要非空 model——若无模型可选，额外用本地 `modelsError` 让用户知道；TopBar 开局仍走 `validateSettings`，但若列表失败且 model 仍是占位，应禁止开局。实现建议：拉失败时把 model 留着但在表单显示错误；若 `models.length === 0` 且有 error，可在 `onChange` 时由页面侧检查——最简：拉失败后 `onChange({ ...settings, model: '' })` 清空模型，这样 `validateSettings` 自然挡住开局。
  - 切换到 omniroute 时顺带 `apiKey: ''`
- 非 omniroute：保持原 text input 模型 + Key 字段

示意：

```tsx
const isOmniroute = settings.provider === 'omniroute';
const [models, setModels] = useState<string[]>([]);
const [modelsError, setModelsError] = useState<string | null>(null);
const [modelsLoading, setModelsLoading] = useState(false);

async function refreshModels() {
  setModelsLoading(true);
  setModelsError(null);
  try {
    const res = await fetch('/api/omniroute/models');
    const body = (await res.json()) as { models?: string[]; error?: string };
    if (!res.ok) {
      setModels([]);
      setModelsError(body.error ?? '无法拉取 OmniRoute 模型列表');
      onChange({ ...settings, provider: 'omniroute', model: '', apiKey: '' });
      return;
    }
    const list = Array.isArray(body.models) ? body.models : [];
    setModels(list);
    if (list.length === 0) {
      setModelsError('OmniRoute 未返回任何模型');
      onChange({ ...settings, provider: 'omniroute', model: '', apiKey: '' });
      return;
    }
    const nextModel = list.includes(settings.model) ? settings.model : list[0];
    onChange({ ...settings, provider: 'omniroute', model: nextModel, apiKey: '' });
  } catch {
    setModels([]);
    setModelsError('无法拉取 OmniRoute 模型列表');
    onChange({ ...settings, provider: 'omniroute', model: '', apiKey: '' });
  } finally {
    setModelsLoading(false);
  }
}

useEffect(() => {
  if (isOmniroute) void refreshModels();
  // eslint：仅在 provider 切到 omniroute 时拉
}, [settings.provider]);
```

`changeProvider`：切到 omniroute 时 `apiKey: ''`；切走时恢复 `DEFAULT_MODELS[provider]`。

- [ ] **Step 1: 无单测 — 直接实现并 typecheck**

- [ ] **Step 2: 实现 UI**

- [ ] **Step 3: 跑 `npm run typecheck` 与 `npm test`**

- [ ] **Step 4: 提交**

```bash
git add components/SettingsForm.tsx app/globals.css
git commit -m "$(cat <<'EOF'
feat(ui): OmniRoute model dropdown without API key field

EOF
)"
```

---

### Task 9: .env.example + README

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: 更新 `.env.example`**

```bash
# 本地 OmniRoute（provider=omniroute 时使用；Key 可选，上游 Key 配在 OmniRoute 内）
OMNIROUTE_BASE_URL=http://127.0.0.1:20128/v1
OMNIROUTE_API_KEY=
```

同步修正文件头注释：多数供应商仍在页面填 Key；OmniRoute 例外。

- [ ] **Step 2: README**

- 「环境要求」补一句可选：本机 OmniRoute（`omniroute serve`，默认 `127.0.0.1:20128`）
- 环境变量表增加两行 `OMNIROUTE_*`
- 「快速开始」或账单节加一句：选「本地 OmniRoute」时页面免填 Key，模型从下拉选择，需本机已运行 OmniRoute；账单与 OpenRouter 一样只显示 token、不显示金额
- 目录树 `lib/llm/` 描述补 OmniRoute

- [ ] **Step 3: 提交**

```bash
git add .env.example README.md
git commit -m "$(cat <<'EOF'
docs: document OmniRoute env vars and keyless setup

EOF
)"
```

---

### Task 10: 收尾验收

- [ ] **Step 1:** `npm test && npm run typecheck` 全绿
- [ ] **Step 2:** 扫一遍确认无 Key 泄漏、无浏览器直连 `20128`、所有 spec §6 测试点覆盖
- [ ] **Step 3:** 若有遗漏测试失败则热修并提交 `fix(omniroute): ...`

---

## 手工验收（不进 CI）

1. 本机 `omniroute serve` 后 `npm run dev`
2. 选「本地 OmniRoute」→ 无 Key 框 → 下拉有模型 → 免 Key 开局
3. 停掉 OmniRoute → 刷新模型 → 见中文错误、开局禁用
4. `npm run dev:tunnel` 远程打开同一 UI，确认模型列表仍来自**跑 Next 的那台机器**上的 OmniRoute
