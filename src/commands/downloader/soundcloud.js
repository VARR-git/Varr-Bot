/**
 * `.soundcloud <url>` — unduh audio SoundCloud sebagai MP3.
 */

const { executeDownload } = require('./_shared');

module.exports = {
  name: 'soundcloud',
  aliases: ['scdl'],
  category: 'downloader',
  description: 'Unduh audio SoundCloud (MP3)',
  descriptionKey: 'commands.soundcloud.description',
  usage: 'soundcloud <url soundcloud>',
  examples: ['soundcloud https://soundcloud.com/user/track-name'],
  permission: 'user',
  scope: 'all',
  cooldown: 20,
  timeoutMs: 660_000,

  async execute(ctx) {
    return executeDownload(ctx, {
      platform: 'soundcloud',
      platformLabel: 'SoundCloud',
      kind: 'audio',
    });
  },
};
