import type { AgentView, Persona, PublicSeat } from '@/lib/game/types';
import type { LlmMessage } from '@/lib/llm/types';

export const DEFAULT_VOTE_REASON = '（没有说明理由）';

function nameOf(seats: PublicSeat[], seatId: number): string {
  return seats.find((seat) => seat.id === seatId)?.name ?? `座位${seatId}`;
}

export function renderTranscript(view: AgentView): string {
  if (view.log.length === 0) {
    return '（暂无公开记录）';
  }
  return view.log
    .map((entry) => {
      switch (entry.kind) {
        case 'speech':
          return `第${entry.round}轮 发言 ${nameOf(view.seats, entry.seatId)}：${entry.text}`;
        case 'vote':
          return `第${entry.round}轮 投票 ${nameOf(view.seats, entry.seatId)} → ${nameOf(
            view.seats,
            entry.targetSeatId,
          )}，理由：${entry.reason}`;
        case 'elimination':
          return `第${entry.round}轮 出局：${nameOf(view.seats, entry.seatId)}${
            entry.tieBreak ? '（平票随机）' : ''
          }`;
      }
    })
    .join('\n');
}

function renderRoster(view: AgentView): string {
  return view.seats
    .map((seat) => `${seat.id}=${seat.name}${seat.alive ? '' : '（已出局）'}`)
    .join('，');
}

const RULES_BRIEF =
  '你正在玩「谁是卧底」。全场 4 人，其中 3 名平民拿到同一个词，1 名卧底拿到一个近义但不同的词。没有人知道自己是不是卧底。';

export function buildSpeechMessages(persona: Persona, view: AgentView): LlmMessage[] {
  return [
    { role: 'system', content: persona.systemPrompt },
    {
      role: 'user',
      content: [
        RULES_BRIEF,
        `你是 ${view.seatName}（座位 ${view.seatId}）。你拿到的词是「${view.word}」。`,
        `座位表：${renderRoster(view)}`,
        `现在是第 ${view.round} 轮发言。到目前为止的公开记录：`,
        renderTranscript(view),
        '要求：用 1~3 句话描述你手里的词，可以结合别人的发言。绝对不能写出词面本身，也不能拆字或拼音暗示；不要复述别人的原句。',
        '只输出 JSON，格式严格为：{"speech":"你的发言"}',
      ].join('\n'),
    },
  ];
}

export function buildVoteMessages(
  persona: Persona,
  view: AgentView,
  candidateIds: number[],
): LlmMessage[] {
  const candidates = candidateIds
    .map((seatId) => `${seatId}（${nameOf(view.seats, seatId)}）`)
    .join('、');
  return [
    { role: 'system', content: persona.systemPrompt },
    {
      role: 'user',
      content: [
        RULES_BRIEF,
        `你是 ${view.seatName}（座位 ${view.seatId}）。你拿到的词是「${view.word}」。`,
        `座位表：${renderRoster(view)}`,
        `现在是第 ${view.round} 轮投票。到目前为止的公开记录：`,
        renderTranscript(view),
        `可投的座位号：${candidates}。你必须从中选一个，不能弃票，不能投自己。`,
        '只输出 JSON，格式严格为：{"vote":0,"reason":"一句话理由"}',
      ].join('\n'),
    },
  ];
}

export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const withoutFence = raw.replace(/```(?:json)?/gi, '');
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(withoutFence.slice(start, end + 1));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseSpeechReply(raw: string, forbiddenWord: string): string | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    return null;
  }
  const speech = parsed.speech;
  if (typeof speech !== 'string') {
    return null;
  }
  const text = speech.trim();
  if (text === '' || text.includes(forbiddenWord)) {
    return null;
  }
  return text;
}

export function parseVoteReply(
  raw: string,
  candidateIds: number[],
): { targetSeatId: number; reason: string } | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    return null;
  }
  const rawVote = parsed.vote;
  const targetSeatId =
    typeof rawVote === 'number' ? rawVote : typeof rawVote === 'string' ? Number(rawVote) : Number.NaN;
  if (!Number.isInteger(targetSeatId) || !candidateIds.includes(targetSeatId)) {
    return null;
  }
  const rawReason = parsed.reason;
  const reason = typeof rawReason === 'string' && rawReason.trim() !== '' ? rawReason.trim() : DEFAULT_VOTE_REASON;
  return { targetSeatId, reason };
}
