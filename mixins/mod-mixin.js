'use strict';
const Misc = require('../lib/misc');

module.exports = (BotBase) =>
  class ModMixin extends BotBase {
    constructor () {
      super();

      this.commands.behead = {
        helpText: 'Off with his head! Delete # messages.',
        args: ['#'],
        method: 'command__behead',
        adminOnly: true,
        sort: 7
      };

      this.commands.allowrole = {
        helpText: 'Allow users to assign themselves one or more from a group of roles. Generated command takes the format {prefix}group role',
        args: ['group', 'role', '(...role)', '(--single (true|false)'],
        method: 'command__allowrole',
        adminOnly: true,
        sort: 6
      };

      this.commands.listmembers = {
        helpText: 'Lists all members on the server',
        args: [],
        method: 'command__listmembers',
        adminOnly: true,
        sort: 8
      };

      this.commands.togglelog = {
        helpText: 'Toggle logging of all messages',
        args: [],
        method: 'command__toggleloggle',
        adminOnly: true,
        sort: 9
      };

      this.commands.roleinfo = {
        helpText: 'Dispaly information about all roles',
        args: [],
        method: 'command__roleinfo',
        adminOnly: true,
        sort: 10
      };

      this.addHandler(this.msg_rolecheck);
      this.addHelpGenerator(this.rolecheck_help);
    }

    async command__behead (params, message) {
      if (!(await this.isAdmin(message))) {
        return;
      }

      if (params.length !== 1) {
        return this.fail(message);
      }
      const count = parseInt(params[0]);
      if (isNaN(count)) {
        return this.fail(message);
      }

      if (count > 20) {
        return message.channel.send('Oh my! That seems like an awful lot of messages. I don’t think I can handle more than 20 at a time.');
      }
      if (count < 1) {
        return message.channel.send('Well, I can try, but there wouldn’t be much point, now would there?');
      }

      try {
        return message.channel.bulkDelete(count + 1);
      } catch (err) {
        return message.channel.send('How dreadful! I wasn’t permitted to behead any messages. You may need to invite me again!');
      }
    }

    async command__allowrole (params, message) {
      if (!(await this.isAdmin(message))) {
        return;
      }
      const settings = await this.getServerSettings(message);
      const prefix = settings.prefix || this.defaultSettings.prefix;
      settings.allowroles = settings.allowroles || {};

      const group = params.shift().toLowerCase();
      let method, value;
      if (['add', 'remove', 'list', 'show', 'set', 'reset'].includes(params[0])) {
        method = params.shift();
        value = params;
      } else if (params.length) {
        method = 'set';
        value = params;
      } else {
        method = 'show';
      }

      settings.allowroles[group] = settings.allowroles[group] || { list: [], single: false };

      if (params.flags && params.flags.single) {
        settings.allowroles[group].single = params.flags.single !== 'false';
      }

      switch (method) {
        case 'add':
          settings.allowroles[group].list = settings.allowroles[group].list.concat(value);
          break;
        case 'remove':
          value.forEach(item => {
            const idx = settings.allowroles[group].list.indexOf(item);
            if (idx < 0) {
              throw new BotBase.NotFoundError();
            }
            settings.allowroles[group].list.splice(idx, 1);
          });
          break;
        case 'set':
          settings.allowroles[group].list = params;
          break;
        case 'reset':
          delete settings.allowroles[group];
          break;
      }

      if (['add', 'remove', 'set', 'reset'].includes(method)) {
        await this.saveServerSettings(message, settings, true);

        if (method === 'reset') {
          return this.sendReply(message, 'Okay. I won\'t let users assign themselves ' +
            `a role with ${prefix}${group}.`);
        } else {
          const list = settings.allowroles[group].list.map((value) => `\n • ${value}`).join('');
          const output = 'Okay. Users can select from the following roles ' +
            `with the \`${prefix}${group}\` command.\n${list}`;
          return this.sendReply(message, output);
        }
      } else {
        const list = settings.allowroles[group].list.map((value) => `\n • ${value}`).join('');
        const output = 'Users can select from the following roles ' +
          `with the \`${prefix}${group}\` command.\n${list}`;
        return this.sendReply(message, output);
      }
    }

    async msg_rolecheck (message) {
      if (!message.member || message.member.id === this.bot.user.id || message.author.bot) {
        return false;
      }

      const settings = await this.getServerSettings(message);
      let prefix = settings.prefix || this.defaultSettings.prefix;
      if (process.env.NODE_ENV === 'dev') {
        prefix = 'dev' + prefix;
      }
      const prefixRegEx = new RegExp(`^${Misc.escapeRegex(prefix)}`);
      if (prefixRegEx.test(message.content)) {
        const params = Misc.parseString(message.content.replace(prefixRegEx, ''), 1);
        if (!params.length) {
          return false;
        }
        const group = params.shift().toLowerCase();
        if (!settings.allowroles || !settings.allowroles[group]) {
          return false;
        }
        if (!params.length) {
          const list = settings.allowroles[group].list.map((value) => `\n • ${value}`).join('');
          await this.sendReply(message, `You can choose a \`${prefix}${group}\` from the ` +
            `following list:\n${list}`);

          return true;
        }

        const role = Misc.stringNormalize(params.shift());
        if (!role.length) {
          return false;
        }

        const roleRegex = new RegExp(`^${Misc.escapeRegex(role)}`);
        const matchingRole = settings.allowroles[group].list.find((item) => {
          return roleRegex.test(Misc.stringNormalize(item));
        });

        try {
          if (matchingRole) {
            const addRole = message.guild.roles.find((role) => role.name === matchingRole);
            if (addRole) {
              if (message.member.roles.find((role) => role.id === addRole.id)) {
                await message.member.removeRole(addRole);
                if (settings.allowroles[group].single) {
                  await this.sendReply(message, `Ok. I've removed ${addRole.name} as your ${group}`);
                } else {
                  await this.sendReply(message, `Ok. I've removed ${addRole.name} from your ${group} list`);
                }
              } else {
                if (settings.allowroles[group].single) {
                  const allRoles = settings.allowroles[group].list;
                  const removeRoles = message.guild.roles.filter((role) => allRoles.includes(role.name) && role !== addRole);
                  await message.member.removeRoles(removeRoles);
                }
                await message.member.addRole(addRole);
                if (settings.allowroles[group].single) {
                  await this.sendReply(message, `Ok. I've set your ${group} to ${addRole.name}`);
                } else {
                  await this.sendReply(message, `Ok. I've added ${addRole.name} to your ${group} list`);
                }
              }
              return true;
            }
          }
        } catch (err) {
          console.error(err);
        }
      }
      return false;
    }

    async rolecheck_help (message, orgHelp) {
      const settings = await this.getServerSettings(message);
      if (!settings.allowroles) {
        return orgHelp;
      }

      const groups = Object.keys(settings.allowroles);
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        orgHelp[group] = {
          helpText: `Set your preferred ${group}. Use \`{prefix}${group}\` to see available options.`,
          args: ['option'],
          sort: 1000 + i
        };
      }

      return orgHelp;
    }

    async command__listmembers (params, message) {
      if (!(await this.isAdmin(message))) {
        return;
      }

      const members = message.guild.members.map(({ user = {} } = {}) => {
        if (!user.bot) {
          return `${user.username}#${user.discriminator}`;
        }
      }).filter(u => u);

      const filename = `${message.guild.name.toLowerCase().replace(/[^a-z]/g, '-')}_members.txt`;
      const attachment = new BotBase.Discord.Attachment(Buffer.from(members.join('\n'), 'utf8'), filename);
      message.author.send(`Psst! Here’s the member list for ${message.guild.name}`, attachment);
    }

    async command__toggleloggle (params, message) {
      const settings = await this.getServerSettings(message);
      this.logall[message.guild.id] = !settings.logall;
      await this.saveServerSettings(message, { logall: !settings.logall });
      await this.sendReply(message, `Logging enabled: ${!settings.logall ? 'true' : 'false'}`);
    }

    async command__roleinfo (params, message) {
      if (!(await this.isAdmin(message))) {
        return;
      }

      const reply = [];
      for (const [, role] of message.guild.roles) {
        reply.push(`**${this.sanitize(role.name)}:**\n - Color: ${role.hexColor}\n - Members: ${role.members.size}\n - Position: ${role.calculatedPosition}\n - Mentionable: ${role.mentionable}`);
      }

      const filename = `${message.guild.name.toLowerCase().replace(/[^a-z]/g, '-')}_roles.txt`;
      const attachment = new BotBase.Discord.Attachment(Buffer.from(reply.join('\n'), 'utf8'), filename);
      message.author.send(`Psst! Here’s the role list for ${message.guild.name}:`, attachment);
    }
  };
