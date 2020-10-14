const Misc = require('../lib/misc');

module.exports = (BotBase) =>
  class LogMixin extends BotBase {
    constructor () {
      super();

      if (this.bot) {
        this.bot.on('messageDelete', this.handleDelete.bind(this));
        this.bot.on('messageDeleteBulk', this.handleDelete.bind(this));
      }
    }

    async handleDelete (message) {
      let singleMessage;
      if (message instanceof Map) {
        singleMessage = message.first();
      } else {
        singleMessage = message;
      }
      if (!singleMessage) {
        return;
      }

      const guild = singleMessage.guild;
      if (!guild.available) {
        return;
      }

      const serverSettings = await this.getServerSettings(singleMessage);

      let messages;
      if (message instanceof Map) {
        messages = message.array();
      } else {
        messages = [message];
      }

      if (serverSettings.log_channel) {
        const logChannel = guild.channels.find('name', serverSettings.log_channel);
        if (logChannel && logChannel.type === 'text') {
          for (const message of messages) {
            if (message.content.length > 1000) {
              const part1 = `**[δ] Channel:** <#${message.channel.id}> — **${message.author.tag}**` +
                ` deleted:\n${message.content.substr(0, 1000)}`;
              const part2 = `_ _\n${message.content.substr(1000)}`;
              await logChannel.send(part1);
              await logChannel.send(part2);
              await Misc.delay(100);
            } else {
              const logMessage = `**[δ] Channel:** <#${message.channel.id}> — **${message.author.tag}**` +
                ` deleted:\n${message.content}`;
              await logChannel.send(logMessage);
              await Misc.delay(100);
            }
          }
        }
      }
    }
  };
