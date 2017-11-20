'use strict';

const Bluebird = require('bluebird'),
	Discord = require('discord.js'),
	Redis = require('ioredis'),
	FuzzyMatching = require('fuzzy-matching'),
	ParseCommand = require('minimist-string'),
	Misc = require('./misc');

const isFunction = (functionToCheck) =>
	functionToCheck && Object.prototype.toString.call(functionToCheck) === '[object Function]';

class BadCommandError extends Error {
	constructor(...args) { super(...args); Error.captureStackTrace(this, BadCommandError); }
}
class BadArgumentError extends Error {
	constructor(...args) { super(...args); Error.captureStackTrace(this, BadArgumentError); }
}
class NotFoundError extends Error {
	constructor(...args) { super(...args); Error.captureStackTrace(this, NotFoundError); }
}
class UnauthorizedError extends Error {
	constructor(...args) { super(...args); Error.captureStackTrace(this, UnauthorizedError); }
}

class BotBase {
	constructor() {
		// For mixin use
		this.Discord = Discord;
		
		// Properties
		this.bot = new Discord.Client();
		this.db = new Redis(process.env.REDIS_URL);
		this.settingsCache = {};
		
		this.commands = {};
		
		this.defaultSettings = {
			prefix: '?'
		};
		
		this.settingTypes = {
			prefix: 'string',
			admin_group: 'array',
			fail_messages: 'array',
			welcome_message: 'string'
		};
		
		this.init();
		
		// Log errors
		this.bot.on('error', (err) => console.error(err));
		
		// Start the bot!
		this.bot.login(process.env.DISCORD_TOKEN);
	}
	
	init() {
		/*
		this.phrases = {
			'phrase__jabberwocky': 'Callooh! Callay!'
			// TODO: Detect time, and convert to others
		}; */
		
		this.bot.on('message', this.handleMessage.bind(this));
		this.bot.on('ready', this.botReady.bind(this));
	}
	
	getServerSettings(message) {
		const key = BotBase.getDataKey(message.member, '-settings');
		if(!this.settingsCache[key]) {
			this.settingsCache[key] = this.getSetting(message.member, '-settings')
			.then((settings) => {
				settings = settings || {};
				Object.keys(settings).forEach((key) => {
					if(settings[key] === null) {
						delete settings[key];
					}
				});
				
				return Object.assign({}, this.defaultSettings, settings);
			});
		}
		
		return this.settingsCache[key];
	}
	
	saveServerSettings(message, newSettings, overwrite) {
		const key = BotBase.getDataKey(message.member, '-settings');
		return (this.settingsCache[key] = this.saveSetting(message.member, '-settings', newSettings, overwrite));
	}
	
	handleMessage(message) {
		this.getServerSettings(message)
		.then((settings) => {
			let handled = false;
			const commands = Object.keys(this.commands);
			
			commands.forEach((command) => {
				const commandInfo = this.commands[command];
				const prefix = commandInfo.ignorePrefix ? '?' : settings.prefix;
				
				// Match command at beginning of message
				const matchCmd = new RegExp(`^${Misc.escapeRegex(prefix + command)}( |$)`);
				if(matchCmd.test(message.content)) {
					if(commandInfo.method && isFunction(this[commandInfo.method])) {
						// Parse the command
						let params;
						if(commandInfo.parseParams === false) {
							params = message.content.replace(matchCmd, '');
						} else {
							params = ParseCommand(message.content.replace(matchCmd, ''));
						}
						
						// Execute the command
						const result = this[commandInfo.method](params, message);
						handled = true;
						
						// If the returned value is promise-like
						// handle any errors to prevent uncaught promises
						if(result && result.catch) {
							result.catch((err) => {
								console.error(err);
								return this.fail(message);
							});
						}
					}
				}
			});
			/*
			if(!handled) {
				Object.keys(this.phrases).forEach((method) => {
					const match = this.phrases[method];
					if(match && this[method]) {
						if(Misc.isString(match) && message.content.indexOf(match) >= 0) {
							this[method](message);
						} else if(match.test && match.test(message.content)) {
							this[method](message);
						}
					}
				});
			} */
		});
	}
	
	displayHelp(message, prefix, postfix) {
		return Bluebird.join(this.isAdmin(message).then(() => true, () => false),
			this.getServerSettings(message),
			(isAdmin, settings) => {
				let commands = Object.keys(this.commands);
				commands = commands.sort((a,b) => {
					if(this.commands[a].sort && this.commands[b].sort) {
						return this.commands[a].sort - this.commands[b].sort;
					} else if(this.commands[a].sort) {
						return -1;
					} else if(this.commands[b].sort) {
						return 1;
					} else {
						return a.localeCompare(b);
					}
				});
				
				let reply = '';
				if(prefix) {
					reply += `${prefix}\n\n`;
				}
				
				commands.forEach(commandName => {
					const command = this.commands[commandName];
					if(!command.adminOnly || isAdmin) {
						let name = command.ignorePrefix ? `?${commandName}` : `${settings.prefix + commandName}`;
						
						reply += `• \`${name}\` `;
						
						if(command.args) {
							reply += command.args.map(a => `\`${a}\``).join(' ');
						}
						
						if(command.helpText) {
							let helpText;
							if(command.ignorePrefix) {
								helpText = command.helpText.replace(/{prefix}/g, '?');
							} else {
								helpText = command.helpText.replace(/{prefix}/g, settings.prefix);
							}
							
							reply += `\n\t${helpText}\n⁣\n`;
						}
					}
				});
				
				if(postfix) {
					reply += postfix;
				}
				
				return message.channel.send(reply);
			});
	}
	
	botReady() {
		// Track ready functions
		const readyTracker = [];
		
		// Set status message for help
		readyTracker.push(this.bot.user.setGame('?whiterabbit for help'));
		
		// If we're doing production stuff
		if(process.env.NODE_ENV !== 'dev') {
			// Update the avater
			readyTracker.push(this.bot.user.setAvatar('./whiterabbit.jpg'));
			
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
	
	setConfig(params, message) {
		params = params.trim();
		const commands = /^(\w+)\s+((?:(?:set|reset|show|list|add|remove)\s*)?)(.*)/.exec(params);
		if(!commands || !commands.length) {
			throw new BadCommandError();
		}
		let key = commands[1].trim();
		let method = commands[2].trim();
		let value = commands[3].trim();
		if(value === '') {
			value = null;
		}
		if(method === '') {
			if(value) {
				method = 'set';
			} else {
				method = 'show';
			}
		}
		
		
		return this.isAdmin(message)
		// Ignore permissions errors.
		.then(() => true, false)
		.then((isAdmin) => {
			if(!isAdmin) {
				throw new UnauthorizedError();
			}
			
			const result = {
				modified: false,
				method: method,
				key: key,
				value: value
			};
			
			if(!this.settingTypes[key]) {
				const e = new BadArgumentError();
				e.result = result;
				throw e;
			}
			
			return this.getServerSettings(message)
				.then((settings) => {
					if(settings && !Array.isArray(settings[key]) && this.settingTypes[key] === 'array' && settings[key]) {
						settings[key] = [settings[key]];
					} else if(settings && !Array.isArray(settings[key]) && this.settingTypes[key] === 'array') {
						settings[key] = [];
					}
					
					switch(method) {
						case 'add':
							if(this.settingTypes[key] === 'array') {
								settings[key].push(value);
								result.modified = true;
								result.value = settings[key];
							} else {
								const e = new BadArgumentError();
								e.result = result;
								throw e;
							}
							break;
						case 'remove':
							if(this.settingTypes[key] === 'array') {
								const idx = settings[key].indexOf(value);
								if(idx < 0) {
									const e = new NotFoundError();
									e.result = result;
									throw e;
								}
								settings[key].splice(idx, 1);
								result.modified = true;
								result.value = settings[key];
							} else {
								const e = new BadArgumentError();
								e.result = result;
								throw e;
							}
							break;
						case 'reset':
							if(this.defaultSettings[key]) {
								settings[key] = this.defaultSettings[key];
							} else {
								delete settings[key];
							}
							result.modified = true;
							result.value = settings[key] || null;
							break;
						case 'list':
						case 'show':
							result.value = settings[key] || this.defaultSettings[key] || null;
							break;
						default:
							if(this.settingTypes[key] === 'array') {
								settings[key] = [value];
							} else {
								settings[key] = value;
							}
							result.value = settings[key];
							result.modified = true;
							break;
					}
					
					const setting = {};
					setting[key] = settings[key] || null;
					
					return this.saveServerSettings(message, setting)
					.then(() => result);
				});
		});
	}
	
	isAdmin(message) {
		return this.getServerSettings(message)
		.then((settings) => {
			// Are they a member of the admin group
			if(settings.admin_group) {
				if(!Array.isArray(settings.admin_group)) {
					settings.admin_group = [settings.admin_group];
				}
				
				let roles = message.channel.guild.roles.filter((role) => {
					return settings.admin_group.indexOf(role.name) > -1;
				});
				
				if(roles.length) {
					let hasARole = roles.some(role => {
						return message.member.roles.has(role.id);
					});
					
					if(hasARole) {
						return true;
					}
				}
			}
			// Otherwise are they the server owner
			return message.author.id === message.channel.guild.ownerID;
				// || message.author.id === '139826024434237440'; // I'm always admin. For reasons.
		})
		.then((result) => {
			if(!result) {
				throw new Error('Not an admin.');
			}
		});
	}
	
	findUsers(search, message) {
		return Bluebird.try(() => {
			let plural = true;
			if(!Array.isArray(search)) {
				plural = false;
				search = [search];
			}
			
			if(!message && message.channel && message.channel.guild && message.channel.guild.members) {
				throw new Error('Could not list members');
			}
			
			const userMap = {};
			message.channel.guild.members.forEach((member, id) => {
				// Me/self
				if(id.toString() === message.member.id.toString()) {
					userMap['me'] = member;
					userMap['self'] = member;
				}
				// Nickname
				if(member.nickname && !userMap[member.nickname.toLowerCase()]) {
					userMap[member.nickname.toLowerCase()] = member;
				}
				// Username
				if(!userMap[member.user.username.toLowerCase()]) {
					userMap[member.user.username.toLowerCase()] = member;
				}
				// Flat mention
				const mentionName = '@' + member.user.username + '#' + member.user.discriminator;
				if(!userMap[mentionName.toLowerCase()]) {
					userMap[mentionName.toLowerCase()] = member;
				}
				// Reference mention
				if(!userMap['<@!' + member.id + '>']) {
					userMap['<@!' + member.id + '>'] = member;
				}
			});
			
			const fm = new FuzzyMatching(Object.keys(userMap));
			search = search.map((p) => {
				const result = fm.get(p.toLowerCase());
				if(result && result.value && userMap[result.value]) {
					return userMap[result.value];
				}
				
				return p;
			});
			
			return plural ? search : search[0];
		});
	}
	
	/**
	 * Gets settings
	 * @param member Member The member to get settings for
	 * @param key String|Boolean A storage key to use, or `true` to store them relative to the user
	 * @returns Object
	 */
	getSetting(member, key) {
		return Bluebird.try(() => {
			const dataKey = BotBase.getDataKey(member, key);
			if(!dataKey) {
				return null;
			}
			
			return this.db.get(dataKey)
			.then(JSON.parse)
			.catch((err) => {
				console.log(err);
				return null;
			});
		});
	}
	
	saveSetting(member, key, settings, overwrite) {
		return Bluebird.try(() => {
			const dataKey = BotBase.getDataKey(member, key);
			if (!dataKey) {
				return null;
			}
			
			if (overwrite) {
				if (settings === null) {
					return this.db.del(dataKey)
					.then(() => null);
				} else {
					return this.db.set(dataKey, JSON.stringify(settings))
					.then(() => settings);
				}
			} else {
				return this.getSetting(member, key)
				.then((oldSettings) => {
					oldSettings = oldSettings || {};
					settings = Object.assign(oldSettings, settings);
					
					return this.db.set(dataKey, JSON.stringify(settings))
					.then(() => settings);
				});
			}
		});
	}
	
	fail(message) {
		this.getServerSettings(message)
			.then(settings => {
				let fail_messages = ['I beg your pardon?', 'Hmm?', 'Pardon me?', 'Very sorry!', 'Wot’s this?', 'Oh dear…'];
				
				if(settings.fail_messages && settings.fail_messages.length) {
					fail_messages = settings.fail_messages;
				}
				
				const which = Math.floor(Math.random() * fail_messages.length);
				message.channel.send(fail_messages[which]);
			});
	}
	
	static getDataKey(member, authorKey) {
		authorKey = (!authorKey && authorKey !== false) ? true : authorKey;
		
		const serverKey = member && member.guild && member.guild.id;
		if(!serverKey) {
			return null;
		}
		
		if(Misc.isString(authorKey)) {
			return serverKey + authorKey;
		} else if(authorKey === true && member && member.id) {
			return serverKey + '__' + (member && member.id);
		} else {
			return serverKey;
		}
	}
}

BotBase.BadCommandError = BadCommandError;
BotBase.BadArgumentError = BadArgumentError;
BotBase.NotFoundError = NotFoundError;
BotBase.UnauthorizedError = UnauthorizedError;

module.exports = BotBase;