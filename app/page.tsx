'use client';

import { GodPanel } from '@/components/GodPanel';
import { SeatCard } from '@/components/SeatCard';
import { Timeline } from '@/components/Timeline';
import { TopBar } from '@/components/TopBar';
import { VoteBar } from '@/components/VoteBar';
import { useGameStream } from '@/lib/client/use-game-stream';

export default function HomePage() {
  const { view, status, errorMessage, start } = useGameStream();

  return (
    <main className="page">
      <TopBar view={view} status={status} onStart={() => void start()} />

      {errorMessage ? <p className="panel danger">{errorMessage}</p> : null}

      {view ? (
        <>
          <section className="seat-grid">
            {view.seats.map((seat) => (
              <SeatCard key={seat.id} seat={seat} activeSeatId={view.activeSeatId} />
            ))}
          </section>
          <Timeline view={view} />
          <VoteBar view={view} />
          <GodPanel gameId={view.gameId} />
        </>
      ) : (
        <p className="panel muted">点「开始」让四个 AI 玩家自动打一局。</p>
      )}
    </main>
  );
}
