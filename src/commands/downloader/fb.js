/**
 * `.fb <url>` — unduh Video/Reels Facebook.
 */

const { executeDownload } = require('./_shared');

module.exports = {
  name: 'fb',
  aliases: ['facebook', 'fbdl'],
  category: 'downloader',
  description: 'Unduh Video/Reels Facebook',
  descriptionKey: 'commands.fb.description',
  usage: 'fb <url facebook>',
  examples: ['fb https://www.facebook.com/watch/?v=1234567890', 'fb https://fb.watch/xxxxxxx/'],
  permission: 'user',
  scope: 'all',
  cooldown: 20,
  timeoutMs: 660_000,

  async execute(ctx) {
    return executeDownload(ctx, {
      platform: 'facebook',
      platformLabel: 'Facebook',
      kind: 'video',
    });
  },
};
