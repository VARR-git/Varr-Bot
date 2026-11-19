/**
 * `.threads <url>` — unduh video/media Threads.
 */

const { executeDownload } = require('./_shared');

module.exports = {
  name: 'threads',
  aliases: [],
  category: 'downloader',
  description: 'Unduh video/media Threads',
  descriptionKey: 'commands.threads.description',
  usage: 'threads <url threads>',
  examples: ['threads https://www.threads.net/@user/post/xxxxxxx'],
  permission: 'user',
  scope: 'all',
  cooldown: 20,
  timeoutMs: 660_000,

  async execute(ctx) {
    return executeDownload(ctx, {
      platform: 'threads',
      platformLabel: 'Threads',
      kind: 'video',
    });
  },
};
