'use strict';
const Misc = require('../lib/misc');
const pr = require('request-promise-native');
const sharp = require('sharp');

const orb = sharp('images/orb.png');

module.exports = (BotBase) =>
  class PonderMixin extends BotBase {
    constructor() {
      super();

      this.commands.ponder = {
        helpText: 'Ponder that thing you saw',
        args: [],
        method: 'command__ponder',
        sort: 160
      };
    }

    async command__ponder(params, message) {
      const messages = await message.channel.fetchMessages();
      const lastImage = messages.find(m => {
        return m.attachments?.size;
      });
      const attachment = lastImage.attachments.last();
      const imgBuffer = await pr({ uri: attachment.proxyURL, encoding: null });
      const img = await sharp(imgBuffer)
        .resize({
          width: 226,
          height: 170,
          fit: 'cover'
        }).toBuffer();

      const out = sharp({ create: { width: 800, height: 800, channels: 4, background: [0,0,0,0] } });
      out.composite([
        {
          input: img,
          left: 396,
          top: 349
        },
        {
          input: await orb.toBuffer(),
          left: 0,
          top: 0
        }
      ]);

      return this.sendReply(
        message,
        new BotBase.Discord.Attachment(
          await out.png().toBuffer(),
          `ponder_${Misc.unixTimestamp()}.jpg`
        )
      );
    }
  };
