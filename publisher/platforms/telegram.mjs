// Telegram channel via the Bot API (the bot is a channel admin allowed to post).
// One slide: sendPhoto. 2–10 slides: sendMediaGroup (an album; the caption sits on the first photo).
// Reel: sendVideo with the cover image. Every file is uploaded as bytes, so nothing waits for the media host.
// The caption is the Facebook one (no hashtags, has the full link), as plain text: no parse_mode, so * and _ are safe.
// Captions over 1024 characters: the media gets the first paragraph and the full text follows as a reply.
import fs from 'node:fs';
import path from 'node:path';
import { request } from '../lib/http.mjs';

export const CAPTION_MAX = 1024;

/** Splits a caption that is too long for media into a short caption and the full text to send after it. */
export function splitCaption(text) {
  if (text.length <= CAPTION_MAX) return { caption: text, rest: null };
  const first = text.split(/\n\s*\n/)[0].trim();
  if (first.length <= CAPTION_MAX) return { caption: first, rest: text };
  const cut = first.slice(0, CAPTION_MAX - 1);
  return { caption: cut.slice(0, cut.lastIndexOf(' ')).trimEnd() + '…', rest: text };
}

export async function postTelegram({ post, manifest, local, cfg, log = () => {}, silent = false }) {
  const t = cfg.telegram;
  if (!t.token || !t.chatId) throw new Error('Telegram is not set up: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are needed');
  const api = method => `${t.base}/bot${t.token}/${method}`;
  const { caption, rest } = splitCaption(post.captions.facebook);
  const form = () => {
    const f = new FormData();
    f.append('chat_id', t.chatId);
    if (silent) f.append('disable_notification', 'true');
    return f;
  };
  const attach = (f, field, name) => f.append(field, new Blob([fs.readFileSync(local(name))]), path.basename(name));

  let messageId;
  if (manifest.type === 'reel') {
    const f = form();
    f.append('caption', caption);
    f.append('supports_streaming', 'true');
    if (manifest.duration) f.append('duration', String(Math.round(manifest.duration)));
    attach(f, 'video', manifest.video);
    if (manifest.cover) { f.append('cover', 'attach://cover'); attach(f, 'cover', manifest.cover); }
    messageId = (await request('POST', api('sendVideo'), { body: f })).result.message_id;
  } else if (manifest.images.length === 1) {
    const f = form();
    f.append('caption', caption);
    attach(f, 'photo', manifest.images[0]);
    messageId = (await request('POST', api('sendPhoto'), { body: f })).result.message_id;
  } else {
    const f = form();
    const media = manifest.images.map((img, i) => ({ type: 'photo', media: `attach://p${i}`, ...(i === 0 && { caption }) }));
    f.append('media', JSON.stringify(media));
    manifest.images.forEach((img, i) => attach(f, `p${i}`, img));
    messageId = (await request('POST', api('sendMediaGroup'), { body: f })).result[0].message_id;
  }

  // The post is out once the media is; a failed follow-up must not make the next run post the media again.
  let full_text;
  if (rest) {
    try {
      await request('POST', api('sendMessage'), { json: {
        chat_id: t.chatId, text: rest, reply_parameters: { message_id: messageId }, link_preview_options: { is_disabled: true },
        ...(silent && { disable_notification: true }) } });
      full_text = 'sent';
    } catch (e) {
      full_text = 'failed: ' + e.message;
      log(`    telegram: the full caption didn't send (${e.message}); post it under message ${messageId} by hand`);
    }
  }
  return { id: String(messageId), ...(full_text && { full_text }) };
}
