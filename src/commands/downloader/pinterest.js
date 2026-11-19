/**
 * `.pinterest <url>` — unduh video/gambar Pinterest.
 */

const { executeDownload } = require('./_shared');

module.exports = {
  name: 'pinterest',
  aliases: ['pin', 'pindl'],
  category: 'downloader',
  description: 'Unduh video/gambar Pinterest',
  descriptionKey: 'commands.pinterest.description',
  usage: 'pinterest <url pinterest>',
  examples: ['pinterest https://www.pinterest.com/pin/1234567890/', 'pin https://pin.it/xxxxxxx'],
  permission: 'user',
  scope: 'all',
  cooldown: 20,
  timeoutMs: 660_000,

  async execute(ctx) {
    return executeDownload(ctx, {
      platform: 'pinterest',
      platformLabel: 'Pinterest',
      kind: 'video',
    });
  },
};
