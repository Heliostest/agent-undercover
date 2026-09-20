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

export interface SpeechEntry {
  kind: 'speech';
  round: number;
  seatId: number;
  text: string;
  fallback: boolean;
}

export interface VoteEntry {
  kind: 'vote';
  round: number;
  /** 本轮里的第几次投票，从 1 开始；平票重投会得到 2，不能和第 1 次混在一起算。 */
  ballot: number;
  seatId: number;
  targetSeatId: number;
  reason: string;
  fallback: boolean;
}

export interface EliminationEntry {
  kind: 'elimination';
  round: number;
  seatId: number;
  tieBreak: boolean;
}

export type LogEntry = SpeechEntry | VoteEntry | EliminationEntry;

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
  log: LogEntry[];
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

export interface GodGameView extends PublicGameView {
  reveal: RevealSeat[];
}

/** 单个 agent 能看到的全部信息：自己的词 + 公开信息，绝不含别人的词或身份。 */
export interface AgentView {
  seatId: number;
  seatName: string;
  word: string;
  round: number;
  seats: PublicSeat[];
  log: LogEntry[];
  aliveOtherIds: number[];
}

export interface SpeechResult {
  text: string;
  fallback: boolean;
}

export interface VoteResult {
  targetSeatId: number;
  reason: string;
  fallback: boolean;
}

/** Judge 只依赖这个接口，测试可以塞脚本化的假 agent。 */
export interface SeatAgent {
  speak(view: AgentView): Promise<SpeechResult>;
  vote(view: AgentView, candidateIds: number[], rng: () => number): Promise<VoteResult>;
}

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
