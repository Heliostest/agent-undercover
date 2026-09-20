import {
  SEAT_COUNT,
  type AgentView,
  type GameState,
  type GodGameView,
  type LogEntry,
  type Persona,
  type PublicGameView,
  type PublicLogEntry,
  type PublicSeat,
  type RevealSeat,
  type Seat,
  type SpeechEntry,
  type VoteEntry,
  type WordPair,
} from '@/lib/game/types';

export interface CreateGameInput {
  gameId: string;
  personas: Persona[];
  pair: WordPair;
  undercoverSeatId: number;
}

export function createGame(input: CreateGameInput): GameState {
  if (input.personas.length !== SEAT_COUNT) {
    throw new Error(`需要 ${SEAT_COUNT} 个 persona，实际收到 ${input.personas.length} 个`);
  }
  if (
    !Number.isInteger(input.undercoverSeatId) ||
    input.undercoverSeatId < 0 ||
    input.undercoverSeatId >= SEAT_COUNT
  ) {
    throw new Error(`卧底座位号越界：${input.undercoverSeatId}`);
  }

  const seats: Seat[] = input.personas.map((persona, id) => {
    const isUndercover = id === input.undercoverSeatId;
    const seat: Seat = {
      id,
      name: persona.name,
      personaId: persona.id,
      personaLabel: persona.label,
      role: isUndercover ? 'undercover' : 'civilian',
      word: isUndercover ? input.pair.undercover : input.pair.civilian,
      alive: true,
    };
    return seat;
  });

  return {
    gameId: input.gameId,
    seats,
    round: 0,
    phase: 'setup',
    activeSeatId: null,
    log: [],
    winner: null,
    errorMessage: null,
  };
}

export function aliveSeats(state: GameState): Seat[] {
  return state.seats.filter((seat) => seat.alive);
}

export function seatById(state: GameState, seatId: number): Seat {
  const seat = state.seats.find((candidate) => candidate.id === seatId);
  if (!seat) {
    throw new Error(`座位 ${seatId} 不存在`);
  }
  return seat;
}

export function recordSpeech(state: GameState, entry: SpeechEntry): void {
  state.log.push(entry);
}

export function recordVote(state: GameState, entry: VoteEntry): void {
  state.log.push(entry);
}

export function eliminate(state: GameState, seatId: number, tieBreak: boolean): void {
  seatById(state, seatId).alive = false;
  state.log.push({ kind: 'elimination', round: state.round, seatId, tieBreak });
}

export function revealOf(state: GameState): RevealSeat[] {
  return state.seats.map((seat) => ({ seatId: seat.id, role: seat.role, word: seat.word }));
}

/**
 * 内心独白的唯一出口关卡：凡是要离开服务端的日志都得先过这里。
 * 显式挑字段而不是 delete，将来给 SpeechEntry / VoteEntry 加私有字段也不会漏出去。
 */
function toPublicLog(log: LogEntry[]): PublicLogEntry[] {
  return log.map((entry) => {
    switch (entry.kind) {
      case 'speech':
        return {
          kind: 'speech',
          round: entry.round,
          seatId: entry.seatId,
          text: entry.text,
          fallback: entry.fallback,
        };
      case 'vote':
        return {
          kind: 'vote',
          round: entry.round,
          ballot: entry.ballot,
          seatId: entry.seatId,
          targetSeatId: entry.targetSeatId,
          reason: entry.reason,
          fallback: entry.fallback,
        };
      case 'elimination':
        return { ...entry };
    }
  });
}

function toPublicSeats(state: GameState): PublicSeat[] {
  return state.seats.map((seat) => ({
    id: seat.id,
    name: seat.name,
    personaLabel: seat.personaLabel,
    alive: seat.alive,
  }));
}

export function toPublicView(state: GameState): PublicGameView {
  return {
    gameId: state.gameId,
    round: state.round,
    phase: state.phase,
    activeSeatId: state.activeSeatId,
    seats: toPublicSeats(state),
    log: toPublicLog(state.log),
    winner: state.winner,
    errorMessage: state.errorMessage,
    // 账单不进 GameState，只靠 bill 事件推给浏览器。
    bill: null,
  };
}

/** 上帝视角是唯一能看到内心独白的出口，所以它用的是未经剥离的原始日志。 */
export function toGodView(state: GameState): GodGameView {
  return { ...toPublicView(state), log: [...state.log], reveal: revealOf(state) };
}

export function buildAgentView(state: GameState, seatId: number): AgentView {
  const seat = seatById(state, seatId);
  return {
    seatId: seat.id,
    seatName: seat.name,
    word: seat.word,
    round: state.round,
    seats: toPublicSeats(state),
    // agent 只配看公开记录：连他自己上一轮的内心独白都不回灌，免得再被复述出去。
    log: toPublicLog(state.log),
    aliveOtherIds: aliveSeats(state)
      .filter((candidate) => candidate.id !== seatId)
      .map((candidate) => candidate.id),
  };
}
