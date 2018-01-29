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
			default_roles: 'array',
			fail_messages: 'array',
			log_channel: 'string',
			welcome_message: 'string',
			welcome_channel: 'string'
		};
		
		this.phrases = {};
		
		this.messageHandlers = [];
		
		this.init();
		
		// Log errors
		this.bot.on('error', (err) => console.error(err));
		
		// Start the bot!
		this.bot.login(process.env.DISCORD_TOKEN);
	}
	
	init() {
		this.bot.on('message', this.handleMessage.bind(this));
		this.bot.on('ready', this.botReady.bind(this));
		this.bot.on('guildMemberAdd', this.handleJoin.bind(this));
		this.bot.on('messageDelete', this.handleDelete.bind(this));
		this.bot.on('messageDeleteBulk', this.handleDelete.bind(this));
	}
	
	getServerSettings(member) {
		member = member.member || member;
		const key = BotBase.getDataKey(member, '-settings');
		if(!this.settingsCache[key]) {
			this.settingsCache[key] = this.getSetting(member, '-settings')
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
	
	saveServerSettings(member, newSettings, overwrite) {
		member = member.member || member;
		const key = BotBase.getDataKey(member, '-settings');
		return (this.settingsCache[key] = this.saveSetting(member, '-settings', newSettings, overwrite));
	}
	
	handleMessage(message) {
		if(message.member && message.member.id !== this.bot.user.id) {
			this.getServerSettings(message)
			.then((settings) => {
				let handled = false;
				const commands = Object.keys(this.commands);
				
				commands.forEach((command) => {
					const commandInfo = this.commands[command];
					let prefix = commandInfo.ignorePrefix ? '?' : settings.prefix;
					if(process.env.NODE_ENV === 'dev') {
						prefix = 'dev' + prefix;
					}
					
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
				
				if(!handled) {
					Object.keys(this.phrases).forEach((method) => {
						const match = this.phrases[method];
						if(match && this[method]) {
							if(Misc.isString(match) && message.content.indexOf(match) >= 0) {
								this[method](message);
								handled = true;
							} else if(match.test && match.test(message.content)) {
								this[method](message);
								handled = true;
							}
						}
					});
				}
				
				if(!handled) {
					if(this.messageHandlers && this.messageHandlers.length > 0) {
						this.runHandler(message, 0);
					}
				}
			});
		}
	}
	
	handleJoin(member) {
		const guild = member.guild;
		return this.getServerSettings(member)
		.then(serverSettings => {
			if(serverSettings.welcome_message && serverSettings.welcome_channel) {
				let welcome = serverSettings.welcome_message
				.replace(/{username}/g, member.displayName)
				.replace(/{mention}/g, `<@!${member.id}>`)
				.replace(/{userCount}/g, `${guild.members.size}`)
				.replace(/{prefix}/g, serverSettings.prefix);
				
				if(guild.available) {
					const channel = guild.channels.find((c) => c.name === serverSettings.welcome_channel);
					if(channel) {
						channel.send(welcome);
					}
				}
			}
			if(serverSettings.default_roles) {
				if(!Array.isArray(serverSettings.default_roles)) {
					serverSettings.default_roles = [serverSettings.default_roles];
				}
				const roles = [];
				guild.roles.forEach(role => {
					if(serverSettings.default_roles.indexOf(role.name) >= 0) {
						roles.push(role);
					}
				});
				
				member.addRoles(roles)
					.catch((e) => { }); // Silently fail here. Whoops!
			}
		});
	}
	
	handleDelete(message) {
		let aMessage;
		if(message instanceof Map) {
			aMessage = message.first();
		} else {
			aMessage = message;
		}
		if(!aMessage) {
			return;
		}
		
		const guild = aMessage.guild;
		if(!guild.available) {
			return;
		}
		
		return this.getServerSettings(aMessage)
		.then(serverSettings => {
			let messages;
			if(message instanceof Map) {
				messages = message.array();
			} else {
				messages = [message];
			}
			
			if(serverSettings.log_channel) {
				const logChannel = guild.channels.find('name', serverSettings.log_channel);
				if(logChannel && logChannel.type === 'text') {
					return Bluebird.map(messages, (message) => {
						if(message.content.length > 1000) {
							const part1 = `**[δ] Channel:** <#${message.channel.id}> — **${message.author.tag}**`
								+ ` deleted:\n${message.content.substr(0,1000)}`;
							const part2 = `_ _\n${message.content.substr(1000)}`;
							
							return Bluebird.try(() => {
								return logChannel.send(part1).then(() => logChannel.send(part2));
							}).delay(200);
						} else {
							const logMessage = `**[δ] Channel:** <#${message.channel.id}> — **${message.author.tag}**`
								+ ` deleted:\n${message.content}`;
							return Bluebird.try(() => {
								return logChannel.send(logMessage);
							}).delay(200);
						}
					}, { concurrency: 1 });
				}
			}
		});
	}
	
	addHandler(method, priority) {
		priority = +priority || 100;
		this.messageHandlers.push({ priority, method });
		this.messageHandlers.sort((a,b) => {
			return a.priority - b.priority;
		});
	}
	
	runHandler(message, index) {
		if(this.messageHandlers[index]) {
			return Bluebird.resolve(this.messageHandlers[index].method.call(this, message))
				.then((result) => {
					if(result === true) {
						return true;
					}
					return this.runHandler(message, index + 1);
				})
		} else {
			return Bluebird.resolve(false);
		}
	}
	
	displayHelp(message, prefix, postfix, localMessage) {
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
				
				return message.author.send(reply)
					.then(() => {
						return message.channel.send(localMessage);
					});
			});
	}
	
	botReady() {
		// Do nothing
	}
	
	setConfig(params, message) {
		return Bluebird.try(() => {
			params = params.trim();
			const commands = /^(\w+)\s*((?:(?:set|reset|show|list|add|remove)\s*)?)(.*)/.exec(params);
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
				
				if(roles.size > 0) {
					let hasARole = roles.some(role => {
						return message.member.roles.has(role.id);
					});
					
					if(hasARole) {
						return true;
					}
				}
			}
			// Otherwise are they the server owner
			return message.author.id === message.channel.guild.ownerID
				|| (message.member && message.member.hasPermission(Discord.Permissions.FLAGS.ADMINISTRATOR));
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

BotBase.Discord = Discord;
BotBase.Misc = Misc;

module.exports = BotBase;