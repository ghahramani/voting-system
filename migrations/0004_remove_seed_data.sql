DELETE FROM device_votes WHERE game_id IN (SELECT id FROM games WHERE arena_id = 1);
DELETE FROM votes WHERE game_id IN (SELECT id FROM games WHERE arena_id = 1);
DELETE FROM games WHERE arena_id = 1;
DELETE FROM sessions WHERE user_id = 1;
DELETE FROM arenas WHERE id = 1 AND owner_id = 1 AND name = 'The Classics';
DELETE FROM users WHERE id = 1 AND username = 'admin';
