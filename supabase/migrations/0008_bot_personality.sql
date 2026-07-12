alter table games add column bot_personality text check (bot_personality in ('aggressive', 'neutral', 'defensive'));
