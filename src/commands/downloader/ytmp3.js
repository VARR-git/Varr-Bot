/**
 * `.ytmp3 <url>` — unduh audio YouTube sebagai MP3.
 */

const { executeDownload } = require('./_shared');

module.exports = {
  name: 'ytmp3',
  aliases: ['yta', 'ytaudio', 'mp3'],
  category: 'downloader',
  description: 'Unduh audio YouTube (MP3)',
  descriptionKey: 'commands.ytmp3.description',
  usage: 'ytmp3 <url youtube>',
  examples: ['ytmp3 https://youtu.be/xxxxxxxxxxx', 'ytmp3 https://www.youtube.com/watch?v=xxxxxxxxxxx'],
  permission: 'user',
  scope: 'all',
  cooldown: 20,

  async execute(ctx) {
    return executeDownload(ctx, {
      platform: 'youtube',
      platformLabel: 'YouTube',
      kind: 'audio',
    });
  },
};
