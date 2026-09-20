import type { Bill } from '@/lib/billing/estimate';

export type Phase = 'setup' | 'speak' | 'vote' | 'result' | 'error';

export type Role = 'civilian' | 'undercover';

export type Winner = 'civilians' | 'undercover';

export const SEAT_COUNT = 4;

export const WORD_CATEGORIES = ['classic', 'workplace', 'social', 'daily', 'mixup'] as const;
export type WordCategory = (typeof WORD_CATEGORIES)[number];

export interface WordPair {
  civilian: string;
  undercover: string;
  /** 仅供服务端抽题，不能发给玩家作为额外线索。 */
  category?: WordCategory;
}

export interface Persona {
  id: string;
  name: string;
  label: string;
  systemPrompt: string;
}

export interface Seat {
  id: number;
  name: string;
  personaId: string;
  personaLabel: string;
  role: Role;
  word: string;
  alive: boolean;
}

/**
 * 公开发言：所有人（包括其他 agent）都能看到的那一份，绝不含内心独白。
 * 服务端日志用的是它的私有版本 SpeechEntry。
 */
export interface PublicSpeechEntry {
  kind: 'speech';
  round: number;
  seatId: number;
  text: string;
  fallback: boolean;
}

export interface SpeechEntry extends PublicSpeechEntry {
  /**
   * 内心独白：与 text 出自同一次模型调用，但只允许留在服务端日志里。
   * 它可以提到自己的词，所以绝不能进别人的提示词、公开时间线或 SSE 帧。
   */
  thought: string;
}

export interface PublicVoteEntry {
  kind: 'vote';
  round: number;
  /** 本轮里的第几次投票，从 1 开始；平票重投会得到 2，不能和第 1 次混在一起算。 */
  ballot: number;
  seatId: number;
  targetSeatId: number;
  reason: string;
  fallback: boolean;
}

export interface VoteEntry extends PublicVoteEntry {
  /** 同 SpeechEntry.thought：只进服务端日志与上帝视角。 */
  thought: string;
}

export interface EliminationEntry {
  kind: 'elimination';
  round: number;
  seatId: number;
  tieBreak: boolean;
}

/** 服务端日志条目：带内心独白。 */
export type LogEntry = SpeechEntry | VoteEntry | EliminationEntry;

/** 能发给浏览器或塞进 agent 提示词的日志条目：一定不带内心独白。 */
export type PublicLogEntry = PublicSpeechEntry | PublicVoteEntry | EliminationEntry;

export interface GameState {
  gameId: string;
  seats: Seat[];
  round: number;
  phase: Phase;
  activeSeatId: number | null;
  log: LogEntry[];
  winner: Winner | null;
  errorMessage: string | null;
}

export interface PublicSeat {
  id: number;
  name: string;
  personaLabel: string;
  alive: boolean;
}

export interface PublicGameView {
  gameId: string;
  round: number;
  phase: Phase;
  activeSeatId: number | null;
  seats: PublicSeat[];
  log: PublicLogEntry[];
  winner: Winner | null;
  errorMessage: string | null;
  /** 局末账单；没结束或没收到 bill 事件时为 null。 */
  bill: Bill | null;
}

export interface RevealSeat {
  seatId: number;
  role: Role;
  word: string;
}

/** 上帝视角是唯一带内心独白的视图：调试面板与终局复盘用。 */
export interface GodGameView extends PublicGameView {
  reveal: RevealSeat[];
  log: LogEntry[];
}

/**
 * 单个 agent 能看到的全部信息：自己的词 + 公开信息，
 * 绝不含别人的词或身份，也绝不含任何人（包括他自己）的内心独白。
 */
export interface AgentView {
  seatId: number;
  seatName: string;
  word: string;
  round: number;
  seats: PublicSeat[];
  log: PublicLogEntry[];
  aliveOtherIds: number[];
}

export interface SpeechResult {
  text: string;
  /** 同一次模型调用里的私密推理；兜底或模型没给时是空字符串。 */
  thought: string;
  fallback: boolean;
}

export interface VoteResult {
  targetSeatId: number;
  reason: string;
  /** 同 SpeechResult.thought。 */
  thought: string;
  fallback: boolean;
}

/**
 * Judge 只依赖这个接口，测试可以塞脚本化的假 agent。
 * signal 是整局取消信号：没人在看时传下来，实现方应尽快停掉在途的模型调用。
 */
export interface SeatAgent {
  speak(view: AgentView, signal?: AbortSignal): Promise<SpeechResult>;
  vote(
    view: AgentView,
    candidateIds: number[],
    rng: () => number,
    signal?: AbortSignal,
  ): Promise<VoteResult>;
}

/** 广播给浏览器的事件一律是公开信息：speech / vote payload 永远不带 thought 字段。 */
export type GameEvent =
  | { type: 'phase'; phase: Phase; round: number; activeSeatId: number | null }
  | { type: 'speech'; round: number; seatId: number; text: string; fallback: boolean }
  | {
      type: 'vote';
      round: number;
      /** 与 VoteEntry.ballot 同义：本轮里的第几次投票。 */
      ballot: number;
      seatId: number;
      targetSeatId: number;
      reason: string;
      fallback: boolean;
    }
  | {
      type: 'result';
      round: number;
      eliminatedSeatId: number | null;
      tieBreak: boolean;
      winner: Winner | null;
      reveal: RevealSeat[] | null;
    }
  /** 终局事件之前发出的本局估算账单，绝不含 API Key。 */
  | { type: 'bill'; bill: Bill }
  | { type: 'error'; message: string };
