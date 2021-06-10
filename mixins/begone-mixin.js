const Misc = require('../lib/misc');

module.exports = (BotBase) =>
  class LogMixin extends BotBase {
    constructor () {
      super();

      this.commands.begone = {
        helpText: 'USE EXTREME CAUTION! Instantly banish bad bots that follow a specific username pattern (regular expression), and optionally ban them. Pass \'delete\' to remove the banishment, and allow new members to join. NOTE: Deleting an entry will not unban already banned members.',
        args: ['name pattern', 'delete', '(--ban)'],
        method: 'command__begone',
        adminOnly: true,
        sort: 99999
      };

      if (this.bot) {
        this.bot.on('guildMemberAdd', this.handleJoinBegone.bind(this));
      }
    }

    async command__begone (params, message) {
      if (!(await this.isAdmin(message))) {
        return this.fail(message);
      }
      const settings = await this.getServerSettings(message);

      settings.begones = settings.begones || [];
      const begoneThot = params[0];

      const existingIndex = settings.begones.findIndex((i) => i.pattern === begoneThot);
      if (params.length > 1 && params[1] === 'delete') {
        if (existingIndex > -1) {
          settings.begones.splice(existingIndex, 1);
          await this.saveServerSettings(message, settings, true);
          return message.channel.send(`I've rescinded "${begoneThot}"'s banishment`);
        } else {
          return message.channel.send(`I couldn't find a match for "${begoneThot}"`);
        }
      }

      if (existingIndex > -1) {
        return message.channel.send(`"${begoneThot}" is already banished.`);
      }

      const item = {
        pattern: begoneThot,
        ban: params.flags && params.flags.ban
      };

      settings.begones.push(item);
      await this.saveServerSettings(message, settings, true);

      if(params.ban) {
        return message.channel.send(`"${begoneThot}" has been banished forever.`);
      } else {
        return message.channel.send(`"${begoneThot}" has been banished.`);
      }
    }

    async handleJoinBegone (member) {
      // Stupid way of ensuring this happens after other stuff.
      setTimeout(async () => {
        const guild = member.guild;
        const serverSettings = await this.getServerSettings(member);

        let begone = false;
        if(serverSettings.begones) {
          begone = serverSettings.begones.find(begone => (new RegExp(begone.pattern)).test(member.user.username.toLowerCase()));
        }

        if(begone && begone.ban) {
          member.ban({ days: 1, reason: 'Your username is not permitted on this server.' });
          // member.kick('Your username is not permitted on this server.');
        } else if(begone) {
          member.kick('Your username is not permitted on this server.');
        }

        const sysChannel = member.guild.systemChannel;
        const messages = await sysChannel.fetchMessages({ limit: 10 });
        const joinMessages = messages.filter(m => m.system && m.type === 'GUILD_MEMBER_JOIN');
        for(const [,message] of joinMessages) {
          if(begone && message.author.id === member.id) {
            try {
              await message.delete();
            } catch(err) { /* ignore */ }
          }
        }
      }, 100);
    }
  };
