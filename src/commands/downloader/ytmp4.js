/**
 * `.ytmp4 <url>` — unduh video YouTube sebagai MP4.
 */

const { executeDownload } = require('./_shared');

module.exports = {
  name: 'ytmp4',
  aliases: ['ytv', 'ytvideo', 'mp4'],
  category: 'downloader',
  description: 'Unduh video YouTube (MP4)',
  descriptionKey: 'commands.ytmp4.description',
  usage: 'ytmp4 <url youtube>',
  examples: ['ytmp4 https://youtu.be/xxxxxxxxxxx', 'ytmp4 https://www.youtube.com/watch?v=xxxxxxxxxxx'],
  permission: 'user',
  scope: 'all',
  cooldown: 20,
  timeoutMs: 660_000,

  async execute(ctx) {
    return executeDownload(ctx, {
      platform: 'youtube',
      platformLabel: 'YouTube',
      kind: 'video',
    });
  },
};
