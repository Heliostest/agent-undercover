export type SpeechAngleId = 'feel' | 'timing' | 'habit' | 'object';

export interface SpeechAngle {
  id: SpeechAngleId;
  label: string;
  hint: string;
}

/**
 * 发言角度池：只用来构建 speech 提示词，属于每位玩家的私有信息。
 * 绝不能进公开 log、SSE 事件或 toPublicView，否则别人一眼就能看出谁被分到了哪条线。
 */
export const SPEECH_ANGLES: readonly SpeechAngle[] = [
  { id: 'feel', label: '感受/心情', hint: '身体或心情上的一点感觉' },
  { id: 'timing', label: '时机/场合', hint: '什么时候会想到它' },
  { id: 'habit', label: '个人小习惯', hint: '一个很小的个人习惯' },
  { id: 'object', label: '相关的人或物', hint: '相关的人或物（不说词本身）' },
];

/**
 * 给本轮每位发言者分一个角度：先从还没用过的里抽，抽空了再从整池抽（允许重复），
 * 这样 4 人局里四条线一定岔开，人数多于角度数时也不会有人拿不到。
 * rng 与项目其它处同义：返回 [0, 1)。
 */
export function pickSpeechAngles(
  seatIds: readonly number[],
  rng: () => number,
): Map<number, SpeechAngle> {
  const assigned = new Map<number, SpeechAngle>();
  let pool = [...SPEECH_ANGLES];
  for (const seatId of seatIds) {
    if (pool.length === 0) {
      pool = [...SPEECH_ANGLES];
    }
    const index = Math.min(Math.floor(rng() * pool.length), pool.length - 1);
    assigned.set(seatId, pool[index]);
    pool.splice(index, 1);
  }
  return assigned;
}
