'use strict';

const Schedule = require('node-schedule');
const CalendarChinese = require('date-chinese').CalendarChinese;
const Mix = require('mixwith').mix;
const BotBase = require('./bot-base');
const DiceMixin = require('../mixins/dice-mixin');
const TimezoneMixin = require('../mixins/timezone-mixin');
const DnDSpellMixin = require('../mixins/dndspell-mixin');
const CharacterMixin = require('../mixins/character-mixin');
const ResponseMixin = require('../mixins/response-mixin');
const ModMixin = require('../mixins/mod-mixin');
const CatMixin = require('../mixins/cat-mixin');
const LocationMixin = require('../mixins/location-mixin');
const RSSMixin = require('../mixins/rss-mixin');
const BegoneMixin = require('../mixins/begone-mixin');
const PonderMixin = require('../mixins/ponder-mixin');

const icons = [
  {
    range: (year) => {
      const cal = new CalendarChinese();
      cal.fromJDE(cal.newYear(year));
      const lny = cal.toGregorian();
      return [new Date(lny.year, lny.month - 1, lny.day - 8, -12), new Date(lny.year, lny.month - 1, lny.day, 35, 59, 59)];
    },
    image: 'lunar_new_year.png'
  },
  {
    range: (year) => {
      return [new Date(year, 1, 14), new Date(year, 1, 14, 23, 59, 59)];
    },
    image: 'valentines.png'
  },
  {
    range: (year) => {
      return [new Date(year, 2, 17, -12), new Date(year, 2, 17, 35, 59, 59)];
    },
    image: 'st_patricks.png',
    name: 'Coinín Bán'
  },
  {
    range: (year) => {
      return [new Date(year, 6, 1, -12), new Date(year, 6, 1, 35, 59, 59)];
    },
    image: 'canada.png',
    name: 'White Rabbit, eh?'
  },
  {
    range: (year) => {
      return [new Date(year, 6, 4, -12), new Date(year, 6, 4, 35, 59, 59)];
    },
    image: 'usa.png',
    name: 'Red, White & Blue Rabbit'
  },
  {
    range: (year) => {
      return [new Date(year, 9, 15, -12), new Date(year, 10, 1, 35)];
    },
    image: 'halloween.png',
    name: 'Fright Rabbit'
  },
  {
    range: (year) => {
      return [new Date(year, 11, 1, -12), new Date(year, 11, 31, 35, 59, 59)];
    },
    image: 'holiday.png'
  }
];

class WhiteRabbit extends Mix(BotBase).with(
  DiceMixin,
  TimezoneMixin,
  DnDSpellMixin,
  CharacterMixin,
  ResponseMixin,
  ModMixin,
  CatMixin,
  LocationMixin,
  RSSMixin,
  BegoneMixin,
  PonderMixin
) {
  constructor() {
    super();

    this.commands.whiterabbit = {
      helpShortcut: true,
      helpText: 'Ask me for help!',
      method: 'command__whiterabbit',
      ignorePrefix: true,
      sort: 1
    };

    this.commands.format = {
      helpText:
        'Decide your format for certain things. For example {prefix}format 24h to use 24h time.',
      args: ['12h/24h/metric/imperial'],
      method: 'command__format',
      sort: 5
    };

    this.commands.cfg = {
      helpText: 'Set configuration values.',
      args: ['setting', 'value'],
      method: 'command__whiterabbitcfg',
      ignorePrefix: true,
      adminOnly: true,
      sort: 2
    };

    this.commands.cfgdump = {
      helpText: 'Dump all configuration values.',
      method: 'command__whiterabbitcfgdump',
      ignorePrefix: true,
      adminOnly: true,
      sort: 3
    };

    this.commands.refresh = {
      helpText: 'Clear caches, etc.',
      method: 'command_refresh',
      ignorePrefix: true,
      adminOnly: true,
      sort: 4
    };

    this.phrases.phrase__jabberwocky = 'Callooh! Callay!';

    this.scheduledYears = {};
  }

  async scheduleEvents() {
    const date = new Date();
    const year = date.getFullYear();

    // Prevent double-tracking scheduled events
    if (this.scheduledYears[year] !== undefined) {
      return;
    }
    this.scheduledYears[year] = 0;

    let curIcon = null;
    icons.forEach((icon) => {
      const range = icon.range(year);
      if (date > range[0] && date < range[1]) {
        curIcon = icon;
      }
      Schedule.scheduleJob(range[0], this.setAvatar.bind(this, icon, true));
      Schedule.scheduleJob(range[1], this.setAvatar.bind(this, icon, false));
      this.scheduledYears[year] += 2;
    });

    console.log(`Scheduled ${this.scheduledYears[year]} events.`);

    await this.setAvatar(curIcon, true);
  }

  async setAvatar(icon, eventStart) {
    icon = icon || {};
    let image = './avatars/default.png';

    if (icon.image && eventStart) {
      image = `./avatars/${icon.image}`;
    }

    if (process.env && process.env.NODE_ENV !== 'dev') {
      console.log(`Setting avatar to ${image}`);
      try {
        await this.bot.user.setAvatar(image);
      } catch (err) {
        console.error(err.message);
      }
    } else if (process.env && process.env.NODE_ENV === 'dev') {
      console.log(`DEV MODE: Not setting avatar to ${image}`);
    }

    return this.setName(icon.name, eventStart);
  }

  async setName(name = null, eventStart) {
    const dev = process.env && process.env.NODE_ENV === 'dev';
    const finalName = `${dev ? 'DEV ' : ''}${name}`;

    for (const [, guild] of this.bot.guilds) {
      if (guild.available) {
        const member = guild.members.get(this.bot.user.id);
        if (name !== null && member.nickname === null && eventStart) {
          await member.setNickname(finalName).catch(() => {
            /* ignore error */
          });
        } else if (finalName === member.nickname && !eventStart) {
          await member.setNickname(null).catch(() => {
            /* ignore error */
          });
        }
      }
    }
  }

  async botReady() {
    try {
      // Set status message for help
      await this.bot.user.setActivity('?whiterabbit for help');
      Schedule.scheduleJob('1 0 0 1 1 *', this.scheduleEvents.bind(this));
      await this.scheduleEvents();

      // Ready if we're ready
      console.log(
        `Logged & ready in as ${this.bot.user.username} - ${this.bot.user.id}`
      );
    } catch (err) {
      // Alert if we fail. It's possible
      console.log('Error on ready', err);
    }
  }

  async phrase__jabberwocky(message) {
    const jabberwocky = [
      '`Twas brillig, and the slithy toves\n  Did gyre and gimble in the wabe:\nAll mimsy were the borogoves,\n  And the mome raths outgrabe.',
      '"Beware the Jabberwock, my son!\n  The jaws that bite, the claws that catch!\nBeware the Jubjub bird, and shun\n  The frumious Bandersnatch!"',
      'He took his vorpal sword in hand:\n  Long time the manxome foe he sought --\nSo rested he by the Tumtum tree,\n  And stood awhile in thought.',
      'And, as in uffish thought he stood,\n  The Jabberwock, with eyes of flame,\nCame whiffling through the tulgey wood,\n  And burbled as it came!',
      'One, two! One, two! And through and through\n  The vorpal blade went snicker-snack!\nHe left it dead, and with its head\n  He went galumphing back.',
      '"And, has thou slain the Jabberwock?\n  Come to my arms, my beamish boy!\nO frabjous day! Callooh! Callay!"\n  He chortled in his joy.'
    ];

    const phrase = (await this.getSetting(message.member, '-jabberwocky')) || 0;
    await this.saveSetting(
      message.member,
      '-jabberwocky',
      (phrase + 1) % jabberwocky.length,
      true
    );
    return this.sendReply(message, jabberwocky[phrase]);
  }

  command__whiterabbit(params, message) {
    return super.displayHelp(
      message,
      'Oh dear! Oh dear! I shall be too late!',
      null,
      'I have instructed you privately on the tasks you may ask of me.'
    );
  }

  async command__whiterabbitcfg(params, message) {
    let output;
    const actions = ['add', 'remove', 'show', 'list', 'reset', 'set'];
    let action, key, value;
    if (params[1] && actions.includes(params[1])) {
      action = params[1];
      key = params[0];
      value = params[2];
    } else {
      key = params[0];
      value = params[1];
    }

    if (!(await this.isAdmin(message))) {
      return;
    }

    try {
      const result = await this.setConfigValue(message, key, value, action);

      if (result.modified) {
        if (Array.isArray(result.value)) {
          output = `I’ll keep track of the following list for \`${result.key}\`:`;
          if (result.value.length) {
            result.value.forEach((value) => {
              output += `\n\n • ${value}`;
            });
          } else {
            output += '\n\n [empty list]';
          }
        } else if (result.value === null) {
          output = `\`${result.key}\` has been reset back to default.`;
        } else {
          output = `I’ll try and remember that \`${result.key}\` is ${result.value}.`;
        }
      } else {
        if (Array.isArray(result.value)) {
          output = `I think that \`${result.key}\` has the following:`;
          result.value.forEach((value) => {
            output += `\n\n • ${value}`;
          });
        } else if (result.value === null) {
          output = `\`${result.key}\` has been reset back to default.`;
        } else {
          output = `I’m pretty sure \`${result.key}\` is ${result.value}`;
        }
      }
    } catch (err) {
      if (err instanceof BotBase.BadArgumentError) {
        output = 'So sorry, but I’m afraid I don’t know what you mean by that.';
      } else if (err instanceof BotBase.NotFoundError) {
        output = 'Oh dear, I couldn’t find an item like that.';
      } else if (err instanceof BotBase.BadCommandError) {
        return this.fail(message);
      } else if (!(err instanceof BotBase.UnauthorizedError)) {
        throw err;
      }
    }

    if (output) {
      this.sendReply(message, output);
    }
  }

  async command__format(params, message) {
    const userSetting = (await this.getSetting(message.member, true)) || {};
    let resultMessage = '';
    if (!params || !params[0]) {
      return this.fail();
    }
    const setting = `${params[0]}`.trim().toLowerCase();
    switch (setting) {
      case '12h':
        userSetting.timeFormat = '12h';
        resultMessage = "Got it. I'll display your time in 12-hour format";
        break;
      case '24h':
        userSetting.timeFormat = '24h';
        resultMessage = "Got it. I'll display your time in 24-hour format";
        break;
      case 'metric':
        userSetting.units = 'metric';
        resultMessage = "Got it. I'll use metric units for measurements";
        break;
      case 'imperial':
      case 'us':
      case 'english':
        userSetting.units = 'imperial';
        resultMessage = "Got it. I'll use imperial units for measurements";
        break;
      default:
        return this.fail(message);
    }
    await this.saveSetting(message.member, true, userSetting, true);
    return this.sendReply(message, resultMessage);
  }

  async command__whiterabbitcfgdump(params, message) {
    if (await this.isAdmin(message)) {
      const settings = await this.getServerSettings(message);

      const cfgDump = JSON.stringify(settings, null, 4);
      const filename = `${message.guild.name
        .toLowerCase()
        .replace(/[^a-z]/g, '-')}_config.json`;
      const attachment = new BotBase.Discord.Attachment(
        Buffer.from(cfgDump, 'utf8'),
        filename
      );
      message.author.send(
        `Psst! Here’s the configuration for ${message.guild.name}`,
        attachment
      );
    }
  }

  async command_refresh(params, message) {
    if (await this.isAdmin(message)) {
      const key = BotBase.getDataKey(message.member, '-settings');
      delete this.settingsCache[key];
      return message.channel.send('Ahh! How refreshing!');
    }
  }
}

module.exports = WhiteRabbit;
