import { describe, expect, it } from 'vitest';

import { SPEECH_ANGLES, pickSpeechAngles } from '@/lib/game/speech-angles';

describe('SPEECH_ANGLES', () => {
  it('恰好 4 个且 id 不重复', () => {
    expect(SPEECH_ANGLES).toHaveLength(4);
    expect(new Set(SPEECH_ANGLES.map((angle) => angle.id)).size).toBe(4);
  });

  it('每个角度都带中文 label 与 hint', () => {
    for (const angle of SPEECH_ANGLES) {
      expect(angle.label).toBeTruthy();
      expect(angle.hint).toBeTruthy();
    }
  });
});

describe('pickSpeechAngles', () => {
  it('4 个座位时 id 互不重复', () => {
    const map = pickSpeechAngles([0, 1, 2, 3], () => 0);
    const ids = [...map.values()].map((angle) => angle.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it('2 个座位时各有 angle（允许将来轮次重复）', () => {
    const map = pickSpeechAngles([0, 3], () => 0.9);
    expect(map.size).toBe(2);
    expect(map.get(0)?.hint).toBeTruthy();
    expect(map.get(3)?.hint).toBeTruthy();
  });

  it('座位多于角度池时允许重复，但每个座位都拿得到 angle', () => {
    const seatIds = [0, 1, 2, 3, 4, 5];
    const map = pickSpeechAngles(seatIds, () => 0);
    expect(map.size).toBe(seatIds.length);
    for (const seatId of seatIds) {
      expect(map.get(seatId)).toBeDefined();
    }
  });

  it('同一个 rng 序列给出确定的分配结果', () => {
    const sequence = () => {
      const values = [0.9, 0.1, 0.5, 0];
      let index = 0;
      return () => values[index++ % values.length];
    };
    const first = pickSpeechAngles([0, 1, 2, 3], sequence());
    const second = pickSpeechAngles([0, 1, 2, 3], sequence());
    expect([...first.values()].map((angle) => angle.id)).toEqual(
      [...second.values()].map((angle) => angle.id),
    );
  });

  it('座位为空时返回空映射', () => {
    expect(pickSpeechAngles([], () => 0).size).toBe(0);
  });
});
