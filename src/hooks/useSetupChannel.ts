import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient.ts';

export interface SetupChannelHandlers {
  onActive: () => void;
  onBothSubmitted: (bothSubmittedAt: string) => void;
  onCountdownCleared: () => void;
}

/**
 * Subscribes to the game row after this seat has submitted.
 * `status === "active"` navigates. A new `both_submitted_at` starts the
 * countdown. Clearing it stops the countdown. The channel is removed on cleanup.
 */
export function useSetupChannel(
  roomCode: string | null,
  enabled: boolean,
  handlers: SetupChannelHandlers,
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled || !roomCode) return;
    const code = roomCode;
    let removed = false;
    let channel: RealtimeChannel | null = null;

    async function subscribe(): Promise<void> {
      const { data } = await supabase.from('games').select('id').eq('room_code', code).single();
      if (removed) return;
      const id =
        data && typeof data === 'object' && data !== null && 'id' in data && data.id != null
          ? String(data.id)
          : '';
      if (!id) return;

      channel = supabase
        .channel(`setup-wait-${id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'games',
            filter: `id=eq.${id}`,
          },
          (payload) => {
            const next = payload.new as { status?: string; both_submitted_at?: string | null };
            if (next.status === 'active') {
              handlersRef.current.onActive();
              return;
            }
            if (typeof next.both_submitted_at === 'string' && next.both_submitted_at.length > 0) {
              handlersRef.current.onBothSubmitted(next.both_submitted_at);
              return;
            }
            handlersRef.current.onCountdownCleared();
          },
        )
        .subscribe();

      if (removed) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    }

    void subscribe();

    return () => {
      removed = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [enabled, roomCode]);
}
