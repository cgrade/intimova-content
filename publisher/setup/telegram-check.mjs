// Checks that the Telegram bot can post to the channel: npm run telegram:check
// Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in the environment (the "Check Telegram" workflow passes the GitHub ones).
// Never prints the token.
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../lib/config.mjs';
import { request } from '../lib/http.mjs';

export async function checkTelegram(cfg = loadConfig()) {
  const t = cfg.telegram;
  const lines = [];
  if (!t.token || !t.chatId) {
    return { ok: false, lines: ['✗ TELEGRAM_BOT_TOKEN (secret) and TELEGRAM_CHAT_ID (variable, the channel\'s @username) are both needed.'] };
  }
  const call = (method, json) => request('POST', `${t.base}/bot${t.token}/${method}`, { json, retries: 1 }).then(r => r.result);
  let me, chat, member;
  try { me = await call('getMe', {}); }
  catch (e) { return { ok: false, lines: [`✗ Telegram refused the bot token: ${e.message}. Check TELEGRAM_BOT_TOKEN is the token @BotFather gave you.`] }; }
  lines.push(`✓ Bot: @${me.username}`);
  try { chat = await call('getChat', { chat_id: t.chatId }); }
  catch (e) { return { ok: false, lines: [...lines, `✗ Can't see the channel ${t.chatId}: ${e.message}. Check TELEGRAM_CHAT_ID, and add the bot to the channel as an admin.`] }; }
  lines.push(`✓ Channel: ${chat.title}${chat.username ? ` (@${chat.username})` : ''}`);
  try { member = await call('getChatMember', { chat_id: t.chatId, user_id: me.id }); }
  catch (e) { return { ok: false, lines: [...lines, `✗ Can't read the bot's rights in the channel: ${e.message}. In the channel, make the bot an admin with "Post messages".`] }; }
  const ok = member.status === 'creator' || (member.status === 'administrator' && member.can_post_messages === true);
  lines.push(ok ? '✓ The bot is an admin and can post messages. Telegram is ready.'
    : `✗ The bot is ${member.status === 'administrator' ? 'an admin without "Post messages"' : `a ${member.status}`}. In the channel, make the bot an admin with "Post messages".`);
  return { ok, lines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await checkTelegram();
  for (const l of r.lines) console.log(l);
  process.exit(r.ok ? 0 : 1);
}
