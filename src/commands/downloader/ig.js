/**
 * `.ig <url>` — unduh Reels/Post/Video Instagram.
 */

const { executeDownload } = require('./_shared');

module.exports = {
  name: 'ig',
  aliases: ['instagram', 'igdl'],
  category: 'downloader',
  description: 'Unduh Reels/Post/Video Instagram',
  descriptionKey: 'commands.ig.description',
  usage: 'ig <url instagram>',
  examples: ['ig https://www.instagram.com/reel/xxxxxxx/'],
  permission: 'user',
  scope: 'all',
  cooldown: 20,
  timeoutMs: 660_000,

  async execute(ctx) {
    return executeDownload(ctx, {
      platform: 'instagram',
      platformLabel: 'Instagram',
      kind: 'video',
    });
  },
};
