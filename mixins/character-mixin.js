const FuzzyMatching = require('fuzzy-matching');
const Misc = require('../lib/misc');
const CharacterTemplates = require('../lib/character-templates');
const CharacterWalkthrough = require('../lib/character-walkthrough');

const NAME_DISTANCE = 0.8;

class ExistingCharacter extends Error {
	constructor(...args) { super(...args); Error.captureStackTrace(this, ExistingCharacter); }
}

module.exports = (BotBase) => {
	class CharacterMixin extends BotBase {
		constructor() {
			super();

			this.commands['character'] = {
				helpText: 'Character management. Try typing `{prefix}character help`.',
				args: ['commands'],
				method: 'command__character',
				parseParams: false,
				sort: 9990
			};

			this.commands['whois'] = {
				helpText: 'Look up the characters a player is playing',
				args: ['username'],
				method: 'command__whois',
				parseParams: false,
				sort: 9991
			};

			this.commands['whoplays'] = {
				helpText: 'Look up the player of a certain character',
				args: ['character name'],
				method: 'command__whoplays',
				parseParams: false,
				sort: 9992
			};

			this.commands['playas'] = {
				helpText: 'Change your current character',
				args: ['character name'],
				method: 'command__playas',
				parseParams: false,
				sort: 9993
			};

			this.bot.on('message', this.walkthrough.bind(this));
			this.walkthroughTracker = {};

			this.bot.on('guildMemberRemove', this.characterHandleLeave.bind(this));
			this.bot.on('ready', this.migrateCharacters.bind(this));
		}

		async getCharacterList(member, hideRetired = true) {
			// Load global character list
			let characterList = (await this.getSetting(member, '-characters-new')) || [];

			// Filter characters that are active
			if (hideRetired) {
				characterList = characterList.filter(c => !c.retired)
			}

			// Filter it based on current members, if possible
			if (member.guild && member.guild.members) {
				characterList = characterList.filter(character => member.guild.members.has(character.owner));
			}

			// If not, just return it.
			return characterList;
		}

		async saveCharacterList(member, characterList) {
			return this.saveSetting(member, '-characters-new', characterList, true);
		}

		async characterHandleLeave(member) {
			// getCharacterList removes characters from non-existent members
			return this.saveCharacterList(member, await this.getCharacterList(member));
		}

		async migrateCharacters() {
			// Load global charater list
			for (const [id, guild] of this.bot.guilds) {
				// Create a fake member for stat lookups
				const member = { guild: { id } };
				const characterList = await this.getSetting(member, '-characters');
				if (characterList) {
					console.log(`Migrating characters on ${guild.name}...`);
					const newCharacters = [];
					for (const userId of Object.keys(characterList)) {
						const userData = await this.getSetting(member, `__${userId}`);
						if (userData.characters && userData.characters.length) {
							userData.characters.forEach(character => {
								character.owner = userId;
								newCharacters.push(character);
							});
							delete userData.characters;
							delete userData.retiredCharacters;
						}
						await this.saveSetting(member, `__${userId}`, userData, true);
					}
					// Delete the old global list
					await this.saveSetting(member, '-characters', null, true);

					// Save the new one
					await this.saveCharacterList(member, newCharacters);
					console.log(`Finished migrating ${newCharacters.length} characters on ${guild.name}.`);
				}
			}
		}

		command__character(params, message) {
			const command = (/^\w+\s*/.exec(params) || [''])[0];

			switch (command.trim()) {
				case '':
				case 'help':
					return this.characterHelp(message);
				case 'walkthrough':
					return this.startWalkthrough(message);
				case 'create':
				case 'new':
					return this.newCharacter(Misc.parseString(params), message);
				case 'delete':
					return this.deleteCharacter(params.replace(command, '').trim(), message);
				case 'stat':
					return this.characterStat(params, message);
				case 'info':
					return this.characterInfo(params, message);
				case 'pic':
				case 'picture':
				case 'photo':
				case 'image':
					return this.characterPic(params, message, false);
				case 'thumbnail':
				case 'thumb':
				case 'portrait':
				case 'mugshot':
					return this.characterPic(params, message, true);
				case 'sheet':
					return this.characterSheet(params.replace(command, '').trim(), message);
				case 'retire':
					return this.retireCharacter(params.replace(command, '').trim(), message);
				case 'unretire':
					return this.unretireCharacter(params.replace(command, '').trim(), message);
				case 'transfer':
					return this.transferCharacter(params, message);
				default:
					return this.fail(message);
			}
		}

		async command__playas(params, message) {
			const name = params.trim();
			const userSettings = (await this.getSetting(message.member, true)) || {};

			if (name === '') {
				delete userSettings.currentCharacter;
				await this.saveSetting(message.member, true, userSettings, true)
				return this.sendReply(message, `Ok. You're not currently playing as anyone.`);
			}

			const characterList = (await this.getCharacterList(message.member)).filter(c => c.owner === message.member.id);
			const characterNames = characterList.map(c => c.name);
			const fm = new FuzzyMatching(characterNames);
			const result = fm.get(name);

			if (!result.value) {
				return message.channel.send(`I don’t believe I’ve met ${this.sanitize(name, message)}…`);
			}

			userSettings.currentCharacter = result.value;
			await this.saveSetting(message.member, true, userSettings, true);
			return this.sendReply(message, `Ok. You're currently ${this.sanitize(result.value, message)}.`);
		}

		async command__whois(params, message) {
			params = params.trim();

			if (params.toLowerCase() === 'all' || params.toLowerCase() === 'everyone') {
				return this.whoisAll(message);
			}

			params = params.split(/(, ?| |; ?)/);
			params = params.filter(p => p.length && !/^\s+$/.test(p) && !/^(, ?| |; ?)$/.test(p));

			// Map all the searched names to users
			const members = this.findUsers(params, message);
			const characterList = await this.getCharacterList(message.member);
			if (!members) {
				return this.fail(message);
			}

			// For each member, figure out who they are and look up their info
			let result = '';
			for (const member of members) {
				if (member && member.id) {
					try {
						const userData = await this.getSetting(member);

						if (member.id === message.author.id) {
							if (userData && userData.currentCharacter) {
								result += `You are currently playing as **${userData.currentCharacter}**.`;
							} else {
								result += `You are not currently playing as anyone.`;
							}
						} else {
							if (userData && userData.currentCharacter) {
								result += `${member.displayName} is currently playing as **${userData.currentCharacter}**.`;
							} else {
								result += `${member.displayName} is not currently playing as anyone.`;
							}
						}
						const characterNames = (characterList || []).filter(c => c.owner === member.id).map(c => c.name);
						if (characterNames.length) {
							if (member.id === message.author.id) {
								result += `\nCharacters played by you: ${characterNames.join(', ')}.`;
							} else {
								result += `\nCharacters played by ${member.displayName}: ${characterNames.join(', ')}.`;
							}
						}
					} catch (error) {
						result += `**${member.displayName}:** An error occurred for that user.`;
					}
				} else {
					result += `**${this.sanitize(member, message)}:** I couldn’t find that user.`;
				}

				result += '\n\n';
			}

			return this.sendReply(message, result);
		}

		async whoisAll(message) {
			const characterList = await this.getCharacterList(message.member);
			const charactersByUser = characterList.reduce((obj, c) => {
				if (!obj[c.owner]) {
					obj[c.owner] = [];
				}
				obj[c.owner].push(c.name);
				return obj;
			}, {});

			const userIds = characterList.map(c => c.owner).filter((v, i, s) => s.indexOf(v) === i);

			let result = '';
			for (const userId of userIds) {
				const userSettings = await this.getSetting(message.member, `__${userId}`);
				const userCharacters = charactersByUser[userId].map(c => (userSettings && c === userSettings.currentCharacter) ? `**${c}**` : c);
				if (userCharacters.length) {
					if (userId === message.author.id) {
						result += `You are playing ${userCharacters.join(', ')}\n`;
					} else {
						const member = message.guild.members.get(userId);
						if (member) {
							result += `${member.displayName} is playing ${userCharacters.join(', ')}\n`;
						}
					}
				}
			}

			if (result === '') {
				return this.sendReply(message, 'Nobody has told me about their characters yet!');
			} else {
				return this.sendReply(message, result);
			}
		}

		async command__whoplays(params, message) {
			const name = params.trim();

			const character = await this.findCharacter(name, message);
			if (character) {
				const user = message.guild && message.guild.members.get(character.owner);
				if (character && user) {
					return this.sendReply(message, `${character.name} is played by **${user.displayName}**`);
				} else {
					return this.sendReply(message, `I don’t believe I’ve met ${this.sanitize(name, message)}…`);
				}
			} else {
				return this.sendReply(message, `I don’t believe I’ve met ${this.sanitize(name, message)}…`);
			}
		}

		async characterHelp(message) {
			const { prefix } = await this.getServerSettings(message);

			let reply = `I can help keep track of your roleplay character! If you're not sure how to get ` +
				`started, by far the easiest method is \`?character walkthrough\`.\n\n`;

			const templates = Object.keys(CharacterTemplates).map(t => `\`${t}\``).join(',');

			const commands = [
				{ name: 'help', helpText: 'Get help for character commands.' },
				{ name: 'walkthrough', helpText: 'Create a character with a step-by-step walkthrough.' },
				{ name: 'create', args: ['name', '(--type TEMPLATE)'], helpText: 'Create a character manually. Current templates are ' + templates },
				{ name: 'delete', args: ['exact name'], helpText: 'Delete a character. Be careful!' },
				{ name: 'stat', args: ['stat name', '(value)'], helpText: 'Set or display a character stat. Depends on template (if used).' },
				{ name: 'info', args: ['info name', '(value)'], helpText: 'Set or display a character’s info. Generally free-form, but try `name`,`description`,`race`, or `class`. Delete character info by writing `delete` as a value.' },
				{ name: 'image', args: ['inserted picture'], helpText: 'Set a character’s picture. Simply upload a file and use this command as a comment' },
				{ name: 'thumbnail', args: ['inserted picture'], helpText: 'Set a character’s thumbnail picture. Simply upload a file and use this command as a comment' },
				{ name: 'sheet', args: ['(name)'], helpText: 'Displays a character sheet for a character. Defaults to your current character.' },
				{ name: 'retire', args: ['exact name'], helpText: 'Retires a character. It will remain stored in the system, and can be un-retired at any time, but it is no longer available to play.' },
				{ name: 'unretire', args: ['exact name'], helpText: 'Un-retires a character, and makes them available to play again.' },
				{ name: 'transfer', args: ['exact name', 'username'], helpText: 'Transfers a character to another player.' }
			];

			for (const command of commands) {
				let name = command.ignorePrefix ? `?character` : `${prefix}character`;

				reply += `• \`${name}\` \`${command.name}\` `;

				if (command.args) {
					reply += command.args.map(a => `\`${a}\``).join(' ');
				}

				if (command.helpText) {
					const helpText = command.helpText.replace(/{prefix}/g, prefix);
					reply += `\n\t\t${helpText}\n⁣\n`;
				}

				if (reply.length > 1500) {
					await message.author.send(reply);
					reply = '';
				}
			}

			if (reply.length) {
				await message.author.send(reply);
			}

			return this.sendReply(message, 'I have instructed you privately on the details of character management.');
		}

		async startWalkthrough(message) {
			const track = (this.walkthroughTracker[message.author.id] = {
				user: message.author.id,
				server: message.guild.id,
				member: { id: message.author.id, guild: { id: message.guild.id } },
				timeout: setTimeout(() => {
					delete this.walkthroughTracker[message.author.id];
				}, 21600000), // 6h in ms
				character: {},
				step: 0,
				completedSteps: [],
				ready: true
			});

			await message.author.send(`Hello! You wanted to set up a character on the ${message.guild.name} server? ` +
				`What fun! I’ll walk you through the process. If you want to cancel at anytime, just ` +
				`yell \`ABORT\`, and I’ll forget this ever happened. You can also skip any questions by saying ` +
				`\`skip\`. Just so you know, you’re able to change any info about your character at any time, so ` +
				`feel free to experiment! Now let’s get started.`);

			await Misc.delay(500);
			const step = CharacterWalkthrough[track.step];
			return message.author.send(await step.open(track, message));
		}

		walkthrough(message) {
			if (message.channel.type === 'dm' && message.author.id !== this.bot.user.id) {
				if (!this.walkthroughTracker[message.author.id] || !this.walkthroughTracker[message.author.id].ready) {
					return;
				}

				const track = this.walkthroughTracker[message.author.id];
				if (message.content === 'ABORT') {
					clearTimeout(track.timeout);
					delete this.walkthroughTracker[message.author.id];
					return message.author.send(`Abort! Sorry things didn’t work out.`);
				}

				return this.walkthroughStep(track, message);
			}
		}

		async walkthroughStep(track, message) {
			// Get the current step
			let step = CharacterWalkthrough[track.step];
			// We're "processing things", so ignore messags until we're done
			track.ready = false;
			// Delay slightly to make conversation more natural
			await Misc.delay(500);
			try {
				// Process that message
				const processResult = await step.process(track, message, this);
				if (processResult) {
					// Mark the step as completed
					track.completedSteps.push(track.step);

					// If true, move on to the next one
					if (processResult === true) {
						track.step++;
					} else {
						// Otherwise figure out where we go.
						if (Misc.isString(processResult)) {
							const nextStep = CharacterWalkthrough.findIndex(s => s.step === processResult);
							if (nextStep >= 0) {
								track.step = nextStep;
							} else {
								track.step++;
							}
						} else {
							track.step = processResult;
						}
					}
					// Are we doing stats next (i.e. looping), or have we done stats?
					const statNext = CharacterWalkthrough[track.step] && CharacterWalkthrough[track.step].step === 'stat';
					const haveStats = track.stats && track.stats.length;
					if (track.step < CharacterWalkthrough.length && (!statNext || haveStats)) {
						// If we're not at the last step, and we're not doing stats (or have already done stats)
						// Get the next step, and proceed.
						step = CharacterWalkthrough[track.step];
						const open = step.repeat && track.completedSteps.indexOf(track.step) > -1 ? step.repeat : step.open;
						const text = await open(track, message, this);
						track.ready = true; // Done "processing"
						await message.author.send(text);
					} else {
						// We're at the end
						try {
							// Try and save the characer
							const character = await this.saveCharacter(track.character, { member: track.member, author: { id: track.user } });
							// Clear the timeout
							clearTimeout(track.timeout);
							// Delete their tracker
							delete this.walkthroughTracker[message.author.id];
							// All is good!
							await message.author.send(`Terrific! I’ve set you up to play as ${character.name}. I hope you have lots of fun!`);
							return this.renderSheet(character, { displayName: 'you' }, { channel: message.author });
						} catch (error) {
							// Oh geeze!
							if (error instanceof ExistingCharacter) {
								// The character already exists. Let's get them to think of a new name.
								await message.author.send(`Well, this is really embarrassing. Before I could save your character, it seems someone else created one with a similar name.`);
								track.step = CharacterWalkthrough.findIndex(s => s.step === 'emergency_name');
								step = CharacterWalkthrough[track.step];
								const text = step.open(track, message, this);
								track.ready = true; // Done "processing"
								return message.author.send(text);
							} else {
								// Fail hard?
								console.log(err);
								return message.author.send(`Well, this is really embarrassing. Something strange just happened. Would you mind repeating that?`);
							}
						}
					}
				} else {
					// That step failed, I think? Let's try again.
					const retry = step.repeat || step.open;
					const text = await retry(track, message, this);
					track.ready = true; // Done "processing"
					return message.author.send(text);
				}
			} catch (err) {
				// Oh no!
				await message.author.send(err.message);
				await Misc.delay(500);
				// If it's not the character's name, we can move on if they want
				if (step.step !== 'name') {
					await message.author.send(`Let’s try this one more time. If you want, just say \`skip\` and we can move on.`);
				} else {
					await message.author.send(`Let’s try this one more time.`);
				}
				// Retry
				const text = step.open(track, message, this);
				track.ready = true;
				return message.author.send(text);
			}
		}

		async findCharacter(name, message, distance, hideRetired = true) {
			const characterList = await this.getCharacterList(message.member, hideRetired);
			// Fuzzy match the name, to make sure we're not naming characters too similarly
			let chrNames = characterList.map(c => c.name);
			const fm = new FuzzyMatching(chrNames);
			const result = fm.get(name, { min: distance });

			return characterList.find(c => c.name === result.value);
		}

		async saveCharacter(character, message) {
			// Check and make sure this character is unique
			const existingChar = await this.findCharacter(character.name, message, NAME_DISTANCE, false);
			if (existingChar) {
				const err = new ExistingCharacter();
				err.result = existingChar;
				throw err;
			}

			// Get the list of characters
			let characterList = await this.getCharacterList(message.member);

			// Set the character's owner, add the character to the list
			character.owner = message.author.id;
			characterList.push(character);

			// Save!
			await this.saveCharacterList(message.member, characterList);
			return character;
		}

		async newCharacter(params, message) {
			if (!params || !params || !params.length) {
				return this.fail(message);
			}

			params.shift(); // get rid of "create/new"
			const name = this.sanitize(params.join(' '), message);
			const character = { name };
			character.template = (params && params.flags && params.flags.type) || null;

			try {
				await this.saveCharacter(character, message);
				// Character created!
				const type = (character.template && CharacterTemplates[character.template] && CharacterTemplates[character.template].game) || 'free-form';
				return this.sendReply(message, `Nice to meet you, ${character.name}! I’ll keep track of your ${type} stats.`);
			} catch (err) {
				if (err instanceof ExistingCharacter) {
					// Oops name too similar.
					return this.sendReply(message, `That’s very similar to "${err.result.name}"… Try something else to avoid confusion.`);
				}
				throw err;
			}
		}

		async deleteCharacter(name, message) {
			name = name.trim();

			// Find the character
			let characterList = await this.getCharacterList(message.member);
			const index = characterList.findIndex(c => c.name === name);
			const character = characterList[index];
			if (!character) {
				return this.sendReply(message, `I don’t believe I’ve met ${this.sanitize(name, message)}…`);
			}

			// Make sure we're either the owner, or an admin
			if (character.owner !== message.member.id && !(await this.isAdmin(message))) {
				return this.fail(message);
			}

			// Reset that user's "current character", if they're playing the one about to be deleted
			const userSettings = (await this.getSetting(message.member, `__${character.owner}`)) || {};
			if (userSettings.currentCharacter === character.name) {
				delete userSettings.currentCharacter;
				await this.saveSetting(message.member, `__${character.owner}`, userSettings, true);
			}

			// Save the global character list, and inform them the deed is done
			characterList.splice(index, 1);
			await this.saveSetting(message.member, '-characters-new', characterList, true);
			return this.sendReply(message, `Goodbye ${this.sanitize(name, message)}! It was nice knowing you.`);
		}

		async retireCharacter(name, message) {
			name = name.trim();

			// Find the character
			let characterList = await this.getCharacterList(message.member);
			const index = characterList.findIndex(c => c.name === name);
			const character = characterList[index];
			if (!character) {
				return this.sendReply(message, `I don’t believe I’ve met ${this.sanitize(name, message)}…`);
			}

			// Make sure we're either the owner, or an admin
			if (character.owner !== message.member.id && !(await this.isAdmin(message))) {
				return this.fail(message);
			}

			// Reset that user's "current character", if they're playing the one about to be retired
			const userSettings = (await this.getSetting(message.member, `__${character.owner}`)) || {};
			if (userSettings.currentCharacter === character.name) {
				delete userSettings.currentCharacter;
				await this.saveSetting(message.member, `__${character.owner}`, userSettings, true);
			}

			// Save the global character list, and inform them the deed is done
			characterList[index].retired = true;
			await this.saveSetting(message.member, '-characters-new', characterList, true);
			return this.sendReply(message, `I've retired ${this.sanitize(name, message)}.`);
		}

		async unretireCharacter(name, message) {
			name = name.trim();

			// Find the character
			let characterList = await this.getCharacterList(message.member, false);
			const index = characterList.findIndex(c => c.name === name);
			const character = characterList[index];
			if (!character) {
				return this.sendReply(message, `I don’t believe I’ve met ${this.sanitize(name, message)}…`);
			}

			// Make sure we're either the owner, or an admin
			if (character.owner !== message.member.id && !(await this.isAdmin(message))) {
				return this.fail(message);
			}

			// Save the global character list, and inform them the deed is done
			delete characterList[index].retired;
			await this.saveSetting(message.member, '-characters-new', characterList, true);
			return this.sendReply(message, `Huzzah! ${this.sanitize(name, message)} has returned.`);
		}

		async transferCharacter(params, message) {
			const parsedParams = Misc.tokenizeString(params, 3);
			parsedParams.shift(); // Get rid of "transfer"

			if (!parsedParams || parsedParams.length < 2) {
				return this.fail(message);
			}

			// Find the character
			const name = parsedParams.shift();
			let characterList = await this.getCharacterList(message.member);
			const index = characterList.findIndex(c => c.name === name);
			const character = characterList[index];
			if (!character) {
				return this.sendReply(message, `I don’t believe I’ve met ${this.sanitize(name, message)}…`);
			}

			// Make sure we're either the owner, or an admin
			if (character.owner !== message.member.id && !(await this.isAdmin(message))) {
				return this.fail(message);
			}

			const userName = parsedParams.shift();
			const user = message.guild.members.find(m => m.displayName === userName || m.nickname === userName || m.user.username === userName);

			if (!user) {
				return this.sendReply(message, `I can't find another member with the name ${this.sanitize(userName, message)}…`);
			}

			// Reset that user's "current character", if they're playing the one about to be transferred
			const userSettings = (await this.getSetting(message.member, `__${character.owner}`)) || {};
			if (userSettings.currentCharacter === character.name) {
				delete userSettings.currentCharacter;
				await this.saveSetting(message.member, `__${character.owner}`, userSettings, true);
			}

			// Save the global character list, and inform them the deed is done
			character.owner = user.id;

			await this.saveSetting(message.member, '-characters-new', characterList, true);
			return this.sendReply(message, `I've transferred ownership of ${this.sanitize(name, message)} to ${this.sanitize(user.displayName, message)}.`);
		}

		async characterSheet(name, message) {
			try {
				let character, owner;

				if (name) {
					// Name provided. Search characters by name
					character = await this.findCharacter(name, message);
					owner = message.member.guild.members.get(character.owner);
				} else {
					// No name. Use the current character, if set
					const userSettings = await this.getSetting(message.member);
					if (userSettings.currentCharacter) {
						const characterList = await this.getCharacterList(message.member);
						character = characterList.find(c => c.name === userSettings.currentCharacter);
					}
					owner = message.member;
				}

				// Tried to search, and no result
				if (!character && name) {
					return this.sendReply(message, `I don’t believe I’ve met ${this.sanitize(name, message)}…`);
				} else if (!character) {
					// Didn't try to search, but current user has no characters
					return this.sendReply(message, `It doesn’t seem like you have a character to display.`);
				}

				// Render the sheet
				return this.renderSheet(character, owner, message);
			} catch (err) {
				console.log(err);
				return this.fail(message);
			}
		}

		renderSheet(character, member, message) {
			const replyObj = {
				title: (character.title ? character.title + ' ' : '') + character.name,
				description: character.description || 'Not much is known about this mysterious character…',
				fields: []
			};

			if (character.image) {
				replyObj.image = {
					url: character.image
				}
			}

			if (character.thumbnail) {
				replyObj.thumbnail = {
					url: character.thumbnail
				}
			}

			if (character.template && CharacterTemplates[character.template]) {
				replyObj.footer = {
					text: `A ${CharacterTemplates[character.template].game} character - Played by ${member.displayName}`
				};
			} else {
				replyObj.footer = {
					text: `A free-form character - Played by ${member.displayName}`
				};
			}

			// Set this here now
			if (character.template && CharacterTemplates[character.template] &&
				CharacterTemplates[character.template].derivedStats &&
				CharacterTemplates[character.template].derivedStats.level &&
				!character.level && (character.stats && !character.stats.level)) {
				const level = CharacterTemplates[character.template].derivedStats.level.calc(character);
				if (level || level === 0) {
					character.level = level;
				}
			}

			if (character.race) {
				replyObj.fields.push({ name: "Race", value: character.race });
			}
			if (character.class) {
				if (character.level) {
					replyObj.fields.push({ name: "Class & Level", value: `Lvl. ${character.level} ${character.class}` });
				} else {
					replyObj.fields.push({ name: "Class", value: character.class });
				}
			} else if (character.level) {
				replyObj.fields.push({ name: "Level", value: character.level });
			}
			if (character.occupation || character.job) {
				replyObj.fields.push({ name: "Occupation", value: character.occupation || character.job });
			}


			if (character.template && CharacterTemplates[character.template]) {
				const template = CharacterTemplates[character.template];
				const statKeys = Object.keys(template.stats);
				statKeys.forEach((stat) => {
					const statName = template.stats[stat].abbrev || template.stats[stat].name;
					let statVal = (character.stats && character.stats[stat]);
					if (template.stats[stat].calc && statVal) {
						const modifier = template.stats[stat].calc(statVal);
						statVal = `${modifier > 0 ? '+' + modifier : modifier} (${character.stats[stat]})`;
					}
					replyObj.fields.push({ name: statName, value: statVal || 'Not Set', inline: true });
				});
				if (CharacterTemplates[character.template].derivedStats) {
					const derivedKeys = Object.keys(template.derivedStats);
					derivedKeys.forEach((stat) => {
						if (stat === 'level' && character.level) {
							return;
						}
						const statName = template.derivedStats[stat].abbrev || template.derivedStats[stat].name;
						let statVal = template.derivedStats[stat].calc(character);
						if (statVal || statVal === 0) {
							replyObj.fields.push({ name: statName, value: statVal, inline: true });
						}
					});
				}
			} else if (character.stats) {
				const statKeys = Object.keys(character.stats);
				statKeys.forEach((stat) => {
					replyObj.fields.push({ name: stat, value: character.stats[stat], inline: true });
				});
			}

			const fieldBlacklist = ['title', 'name', 'race', 'description', 'image', 'stats', 'level',
				'class', 'occupation', 'job', 'template', 'thumbnail', 'owner', 'retired'];
			const infoFields = Object.keys(character).filter(i => fieldBlacklist.indexOf(i) < 0);
			infoFields.forEach(info => {
				replyObj.fields.push({ name: Misc.capitalizeWords(info), value: character[info] });
			});

			const replyEmbed = new BotBase.Discord.RichEmbed(replyObj);

			return this.sendReply(message, { embed: replyEmbed });
		}

		async characterStat(params, message) {
			const parsedParams = Misc.tokenizeString(params, 2);
			parsedParams.shift(); // Get rid of "stat"

			if (!parsedParams || parsedParams.length < 2) {
				return this.fail(message);
			}

			let [stat, value] = parsedParams;
			stat = this.sanitize(stat, message);
			value = this.sanitize(value, message);

			if (!stat) {
				return this.fail(message);
			}

			const userSettings = await this.getSetting(message.member, true);
			if (!userSettings.currentCharacter) {
				return this.sendReply(message, `You’re not currently playing a character. Please create or select a character first.`);
			}

			const characterList = await this.getCharacterList(message.member);
			const character = characterList.find((c) => c.name === userSettings.currentCharacter);

			const template = CharacterTemplates[character.template];
			character.stats = character.stats || {};

			// Is this a templated character
			if (template) {
				// Did they pass a value to update?
				if (value) {
					// Is this a valid stat based on the template?
					if (template.stats && template.stats[stat]) {
						// Update it
						character.stats[stat] = value;
						await this.saveCharacterList(message.member, characterList);

						if (template.stats && template.stats[stat] && template.stats[stat].calc) {
							// Modifier. Show the modifier value, and the base value
							const modifier = template.stats[stat].calc(character.stats[stat]);
							return this.sendReply(message, `Great! ${character.name}’s ${template.stats[stat].name} is now ${modifier > 0 ? '+' + modifier : modifier} (${character.stats[stat]})`);
						} else {
							// No modifier. Just show the value, but it is a named stat
							return this.sendReply(message, `Great! ${character.name}’s ${template.stats[stat].name} is now ${character.stats[stat]}`);
						}
					} else {
						// Not a valid stat. Let the user know
						return this.sendReply(message, `I don’t think ${stat} is used in ${template.game}. Possible options: ${Object.keys(template.stats).join(', ')}`);
					}
					// No value. Display the stat
				} else if (character.stats[stat]) {
					// Does it have a modifier function?
					if (template.stats && template.stats[stat] && template.stats[stat].calc) {
						// Modifier. Show the modifier value, and the base value
						const modifier = template.stats[stat].calc(character.stats[stat]);
						return this.sendReply(message, `${character.name}’s ${template.stats[stat].name} is currently ${modifier > 0 ? '+' + modifier : modifier} (${character.stats[stat]})`);
					} else if (template.stats && template.stats[stat]) {
						// No modifier. Just show the value, but it is a named stat
						return this.sendReply(message, `${character.name}’s ${template.stats[stat].name} is currently ${character.stats[stat]}`);
					} else {
						// No modifier. Unknown stat. Just show the value
						return this.sendReply(message, `${character.name}’s ${stat} is currently ${character.stats[stat]}`);
					}
				} else {
					// No stat for that.
					return this.sendReply(message, `${character.name}’s ${stat} not currently being tracked.`);
				}
			} else {
				// Freeform character
				// Did they pass a value?
				if (value) {
					// Yes. Update it
					if (value === 'delete') {
						delete character.stats[stat];
					} else {
						character.stats[stat] = value;
					}
					await this.saveCharacterList(message.member, characterList);

					if (character.stats[stat]) {
						return this.sendReply(message, `Great! ${character.name}’s ${stat} is now ${character.stats[stat]}`);
					} else {
						return this.sendReply(message, `I’ve forgotten ${character.name}’s ${stat}`);
					}
				} else if (character.stats[stat]) {
					// No, but the stat exists. Display the stat
					return this.sendReply(message, `${character.name}’s ${stat} is currently ${character.stats[stat]}`);
				} else {
					// Nothing doing.
					return this.sendReply(message, `${character.name}’s ${stat} not currently being tracked.`);
				}
			}
		}

		async characterInfo(params, message) {
			const parsedParams = Misc.tokenizeString(params, 2);
			parsedParams.shift(); // Get rid of "info"

			if (!parsedParams || parsedParams.length < 2) {
				return this.fail(message);
			}

			let [info, value] = parsedParams;
			info = this.sanitize(info, message).toLowerCase();
			value = this.sanitize(value, message);

			const infoBlacklist = ['image', 'thumbnail', 'stats'];
			if (infoBlacklist.includes(info)) {
				return this.fail(message);
			}

			const userSettings = await this.getSetting(message.member, true);
			if (!userSettings.currentCharacter) {
				return this.sendReply(message, `You’re not currently playing a character. Please create or select a character first.`);
			}

			const characterList = await this.getCharacterList(message.member);
			const character = characterList.find((c) => c.name === userSettings.currentCharacter);

			// Did they pass a value?
			if (value) {
				// Was it "delete"
				if (value === 'delete' && info !== 'name') {
					delete character[info];
				} else {
					character[info] = value;
				}

				// If they're changing the name, update their current character
				if (info === 'name') {
					userSettings.currentCharacter = value;
					await this.saveSetting(message.member, true, userSettings, true);
				}

				// Save the character list
				await this.saveCharacterList(message.member, characterList);

				// Inform the user
				if (character[info] && character[info].length > 15) {
					return this.sendReply(message, `Great! ${character.name}’s ${Misc.capitalizeWords(info)} is saved.`);
				} else if (character[info]) {
					return this.sendReply(message, `Great! ${character.name}’s ${Misc.capitalizeWords(info)} is now ${character[info]}`);
				} else {
					return this.sendReply(message, `I’ve forgotten ${character.name}’s ${Misc.capitalizeWords(info)}`);
				}
			} else if (character[info]) {
				// No, but the stat exists. Display the stat
				if (character[info].length > 15) {
					return this.sendReply(message, `${character.name}’s ${Misc.capitalizeWords(info)} is as follows:\n\`\`\`${character[info]}\`\`\``);
				} else {
					return this.sendReply(message, `${character.name}’s ${Misc.capitalizeWords(info)} is ${character[info]}`);
				}
			} else {
				// Nothing doing.
				return this.sendReply(message, `${character.name}’s ${Misc.capitalizeWords(info)} not currently being tracked.`);
			}
		}

		async characterPic(params, message, thumb) {
			const property = thumb ? 'thumbnail' : 'image';
			let image;
			if (message.attachments && message.attachments.size) {
				image = message.attachments.first();
			} else if (/\s+delete$/.test(params)) {
				image = null;
			} else {
				return this.fail(message);
			}

			const userSettings = await this.getSetting(message.member);
			if (!userSettings.currentCharacter) {
				return message.channel.send(`You’re not currently playing a character. Please create or select a character first.`);
			}
			const characterList = await this.getCharacterList(message.member);
			const character = characterList.find(c => c.name === userSettings.currentCharacter);
			if (!character) {
				return this.fail(message);
			}

			if (image) {
				character[property] = image.url;
			} else {
				delete character[property];
			}

			await this.saveCharacterList(message.member, characterList);
			if (character[property]) {
				if (thumb) {
					return this.sendReply(message, `What a great close-up of ${character.name}!`);
				} else {
					return this.sendReply(message, `Wow! Now I know what ${character.name} looks like.`);
				}
			} else {
				return this.sendReply(message, `Ok. I’ll get rid of that picture of ${character.name}.`);
			}
		}

		async roll__getStat(stat, message) {
			stat = Misc.stringNormalize(('' + stat).trim());

			const userSettings = await this.getSetting(message.member, true);

			if (!userSettings.currentCharacter) {
				return null;
			}

			const characterList = await this.getCharacterList(message.member);
			const character = characterList.find(c => c.name === userSettings.currentCharacter);

			if (!character) {
				return null;
			}

			let template;
			if (character.template && CharacterTemplates[character.template]) {
				template = CharacterTemplates[character.template];
			}

			if (template && template.stats && template.stats[stat] && template.stats[stat].calc && character.stats[stat]) {
				return template.stats[stat].calc(character.stats[stat]);
			} else if (template && template.derivedStats && template.derivedStats[stat]) {
				return template.derivedStats[stat].calc(character);
			} else {
				const statKey = Object.keys(character.stats).find((s) => Misc.stringNormalize(s) === stat);
				if (character.stats[statKey]) {
					const statVal = parseInt(character.stats[statKey]);
					return Number.isNaN(statVal) ? null : statVal;
				}

				if (template && template.derivedStats) {
					const statKeys = Object.keys(template.derivedStats);

					const match = statKeys.find((key) => {
						const dStat = template.derivedStats[key];
						if (Array.isArray(dStat.alias)) {
							return dStat.alias.includes((item) => Misc.stringNormalize(item) === stat);
						} else if (typeof (dStat.alias) === 'string') {
							return Misc.stringNormalize(dStat.alias) === stat;
						}
						return false;
					});
					if (match) {
						return template.derivedStats[match].calc(character);
					}
				}

				return null;
			}
		}
	}

	CharacterMixin.ExistingCharacter = ExistingCharacter;

	return CharacterMixin;
};