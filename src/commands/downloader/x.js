/**
 * `.x <url>` — unduh video X / Twitter.
 */

const { executeDownload } = require('./_shared');

module.exports = {
  name: 'x',
  aliases: ['twitter', 'twdl'],
  category: 'downloader',
  description: 'Unduh video X (Twitter)',
  descriptionKey: 'commands.x.description',
  usage: 'x <url x/twitter>',
  examples: ['x https://x.com/user/status/1234567890', 'twitter https://twitter.com/user/status/1234567890'],
  permission: 'user',
  scope: 'all',
  cooldown: 20,
  timeoutMs: 660_000,

  async execute(ctx) {
    return executeDownload(ctx, {
      platform: 'x',
      platformLabel: 'X',
      kind: 'video',
    });
  },
};
