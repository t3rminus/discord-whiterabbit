'use strict';

const Mix = require('mixwith').mix,
	BotBase = require('./bot-base'),
	DiceMixin = require('../mixins/dice-mixin'),
	TimezoneMixin = require('../mixins/timezone-mixin'),
	DnDSpellMixin = require('../mixins/dndspell-mixin');


class WhiteRabbit extends Mix(BotBase).with(DiceMixin,TimezoneMixin,DnDSpellMixin) {
	constructor() {
		super();
		
		this.commands['whiterabbit'] = {
			helpText: 'Ask me for help!',
			method: 'command__whiterabbit',
			ignorePrefix: true,
			sort: 1
		};
		
		this.commands['whiterabbitcfg'] = {
			helpText: 'Set configuration values.',
			args: ['setting','value'],
			method: 'command__whiterabbitcfg',
			ignorePrefix: true,
			adminOnly: true,
			sort: 2
		};
		
		this.commands['whiterabbitcfgdump'] = {
			helpText: 'Dump all configuration values.',
			method: 'command__whiterabbitcfgdump',
			ignorePrefix: true,
			adminOnly: true,
			sort: 3
		};
	}
	
	command__whiterabbit(params, message) {
		return super.displayHelp(message, 'Oh dear! Oh dear! I shall be too late!');
	}
	
	command__whiterabbitcfg(params, message) {
		params = params['_'];
		return this.setConfig(params, message)
		.then(result => {
			let output;
			if(result.modified) {
				if(Array.isArray(result.value)) {
					output = `I’ll keep track of the following list for \`${result.key}\`:`;
					result.value.forEach((value) => {
						output += `\n\n • ${value}`;
					});
				} else if(result.value === null) {
					output = `\`${result.key}\` has been reset back to default.`;
				} else {
					output = `I’ll try and remember that \`${result.key}\` is ${result.value}.`;
				}
			} else {
				if(Array.isArray(result.value)) {
					output = `I think that \`${result.key}\` has the following:`;
					result.value.forEach((value) => {
						output += `\n\n • ${value}`;
					});
				} else if(result.value === null) {
					output = `\`${result.key}\` has been reset back to default.`;
				} else {
					output = `I’m pretty sure \`${result.key}\` is ${result.value}`;
				}
			}
			return output;
		})
		.catch(BotBase.BadArgumentError, (err) => {
			return `So sorry, but I’m afraid I don’t know what you mean by that.`;
		})
		.catch(BotBase.NotFoundError, (err) => {
			return `Oh dear, I couldn’t find an item like that.`;
		})
		.catch(BotBase.BadCommandError, (err) => {
			return this.fail(message);
		})
		.catch(BotBase.UnauthorizedError, (err) => {
			return null; // Do nothing if they aren't admin
		})
		.then((output) => {
			if(output) {
				message.channel.send(output);
			}
		});
	}
	
	command__whiterabbitcfgdump(params, message) {
		return this.isAdmin(message)
		.then(() => true, () => false)
		.then((isAdmin) => {
			if(isAdmin) {
				return this.getServerSettings(message)
				.then(settings => {
					const cfgDump = JSON.stringify(settings, null, 4);
					const output = `Psst! Here’s the configuration for ${message.guild.name}:` +
						`\`\`\`\n${cfgDump}\n\`\`\``;
					message.author.send(output);
				});
			}
		});
	}
}

module.exports = WhiteRabbit;