/**
 * `.tiktok <url>` — unduh video TikTok tanpa watermark.
 */

const { executeDownload } = require('./_shared');

module.exports = {
  name: 'tiktok',
  aliases: ['tt', 'ttdl'],
  category: 'downloader',
  description: 'Unduh video TikTok tanpa watermark',
  descriptionKey: 'commands.tiktok.description',
  usage: 'tiktok <url tiktok>',
  examples: ['tiktok https://vt.tiktok.com/xxxxxxx/', 'tiktok https://www.tiktok.com/@user/video/123'],
  permission: 'user',
  scope: 'all',
  cooldown: 20,

  async execute(ctx) {
    return executeDownload(ctx, {
      platform: 'tiktok',
      platformLabel: 'TikTok',
      kind: 'video',
    });
  },
};
