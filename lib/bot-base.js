'use strict';

const EventEmitter = require('events');
const Discord = require('discord.js');
const Redis = require('ioredis');
const FuzzyMatching = require('fuzzy-matching');
const Misc = require('./misc');

const isFunction = (functionToCheck) =>
	functionToCheck && (
		Object.prototype.toString.call(functionToCheck) === '[object Function]' ||
		Object.prototype.toString.call(functionToCheck) === '[object AsyncFunction]'
	);

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

process.on('unhandledRejection', (error) => {
	console.error(error);
});


class BotBase {
	constructor() {
		// Properties
		this.bot = new Discord.Client();
		this.db = new Redis(process.env.REDIS_URL);
		this.settingsCache = {};
		this.extraHelp = [];
		this.logall = {};

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

		// Log redis errors
		this.db.on('error', err => {
			console.error('An error ocurred connecting to redis.', err);
		});
	}

	init() {
		this.bot.on('message', this.handleMessage.bind(this));
		this.bot.on('ready', this.botReady.bind(this));
		this.bot.on('guildMemberAdd', this.handleJoin.bind(this));
	}

	getServerSettings(member) {
		member = member.member || member;
		const key = BotBase.getDataKey(member, '-settings');

		if (!this.settingsCache[key]) {
			this.settingsCache[key] = this.getSetting(member, '-settings')
				.then((settings) => {
					settings = settings || {};
					Object.keys(settings).forEach((key) => {
						if (settings[key] === null) {
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

	matchCommand(message, command, prefix) {
		// Match mention + command
		const mentionCommand = `<@${this.bot.user.id}> ${command}`;
		if (message.content.indexOf(mentionCommand) === 0) {
			return mentionCommand;
		}

		if (prefix) {
			// Match command at beginning of message
			const matchCmd = new RegExp(`^${Misc.escapeRegex(prefix + command)}(\\s|$)`);
			const match = matchCmd.exec(message.content);
			if (match) {
				return match[0];
			}
		}

		return false;
	}

	async handleMessage(message) {
		if (message && message.guild && this.logall[message.guild.id]) {
			console.info(`Server: ${message.guild.id}\nMember: ${message.member.id}\n\n${message.content}`);
		}

		if (message.member && message.member.id !== this.bot.user.id) {
			const settings = await this.getServerSettings(message);
			let handled = false;
			const commands = Object.keys(this.commands);

			this.logall[message.guild.id] = settings.logall;

			// Help shortcut
			if (this.matchCommand(message, 'help')) {
				const helpCommand = commands.find(c => this.commands[c].helpShortcut);
				if (helpCommand) {
					handled = this.runCommand(this.commands[helpCommand], helpShortcut, message);
				}
			}

			if (!handled) {
				commands.forEach((command) => {
					const commandInfo = this.commands[command];
					let prefix = commandInfo.ignorePrefix ? '?' : settings.prefix;
					if (process.env.NODE_ENV === 'dev') {
						prefix = 'dev' + prefix;
					}

					const matchedCommand = this.matchCommand(message, command, prefix);
					if (matchedCommand) {
						handled = this.runCommand(commandInfo, matchedCommand, message);
					}
				});
			}

			if (!handled) {
				Object.keys(this.phrases).forEach((method) => {
					const match = this.phrases[method];
					if (match && this[method]) {
						if (Misc.isString(match) && message.content.indexOf(match) >= 0) {
							this[method](message);
							handled = true;
						} else if (match.test && match.test(message.content)) {
							this[method](message);
							handled = true;
						}
					}
				});
			}

			if (!handled) {
				if (this.messageHandlers && this.messageHandlers.length > 0) {
					for (let i = 0; i < this.messageHandlers.length; i++) {
						const result = await this.messageHandlers[i].method.call(this, message);
						if (result === true) {
							break;
						}
					}
				}
			}
		}
	}

	runCommand(commandInfo, prefix, message) {
		let handled = false;
		if (commandInfo.method && isFunction(this[commandInfo.method])) {
			message.content = this.normalizeMessage(message.content);

			// Parse the command
			let params;
			if (commandInfo.parseParams === false) {
				params = message.content.replace(prefix, '').trim();
			} else {
				params = Misc.parseString(message.content.replace(prefix, '').trim());
			}

			// Execute the command
			const result = this[commandInfo.method](params, message);
			handled = true;

			// If the returned value is promise-like
			// handle any errors to prevent uncaught promises
			if (result && result.catch) {
				result.catch((err) => {
					console.error(err);
					return this.fail(message);
				});
			}
		}
		return handled;
	}

	async handleJoin(member) {
		const guild = member.guild;
		const serverSettings = await this.getServerSettings(member);

		if (serverSettings.welcome_message && serverSettings.welcome_channel) {
			let welcome = serverSettings.welcome_message
				.replace(/{username}/g, member.displayName)
				.replace(/{mention}/g, `<@!${member.id}>`)
				.replace(/{userCount}/g, `${guild.members.size}`)
				.replace(/{prefix}/g, serverSettings.prefix);

			if (guild.available) {
				const channel = guild.channels.find((c) => c.name === serverSettings.welcome_channel);
				if (channel) {
					channel.send(welcome);
				}
			}
		}

		if (serverSettings.default_roles) {
			if (!Array.isArray(serverSettings.default_roles)) {
				serverSettings.default_roles = [serverSettings.default_roles];
			}
			const roles = [];
			guild.roles.forEach(role => {
				if (serverSettings.default_roles.indexOf(role.name) >= 0) {
					roles.push(role);
				}
			});

			try {
				await member.addRoles(roles);
			} catch (e) { /* Silently fail here. Whoops! */ }
		}
	}

	addHandler(method, priority) {
		priority = +priority || 100;
		this.messageHandlers.push({ priority, method });
		this.messageHandlers.sort((a, b) => {
			return a.priority - b.priority;
		});
	}

	addHelpGenerator(method) {
		this.extraHelp.push(method);
	}

	async displayHelp(message, prefix, postfix, localMessage) {
		const isAdmin = await this.isAdmin(message);
		const settings = await this.getServerSettings(message);

		let commandHelp = Object.assign({}, this.commands);
		for (const helpGenerator of this.extraHelp) {
			commandHelp = await helpGenerator.call(this, message, commandHelp);
		}

		const commands = Object.keys(commandHelp);

		commands.sort((a, b) => {
			if (commandHelp[a].sort && commandHelp[b].sort) {
				return commandHelp[a].sort - commandHelp[b].sort;
			} else if (commandHelp[a].sort) {
				return -1;
			} else if (commandHelp[b].sort) {
				return 1;
			} else {
				return a.localeCompare(b);
			}
		});

		let reply = '';
		if (prefix) {
			reply += `${prefix}\n\n`;
		}

		for (const commandName of commands) {
			const command = commandHelp[commandName];
			if (!command.adminOnly || isAdmin) {
				let name = command.ignorePrefix ? `?${commandName}` : `${settings.prefix + commandName}`;

				reply += `• \`${name}\` `;

				if (command.args) {
					reply += command.args.map(a => `\`${a}\``).join(' ');
				}

				if (command.helpText) {
					let helpText;
					if (command.ignorePrefix) {
						helpText = command.helpText.replace(/{prefix}/g, '?');
					} else {
						helpText = command.helpText.replace(/{prefix}/g, settings.prefix);
					}

					reply += `\n\t${helpText}\n⁣\n`;
				}
			}
			if (reply.length > 1500) {
				await message.author.send(reply);
				reply = '';
			}
		}

		if (postfix) {
			reply += postfix;
		}

		if (reply.length) {
			await message.author.send(reply);
		}

		return this.sendReply(message, localMessage);
	}

	botReady() {
		// Do nothing
	}

	normalizeMessage(message) {
		let result = message;
		result = result.replace(/[“”]/g, '"');
		result = result.replace(/[‘’]/g, '\'');
		return result;
	}

	async setConfigValue(message, key, value, method) {
		// Set defaults
		if (!value) {
			value = null;
		}
		// Method is "set" with value, or "show" without
		if (!method) {
			if (value) {
				method = 'set';
			} else {
				method = 'show';
			}
		}

		// Is this even a setting?
		if (!this.settingTypes[key]) {
			throw new BadArgumentError();
		}

		// Get existing settings
		const settings = await this.getServerSettings(message);

		// If the type is array, but the setting isn't, then fix it.
		const arrayType = this.settingTypes[key] === 'array';
		if (settings && !Array.isArray(settings[key]) && arrayType && settings[key]) {
			settings[key] = [settings[key]];
		} else if (settings && !Array.isArray(settings[key]) && arrayType) {
			settings[key] = [];
		}

		const result = {
			modified: false,
			method: method,
			key: key,
			inputValue: value
		};
		if (arrayType) {
			// Manage array entries
			switch (method) {
				case 'add':
					settings[key].push(value);
					result.modified = true;
					result.value = settings[key];
					break;
				case 'remove':
					const idx = settings[key].indexOf(value);
					if (idx < 0) {
						const e = new NotFoundError();
						e.result = result;
						throw e;
					}
					settings[key].splice(idx, 1);
					result.modified = true;
					result.value = settings[key];
					break;
				case 'list':
				case 'show':
					result.value = settings[key] || this.defaultSettings[key] || null;
					break;
				case 'reset':
					if (this.defaultSettings[key]) {
						settings[key] = this.defaultSettings[key];
					} else {
						delete settings[key];
					}
					result.modified = true;
					result.value = settings[key] || null;
					break;
				default:
					settings[key] = [value];
					result.modified = true;
					result.value = settings[key] || null;
			}
		} else {
			// Manage single value entries
			switch (method) {
				case 'add':
				case 'remove':
					throw new BadCommandError();
				case 'list':
				case 'show':
					result.value = settings[key] || this.defaultSettings[key] || null;
					break;
				case 'reset':
					if (this.defaultSettings[key]) {
						settings[key] = this.defaultSettings[key];
					} else {
						delete settings[key];
					}
					result.modified = true;
					result.value = settings[key] || null;
					break;
				default:
					settings[key] = value;
					result.modified = true;
					result.value = settings[key] || null;
			}
		}

		if (result.modified) {
			await this.saveServerSettings(message, settings, true);
		}

		return result;
	}

	async isAdmin(message) {
		const settings = this.getServerSettings(message);
		// Are they a member of the admin group
		if (settings.admin_group) {
			if (!Array.isArray(settings.admin_group)) {
				settings.admin_group = [settings.admin_group];
			}

			let roles = message.channel.guild.roles.filter((role) => {
				return settings.admin_group.indexOf(role.name) > -1;
			});

			if (roles.size > 0) {
				let hasARole = roles.some(role => {
					return message.member.roles.has(role.id);
				});

				if (hasARole) {
					return true;
				}
			}
		}
		// Otherwise are they the server owner
		return message.author.id === message.channel.guild.ownerID
			|| (message.member && message.member.hasPermission(Discord.Permissions.FLAGS.ADMINISTRATOR));
		// || message.author.id === '139826024434237440'; // I'm always admin. For reasons.
	}

	findUsers(search, message) {
		let plural = true;
		if (!Array.isArray(search)) {
			plural = false;
			search = [search];
		}

		if (!message && message.channel && message.channel.guild && message.channel.guild.members) {
			throw new Error('Could not list members');
		}

		const quickFind = Misc.stringNormalize(search.join(''), false).trim();

		// Me/self
		if (quickFind === 'me' || quickFind === 'self') {
			return plural ? [message.member] : message.member;
		}

		// Exact name match
		const exactShortcut = message.channel.guild.members.find((member) =>
			Misc.stringNormalize(member.displayName, false) === quickFind
		);

		if (exactShortcut) {
			return plural ? [exactShortcut] : exactShortcut;
		}

		// Start of name
		const startShortcut = message.channel.guild.members.filter((member) =>
			Misc.stringNormalize(member.displayName, false).indexOf(quickFind) === 0
		);
		if (startShortcut.size === 1) {
			return plural ? [startShortcut.first()] : startShortcut.first();
		}

		// Fuzzy
		const userMap = {};
		message.channel.guild.members.forEach((member, id) => {
			// Nickname
			if (member.nickname && !userMap[member.nickname.toLowerCase()]) {
				userMap[member.nickname.toLowerCase()] = member;
			}
			// Username
			if (!userMap[member.user.username.toLowerCase()]) {
				userMap[member.user.username.toLowerCase()] = member;
			}
			// Flat mention
			const mentionName = '@' + member.user.username + '#' + member.user.discriminator;
			if (!userMap[mentionName.toLowerCase()]) {
				userMap[mentionName.toLowerCase()] = member;
			}
			// Reference mention
			if (!userMap['<@!' + member.id + '>']) {
				userMap['<@!' + member.id + '>'] = member;
			}
		});

		const fm = new FuzzyMatching(Object.keys(userMap));
		search = search.map((p) => {
			const result = fm.get(p.toLowerCase());
			if (result && result.value && userMap[result.value]) {
				return userMap[result.value];
			}

			return p;
		});

		return plural ? search : search[0];
	}

	/**
	 * Gets settings
	 * @param member Member The member to get settings for
	 * @param key String|Boolean A storage key to use, or `true` to store them relative to the user
	 * @returns Object
	 */
	getSetting(member, key) {
		const dataKey = BotBase.getDataKey(member, key);
		if (!dataKey) {
			return Promise.resolve(null);
		}

		return this.db.get(dataKey)
			.then(JSON.parse)
			.catch((err) => {
				console.log(err);
				return null;
			});
	}

	async saveSetting(member, key, settings, overwrite) {
		const dataKey = BotBase.getDataKey(member, key);
		if (!dataKey) {
			return null;
		}

		if (overwrite) {
			if (settings === null) {
				await this.db.del(dataKey);
				return null;
			} else {
				await this.db.set(dataKey, JSON.stringify(settings));
				return settings;
			}
		} else {
			let oldSettings = await this.getSetting(member, key);

			oldSettings = oldSettings || {};
			settings = Object.assign(oldSettings, settings);
			await this.db.set(dataKey, JSON.stringify(settings));

			return settings;
		}
	}

	sendReply(message, content, options) {
		const channel = (message && message.channel) || message;

		return new Promise((resolve, reject) => {
			setTimeout(() => {
				channel.send(content, options).then(resolve, reject);
			}, 200);
		});
	}

	async fail(message) {
		const settings = await this.getServerSettings(message);

		let fail_messages = ['I beg your pardon?', 'Hmm?', 'Pardon me?', 'Very sorry!', 'Wot’s this?', 'Oh dear…'];

		if (settings.fail_messages && settings.fail_messages.length) {
			fail_messages = settings.fail_messages;
		}

		const which = Math.floor(Math.random() * fail_messages.length);
		return this.sendReply(message, fail_messages[which]);
	}

	sanitize(input, message) {
		let guild;

		if (message && message.member && message.member.guild && message.member.guild.available) {
			guild = message.member.guild;
		} else if (message && message.guild && message.guild.available) {
			guild = message.guild;
		} else if (typeof message === 'string' && this.bot.guilds.get(message)) {
			guild = this.bot.guilds.get(message);
		}

		if (guild) {
			let safeInput = input;
			const guildNames = guild.roles.map((item) => item.name.replace(/^@/, ''));
			const guildCodes = guild.roles.map((item) => [`<@&${item.id}>`, item.name]);
			// Is @someone still a thing?
			const verboten = ['here', 'someone', 'everyone'].concat(guildNames).concat(guildCodes);
			verboten.forEach(v => {
				if (Array.isArray(v)) {
					const test = new RegExp(Misc.escapeRegex(v[0]), 'gi');
					safeInput = safeInput.replace(test, v[1]);
				} else {
					const test = new RegExp(`@(${Misc.escapeRegex(v)})`, 'gi');
					safeInput = safeInput.replace(test, '$1');
				}
			});

			return safeInput;
		} else {
			return ("" + input).replace(/@([^\s])/gi, '$1');
		}

	}

	static getDataKey(member, authorKey) {
		authorKey = (!authorKey && authorKey !== false) ? true : authorKey;

		const serverKey = member && member.guild && member.guild.id;
		if (!serverKey) {
			return null;
		}

		if (Misc.isString(authorKey)) {
			return serverKey + authorKey;
		} else if (authorKey === true && member && member.id) {
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
