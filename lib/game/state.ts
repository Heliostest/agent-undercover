import {
  SEAT_COUNT,
  type AgentView,
  type GameState,
  type GodGameView,
  type Persona,
  type PublicGameView,
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
    log: [...state.log],
    winner: state.winner,
    errorMessage: state.errorMessage,
    // 账单不进 GameState，只靠 bill 事件推给浏览器。
    bill: null,
  };
}

export function toGodView(state: GameState): GodGameView {
  return { ...toPublicView(state), reveal: revealOf(state) };
}

export function buildAgentView(state: GameState, seatId: number): AgentView {
  const seat = seatById(state, seatId);
  return {
    seatId: seat.id,
    seatName: seat.name,
    word: seat.word,
    round: state.round,
    seats: toPublicSeats(state),
    log: [...state.log],
    aliveOtherIds: aliveSeats(state)
      .filter((candidate) => candidate.id !== seatId)
      .map((candidate) => candidate.id),
  };
}
