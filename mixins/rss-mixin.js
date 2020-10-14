const Misc = require('../lib/misc');
const pr = require('request-promise-native');
const Schedule = require('node-schedule');
const FastFeed = require('fast-feed');

module.exports = (BotBase) =>
  class CatMixin extends BotBase {
    constructor () {
      super();

      this.commands.rssadd = {
        helpText: 'Monitor an RSS feed and post updates in a particular channel (updates hourly)',
        args: ['channel', 'url'],
        method: 'command_rssadd',
        adminOnly: true,
        sort: 4000
      };

      this.commands.rsslist = {
        helpText: 'Lists monitored RSS feeds',
        method: 'command_rsslist',
        adminOnly: true,
        sort: 4001
      };

      this.commands.rssdelete = {
        helpText: 'Remove an RSS feed from the list of monitored feeds',
        args: ['url'],
        method: 'command_rssdelete',
        adminOnly: true,
        sort: 4002
      };

      Schedule.scheduleJob('0 * * * *', this.doRSS.bind(this));
    }

    async command_rssadd ([channelName, url], message) {
      if (!(await this.isAdmin(message))) {
        return this.fail(message);
      }

      if (!channelName || !url) {
        throw new Error('Unknown number of parameters');
      }

      let feedURL;
      try {
        feedURL = new URL(url);
      } catch (err) { /* ignore */ }
      if (!feedURL || !feedURL.hostname || !feedURL.pathname) {
        return this.sendReply(message, 'That URL did not seem to be valid.');
      }

      const settings = await this.getServerSettings(message);
      settings.rss = settings.rss || [];

      let channel, channelMatch;
      if (channelMatch = /<#([0-9]+)>/.exec(channelName)) {
        channel = message.guild.channels.get(channelMatch[1]);
      } else {
        channelName = channelName.trim().replace(/^#/, '');
        channel = message.guild.channels.find((c) => c.name === channelName);
      }

      if (!channel) {
        return this.sendReply(message, 'I couldn\'t find a channel with that name.');
      }

      const existing = settings.rss.findIndex(r => r.url === url);
      if (existing >= 0) {
        settings.rss[existing].channel = channel.id;
        await this.saveServerSettings(message, settings, true);
        // Send the message
        return this.sendReply(message, `I already found an RSS feed with that URL. I've set the channel to #${channel.name}`);
      } else {
        settings.rss.push({
          channel: channel.id,
          url,
          lastChecked: new Date()
        });

        await this.saveServerSettings(message, settings, true);
        // Send the message
        return this.sendReply(message, `Great. I'll keep an eye on that feed, and post updates in #${channel.name}`);
      }
    }

    async command_rsslist (params, message) {
      if (!(await this.isAdmin(message))) {
        return this.fail(message);
      }

      const { rss = [] } = await this.getServerSettings(message);

      if (!rss.length) {
        return this.sendReply(message, 'There are no RSS feeds configured on this server.');
      }

      const feedsByChannel = Misc.indexBy(rss, 'channel');

      const result = Object.keys(feedsByChannel).map((channelId) => {
        const channel = message.guild.channels.get(channelId);
        const feeds = feedsByChannel[channelId].map(f => ` - ${f.url}\n`).join('');
        if (channel) {
          return `\`\`\` #${channel.name}\n${feeds}\`\`\``;
        } else {
          return `\`\`\` (deleted channel)\n${feeds}\`\`\``;
        }
      });

      return this.sendReply(message, result.join('\n'));
    }

    async command_rssdelete ([url], message) {
      if (!(await this.isAdmin(message))) {
        return this.fail(message);
      }

      const settings = await this.getServerSettings(message);

      if (!settings.rss || !settings.rss.length) {
        return this.sendReply(message, 'There are no RSS feeds configured on this server.');
      }

      const index = settings.rss.findIndex(f => f.url === url);
      if (index === -1) {
        return this.sendReply(message, 'I couldn\'t find a feed with that URL.');
      }

      settings.rss.splice(index, 1);

      await this.saveServerSettings(message, settings, true);
      return this.sendReply(message, 'Okay, I\'ll stop monitoring that feed.');
    }

    async doRSS () {
      for (const [, guild] of this.bot.guilds) {
        if (guild.available) {
          const settings = await this.getServerSettings({ guild });

          if (settings.rss && settings.rss.length) {
            await this.checkFeeds(settings.rss, guild); // Will update lastChecked
            await this.saveServerSettings({ guild }, settings, true); // Save updated lastChecked
          }
        }
      }
    }

    async checkFeeds (feeds, guild) {
      for (const feedInfo of feeds) {
        feedInfo.lastChecked = new Date(feedInfo.lastChecked);
        if (!feedInfo.lastChecked) {
          feedInfo.lastChecked = new Date();
          continue;
        }

        const channel = guild.channels.get(feedInfo.channel);
        if (!channel) {
          continue;
        }

        let feed;
        try {
          const xml = await pr(feedInfo.url);
          feed = FastFeed.parse(xml);
          if (!feed.type) {
            console.log(`Error parsing feed ${feedInfo.url}`, feed);
            continue;
          }
        } catch (err) {
          console.log(`Error loading feed ${feedInfo.url}`, err);
          continue;
        }

        const newItems = feed.items.filter(item => item.date > feedInfo.lastChecked);
        for (const newItem of newItems) {
          try {
            if (feed.title) {
              await channel.send(`New post from ${feed.title}!\n${newItem.link}`);
            } else {
              // URL has already been validated upon adding
              const feedURL = new URL(feedInfo.url);
              await channel.send(`New post from ${feedURL.hostname}!\n${newItem.link}`);
            }
            await new Promise((r) => setTimeout(r, 1000));
          } catch (err) {
            console.log(`Unable to send message to channel ${channel.name}`);
          }
        }

        feedInfo.lastChecked = new Date();
      }
    }
  };
