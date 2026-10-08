import { useState, type FormEvent, type JSX } from 'react';
import type { ViewSlot } from '../lib/gameHelpers.ts';
import type { ChatMessage } from '../types.ts';

interface ChatLogProps {
  messages: ChatMessage[];
  mySlot: ViewSlot;
  showForm: boolean;
  onSend: (body: string) => Promise<void>;
}

export function ChatLog({ messages, mySlot, showForm, onSend }: ChatLogProps): JSX.Element {
  const [draft, setDraft] = useState('');

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    void onSend(body).catch(() => {
      /* The hook stores the message for the inline error near the board. */
    });
  }

  return (
    <>
      <ul id="chat-log">
        {messages.map((message, index) => (
          <li key={`${message.created_at}-${message.player_slot}-${index}`}>
            {`${message.player_slot === mySlot ? 'You' : 'Opponent'}: ${message.body}`}
          </li>
        ))}
      </ul>
      <form id="chat-form" hidden={!showForm} onSubmit={onSubmit}>
        <input
          id="chat-input"
          maxLength={500}
          placeholder="Say something..."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit">Send</button>
      </form>
    </>
  );
}
