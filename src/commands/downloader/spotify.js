/**
 * `.spotify <url>` — unduh audio Spotify sebagai MP3.
 * URL langsung dilindungi DRM; service memakai fallback `ytsearch1:`.
 */

const { executeDownload } = require('./_shared');

module.exports = {
  name: 'spotify',
  aliases: ['spdl'],
  category: 'downloader',
  description: 'Unduh audio Spotify (MP3)',
  descriptionKey: 'commands.spotify.description',
  usage: 'spotify <url spotify>',
  examples: ['spotify https://open.spotify.com/track/xxxxxxxxxxxxxxxx'],
  permission: 'user',
  scope: 'all',
  cooldown: 20,
  timeoutMs: 660_000,

  async execute(ctx) {
    return executeDownload(ctx, {
      platform: 'spotify',
      platformLabel: 'Spotify',
      kind: 'audio',
    });
  },
};
