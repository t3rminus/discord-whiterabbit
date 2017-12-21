'use strict';

const Schedule = require('node-schedule'),
	Bluebird = require('bluebird'),
	Mix = require('mixwith').mix,
	BotBase = require('./bot-base'),
	DiceMixin = require('../mixins/dice-mixin'),
	TimezoneMixin = require('../mixins/timezone-mixin'),
	DnDSpellMixin = require('../mixins/dndspell-mixin'),
	CharacterMixin = require('../mixins/character-mixin'),
	ResponseMixin = require('../mixins/response-mixin'),
	ModMixin = require('../mixins/mod-mixin');


class WhiteRabbit extends Mix(BotBase)
	.with(DiceMixin,TimezoneMixin,DnDSpellMixin,
		CharacterMixin,ResponseMixin,ModMixin) {
	
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
			parseParams: false,
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
		
		this.phrases['phrase__jabberwocky'] = 'Callooh! Callay!';
		Schedule.scheduleJob('1 0 1 12,1 *', () => { this.setAvatar.call(this) });
	}
	
	setAvatar() {
		if(new Date().getMonth() === 11) {
			return this.bot.user.setAvatar('./whiterabbit_holiday.jpg');
		} else {
			return this.bot.user.setAvatar('./whiterabbit.jpg');
		}
	}
	
	botReady() {
		// Track ready functions
		const readyTracker = [];
		
		// Set status message for help
		readyTracker.push(this.bot.user.setGame('?whiterabbit for help'));
		
		// If we're doing production stuff
		if(process.env.NODE_ENV !== 'dev') {
			// Update the avatar
			readyTracker.push(this.setAvatar());
			
			// Loop through all servers (guilds) the bot is on, and set the nickname.
			this.bot.guilds.forEach((guild) => {
				readyTracker.push(Bluebird.try(() => {
					const member = guild.members.get(this.bot.user.id);
					if(member) {
						return member.setNickname('White Rabbit');
					}
				}));
			});
		}
		
		// Track all of these tasks
		Bluebird.all(readyTracker)
		.then(() => {
			// Ready if we're ready
			console.log('Logged & ready in as %s - %s\n', this.bot.user.username, this.bot.user.id);
		})
		.catch((err) => {
			// Alert if we fail. It's possible
			console.log('Error on ready', err);
		});
	}
	
	phrase__jabberwocky(message) {
		const jabberwocky = [
			'`Twas brillig, and the slithy toves\n  Did gyre and gimble in the wabe:\nAll mimsy were the borogoves,\n  And the mome raths outgrabe.',
			'"Beware the Jabberwock, my son!\n  The jaws that bite, the claws that catch!\nBeware the Jubjub bird, and shun\n  The frumious Bandersnatch!"',
			'He took his vorpal sword in hand:\n  Long time the manxome foe he sought --\nSo rested he by the Tumtum tree,\n  And stood awhile in thought.',
			'And, as in uffish thought he stood,\n  The Jabberwock, with eyes of flame,\nCame whiffling through the tulgey wood,\n  And burbled as it came!',
			'One, two! One, two! And through and through\n  The vorpal blade went snicker-snack!\nHe left it dead, and with its head\n\  He went galumphing back.',
			'"And, has thou slain the Jabberwock?\n  Come to my arms, my beamish boy!\nO frabjous day! Callooh! Callay!"\n  He chortled in his joy.'
		];
		
		return this.getSetting(message.member, '-jabberwocky')
		.then((result) => {
			result = result || 0;
			return this.saveSetting(message.member, '-jabberwocky', (result + 1) % jabberwocky.length, true)
			.then(() => {
				message.channel.send(jabberwocky[result]);
			});
		});
	}
	
	command__whiterabbit(params, message) {
		return super.displayHelp(message, 'Oh dear! Oh dear! I shall be too late!', null, 'I have instructed you privately on the tasks you may ask of me.');
	}
	
	command__whiterabbitcfg(params, message) {
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