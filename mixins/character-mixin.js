'use strict';

const Bluebird = require('bluebird'),
	ParseCommand = require('minimist-string'),
	FuzzyMatching = require('fuzzy-matching');

const dnd5eModifier = function(val) {
	return Math.floor((val - 10) / 2);
};

const CharacterTemplates = {
	'd&d5e': {
		game: 'Dungeons & Dragons 5th Edition',
		stats: {
			'str': { name: 'Strength', abbrev: 'STR', calc: dnd5eModifier },
			'dex': { name: 'Dexterity', abbrev: 'DEX', calc: dnd5eModifier },
			'con': { name: 'Constitution', abbrev: 'CON', calc: dnd5eModifier },
			'int': { name: 'Intelligence', abbrev: 'INT', calc: dnd5eModifier },
			'wis': { name: 'Wisdom', abbrev: 'WIS', calc: dnd5eModifier },
			'cha': { name: 'Charisma', abbrev: 'CHA', calc: dnd5eModifier },
			'ac': { name: 'Armor Class', abbrev: 'AC' },
			'hp': { name: 'Hit Point Maximum', abbrev: 'Max HP' },
			'speed': { name: 'Speed' },
			'exp': { name: 'Experience', abbrev: 'XP' }
		},
		derivedStats: {
			'level': {
				name: 'Level',
				calc: (character) => {
					const exp = [0,300,900,2700,6500,14000,23000,34000,48000,64000,85000,
								 100000,120000,140000,165000,195000,225000,265000,305000,355000];
					return exp.findIndex((i) => character.exp < i) + 1;
				}
			},
			'prof': {
				name: 'Proficiency',
				calc: (character) => {
					const level = CharacterTemplates['d&d5e'].derivedStats.level(character);
					if(level > 16) {
						return 6;
					} else if(level > 12) {
						return 5;
					} else if(level > 8) {
						return 4;
					} else if(level > 4) {
						return 3;
					} else {
						return 2;
					}
				}
			}
		}
	}
};
const CharacterNameDistance = 0.8;

class ExistingCharacter extends Error {
	constructor(...args) { super(...args); Error.captureStackTrace(this, ExistingCharacter); }
}

const capitalize = (string) => string.charAt(0).toUpperCase() + string.slice(1);

/**
 * TODO:
 * 	- Display level when class isn't present
 * 	- Show stats on freeform characters
 *  - Add calculated stats for templated characters
 */
const isSkip = (m,s) => ((m && m.content || `${m}`)).toLowerCase()
	.trim().replace(/(^[^a-z]+|[^a-z]$)/gi,'') === (s || 'skip');

const walkthroughSteps = [
	{
		step: 'template',
		open: function() {
			return `What kind of character did you want to create? I know about ` +
			`\`${Object.keys(CharacterTemplates).join('`, `')}\`. If you ` +
			`don’t want to use a template, just say \`none\`.`;
		},
		process: function(track, message) {
			if(CharacterTemplates[message.content]) {
				track.character.template = message.content;
				return message.author.sendMessage(`Got it! I’ll keep track of their ` +
					`${CharacterTemplates[message.content].game} stats.`).then(() => true);
			} else if(isSkip(message) || isSkip(message, 'none')) {
				return message.author.sendMessage(`Got it! I’ll keep track of their free form stats.`)
					.then(() => true);
			} else {
				throw new Error(`Hmm... I’m not quite sure what you mean.`);
			}
		}
	},
	{
		step: 'name',
		open: function() {
			return `What is your character’s name?`;
		},
		process: function(track, message, bot) {
			if(isSkip(message)) {
				throw new Error('Sorry, this is the one thing I can’t skip.');
			}
			const name = message.content;
			return bot.findCharacter(name, {member: track.member}, CharacterNameDistance)
			.then((result) => {
				if(result) {
					throw new Error(`That’s very similar to someone else’s ` +
						`character "${result.character}"… Try something else to avoid confusion.`);
				}
				
				track.character.name = message.content;
				return message.author.sendMessage(`Nice to meet you, ${name}!`)
					.then(() => true);
			});
		},
		repeat: function() {
			return `Got any other ideas for a name for your character?`;
		}
	},
	{
		step: 'description',
		open: function(track) {
			return `Tell me about ${track.character.name}. What do they like? How do they dress? Where are they from? ` +
				`Give me all the details of their life, so I know exactly who they are.`;
		},
		process: function(track, message) {
			if(isSkip(message) || isSkip(message,'no')) {
				return message.author.sendMessage(`Moving right along!`)
					.then(() => true);
			} else {
				track.character.description = message.content;
				return message.author.sendMessage(`Wonderful!`)
					.then(() => true);
			}
		}
	},
	{
		step: 'pic',
		open: function() {
			return `Do you have a picture of your character you’d like to use? If you do, please send it to me!`;
		},
		process: function(track, message) {
			if(isSkip(message) || isSkip(message,'no')) {
				return message.author.sendMessage(`I shan’t give it another thought!`)
					.then(() => true);
			} else {
				let image;
				if(message.attachments && message.attachments.size) {
					image = message.attachments.first();
				} else  {
					throw new Error('Whoops! There didn’t seem to be an picture with that message.');
				}
				
				track.character.image = image.url;
				return message.author.sendMessage(`Wow! Now I know what ${track.character.name} looks like.`);
			}
		}
	},
	{
		step: 'info',
		open: function() {
			return `Now let’s work on some details. What information would you like to add? For instance,` +
				` you can say something like \`job\`, \`class\`, or \`race\`.`;
		},
		repeat: function() {
			return `Is there any other information you want to add? You can say \`job\`, \`class\`, or \`race\`, or ` +
				`really anything at all! If you’ve entered everything you want, say \`done\`.`;
		},
		process: function(track, message) {
			if(isSkip(message)) {
				return message.author.sendMessage(`Okay! Skipping that for now.`)
					.then(() => 6);
			} else if(isSkip(message,'done')) {
				return message.author.sendMessage(`Fantastic! All information saved.`)
					.then(() => 6);
			} else {
				track.nextInfo = message.content;
				return true;
			}
		}
	},
	{
		step: 'info_value',
		open: function(track) {
			return `Okay! What should I put down for ${track.nextInfo}?`;
		},
		process: function(track, message) {
			const info = track.nextInfo;
			delete track.nextInfo;
			
			if(isSkip(message)) {
				return message.author.sendMessage(`Got it! Skipping for now!`)
					.then(() => 6);
			}
			
			track.character[info] = message.content;
			return message.author.sendMessage(`Good! Noted.`)
				.then(() => 4);
		}
	}/*,
	{
		step: 'stat',
		open: function(track) {
			return `Ok! Since we’re setting up a ${CharacterTemplates[track.character.template].game}` +
				` character, we need to `
		},
		process: function(track, message) {
			const info = track.nextInfo;
			delete track.nextInfo;
			
			if(isSkip(message)) {
				return message.author.sendMessage(`Got it! Skipping for now!`)
				.then(() => 6);
			}
			
			track.character[info] = message.content;
			return message.author.sendMessage(`Good! Noted.`)
			.then(() => 4);
		}
	}*/
	// TODO: this ^
];

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
		}

		command__character(params, message) {
			const parsedParams = ParseCommand(params);
			const command = parsedParams._.shift();
			switch(command) {
				case 'help':
					return this.characterHelp(message);
				case 'walkthrough':
					return this.startWalkthrough(message);
				case 'create':
				case 'new':
					return this.newCharacter(parsedParams, message);
				case 'delete':
					return this.deleteCharacter(params.replace(command,''), message);
				case 'stat':
					return this.characterStat(parsedParams, message);
				case 'info':
					return this.characterInfo(params.replace(command,''), message);
				case 'pic':
				case 'picture':
				case 'photo':
				case 'image':
					return this.characterPic(params, message);
				case 'sheet':
					return this.characterSheet(params.replace(command,''), message);
				default:
					return this.fail(message);
			}
		}
		
		characterHelp(message) {
			return this.getServerSettings(message)
				.then(serverSettings => {
					let reply = 'Character commands.\n\n';
					
					const templates = Object.keys(CharacterTemplates).map(t => `\`${t}\``).join(',');
					
					const commands = [
						{ name: 'help', helpText: 'Get help for character commands.'},
						{ name: 'create', args: ['name','(--type TEMPLATE)'], helpText: 'Create a character. Current templates are ' + templates},
						{ name: 'delete', args: ['exact name'], helpText: 'Delete a character. Be careful!'},
						{ name: 'stat', args: ['stat name','(value)'], helpText: 'Set or display a character stat. Depends on template (if used).'},
						{ name: 'info', args: ['info name','(value)'], helpText: 'Set or display a character’s info. Generally free-form, but try `name`,`description`,`race`, or `class`. Delete character info by writing `delete` as a value.'},
						{ name: 'image', args: ['inserted picture'], helpText: 'Set a character’s picture. When uploading a file, use this as a comment'},
						{ name: 'sheet', args: ['(name)'], helpText: 'Displays a character sheet for a character. Defaults to your current character.'}
					];
					
					commands.forEach(command => {
							let name = command.ignorePrefix ? `?character` : `${serverSettings.prefix}character`;
							
							reply += `• \`${name}\` \`${command.name}\` `;
							
							if(command.args) {
								reply += command.args.map(a => `\`${a}\``).join(' ');
							}
							
							if(command.helpText) {
								const helpText = command.helpText.replace(/{prefix}/g, serverSettings.prefix);
								reply += `\n\t\t${helpText}\n⁣\n`;
							}
					});
					
					return message.channel.send(reply);
				});
		}
		
		startWalkthrough(message) {
			const track = (this.walkthroughTracker[message.author.id] = {
				user: message.author.id,
				server: message.guild.id,
				member: {id: message.author.id, guild: { id: message.guild.id }},
				timeout: setTimeout(() => {
					delete this.walkthroughTracker[message.author.id];
				}, 21600000), // 6h in ms
				character: {},
				step: 0,
				completedSteps: [],
				ready: true
			});
			
			return Bluebird.try(() => {
				return message.author.sendMessage(`Hello! You wanted to set up a character on the ${message.guild.name} server? ` +
					`What fun! I’ll walk you through the process. If you want to cancel at anytime, just ` +
					`yell \`ABORT\`, and I’ll forget this ever happened. You can also skip any questions by saying ` +
					`\`skip\`. Just so you know, you’re able to change any info about your character at any time, so ` +
					`feel free to experiment! Now let’s get started.`);
			})
			.delay(500)
			.then(() => {
				const step = walkthroughSteps[track.step];
				return Bluebird.resolve(step.open(track, message)).then((text) => {
					return message.author.sendMessage(text);
				});
			});
		}
		
		
		walkthrough(message) {
			if(message.channel.type === 'dm' && message.author.id !== this.bot.user.id) {
				if(!this.walkthroughTracker[message.author.id]) {
					return this.fail(message);
				}
				if(!this.walkthroughTracker[message.author.id].ready) {
					return;
				}
				
				const track = this.walkthroughTracker[message.author.id];
				if(message.content === 'ABORT') {
					clearTimeout(track.timeout);
					delete this.walkthroughTracker[message.author.id];
				}
				
				return this.walkthroughStep(track, message);
			}
		}
		
		walkthroughStep(track, message) {
			let step = walkthroughSteps[track.step];
			track.ready = false;
			return Bluebird.delay(500)
			.then(() => {
				return Bluebird.resolve(step.process(track, message, this));
			})
			.delay(2000)
			.then((processResult) => {
				if(processResult) {
					track.completedSteps.push(track.step);
					
					if(processResult === true) {
						track.step++;
					} else {
						track.step = processResult;
					}
					
					if(track.step < walkthroughSteps.length) {
						step = walkthroughSteps[track.step];
						const open = step.repeat && track.completedSteps.indexOf(track.step) > -1 ? step.repeat : step.open;
						return Bluebird.resolve(open(track, message, this))
						.then((text) => {
							track.ready = true;
							return message.author.sendMessage(text);
						});
					} else {
						return this.saveCharacter(track.character, {member: track.member, author: {id: track.user}})
						.then((character) => {
							clearTimeout(track.timeout);
							delete this.walkthroughTracker[message.author.id];
							return message.author.sendMessage(`Terrific! I’ve set you up to play ` +
								`as ${character.name}. I hope you have lots of fun!`);
						})
						.catch(ExistingCharacter, () => {
							
							return message.author.sendMessage(`Well, this is really embarrassing. Before I could ` +
								`save your character, it seems someone else created one with a similar name. I can’t` +
								`really handle this situation yet. The only thing we can do is \`ABORT\`.`);
						})
						.catch((err) => {
							console.log(err);
							return message.author.sendMessage(`Well, this is really embarrassing. Something ` +
								`strange just happened. Would you mind repeating that?`);
						});
					}
				} else {
					const retry = step.retry || step.open;
					return Bluebird.resolve(retry(track, message, this))
					.then((text) => {
						track.ready = true;
						return message.author.sendMessage(text);
					});
				}
			})
			.catch(err => {
				return Bluebird.resolve(message.author.sendMessage(err.message))
					.delay(500)
					.then(() => {
						if(step.step !== 'name') {
							return message.author.sendMessage(`Let’s try this one more time. If you want, just say \`skip\` and we can move on.`);
						} else {
							return message.author.sendMessage(`Let’s try this one more time.`);
						}
					})
					.then(() => {
						return Bluebird.resolve(step.open(track, message, this))
							.then((text) => {
								track.ready = true;
								return message.author.sendMessage(text);
							});
					});
			});
		}
		
		saveCharacter(character, message) {
			return this.findCharacter(character.name, message, CharacterNameDistance)
			.then(result => {
				if(result) {
					const err = new ExistingCharacter();
					err.result = result;
					throw err;
				}
				
				return this.getSetting(message.member, true)
				.then((userSettings) => {
					userSettings = userSettings || {};
					
					// Setup the storage, if they're not set
					userSettings.characters = userSettings.characters || [];
					
					// Add the character.
					userSettings.currentCharacter = character.name;
					userSettings.characters.push(character);
					
					// Update the global list
					return this.getCharacterList(message.member)
					.then(characterList => {
						characterList[message.author.id] = userSettings.characters.map((c) => c.name);
						return this.saveCharacterList(message.member, characterList);
					})
					.then(() => {
						// Save
						return this.saveSetting(message.member, true, userSettings, true)
					});
				})
				.then(() => {
					return character;
				});
			});
		}
		
		newCharacter(params, message) {
			const name = params._.join(' ');
			const character = { name };
			character.template = (params && params.type) || null;
			
			return this.saveCharacter(character, message)
			.then((character) => {
				// Character created!
				const type = (character.template && CharacterTemplates[character.template] &&
					CharacterTemplates[character.template].game) || 'freeform';
				return message.channel.send(`Nice to meet you, ${character.name}! I’ll keep track of your ${type} stats.`);
			})
			.catch(ExistingCharacter, (err) => {
				// Oops name too similar.
				return message.channel.send(`That’s very similar to ${err.result.user.displayName}’s ` +
					`character "${err.result.character}"… Try something else to avoid confusion.`);
			});
		}
		
		findCharacter(name, message, distance) {
			return this.getCharacterList(message.member)
			.then(serverCharacters => {
				// Fuzzy match the name, to make sure we're not naming characters too similarly
				let chrNames = [];
				let characters = {};
				
				Object.keys(serverCharacters).forEach((userId) => {
					if(serverCharacters[userId] && serverCharacters[userId].length) {
						serverCharacters[userId].forEach(character => {
							characters[character] = {
								userId,
								user: message && message.guild && message.guild.members
									? message.guild.members.get(userId) : { displayName: 'someone' },
								character: character
							};
							chrNames.push(character);
						});
					}
				});
				
				const fm = new FuzzyMatching(chrNames);
				const result = fm.get(name, { min: distance });
				
				if(result.value) {
					return characters[result.value];
				} else {
					return null;
				}
			});
		}
		
		getCharacterList(member) {
			// Load global character list
			return this.getSetting(member, '-characters')
			.then((data) => {
				data = data || {};
				if(member.guild.members) {
					Object.keys(data).forEach((userId) => {
						// Delete data for any members that have left
						if(!member.guild.members.has(userId)) {
							delete data[userId];
						}
					});
				}
				
				return data;
			});
		}
		
		saveCharacterList(member, list) {
			return this.saveSetting(member, '-characters', list, true);
		}
		
		deleteCharacter(name, message) {
			name = name.trim();
			const safeName = name.replace(/[^a-zA-Z0-9'’]+/g,' ');
			return this.getSetting(message.member, true)
			.then((userSettings) => {
				userSettings.characters = userSettings.characters || [];
				
				const character = userSettings.characters.find(c => c.name === name);
				
				if(!character) {
					return message.channel.send(`I don’t believe I’ve met ${safeName}…`);
				}
				
				const idx = userSettings.characters.findIndex((c) => c.name === character.name);
				userSettings.characters.splice(idx, 1);
				
				// If they're currently that character. Forget about it.
				if(userSettings.currentCharacter === character.name) {
					delete userSettings.currentCharacter;
				}
				
				// Update the global list
				return this.getCharacterList(message.member)
				.then(characterList => {
					characterList[message.author.id] = userSettings.characters.map((c) => c.name);
					return this.saveCharacterList(message.member, characterList);
				})
				.then(() => {
					// Save
					return this.saveSetting(message.member, true, userSettings, true)
				})
				.then(() => {
					return message.channel.send(`Goodbye ${name}! It was nice knowing you.`);
				});
			});
		}
		
		characterStat(params, message) {
			const stat = params._[0].trim();
			let value = params._[1];
			
			if(value && value.trim) {
				value = value.trim();
			}
			
			return this.getSetting(message.member, true)
			.then((userSettings) => {
				userSettings.characters = userSettings.characters || [];
				
				if(!userSettings.currentCharacter) {
					return message.channel.send(`You’re not currently playing a character. Please create or select a character first.`);
				}
				
				const character = userSettings.characters.find((c) => c.name === userSettings.currentCharacter);
				const template = CharacterTemplates[character.template];
				
				character.stats = character.stats || {};
				
				// Is this a templated character
				if(template) {
					// Did they pass a value to update?
					if(value) {
						// Is this a valid stat based on the template?
						if(template.stats && template.stats[stat]) {
							// Update it
							character.stats[stat] = value;
							return this.saveSetting(message.member, true, userSettings, true)
							.then(() => {
								// Does it have a modifier function?
								if(template.stats && template.stats[stat] && template.stats[stat].calc) {
									// Modifier. Show the modifier value, and the base value
									const modifier = template.stats[stat].calc(character.stats[stat]);
									return message.channel.send(`Great! ${character.name}’s ${template.stats[stat].name} is now ${modifier > 0 ? '+' + modifier : modifier} (${character.stats[stat]})`);
								} else {
									// No modifier. Just show the value, but it is a named stat
									return message.channel.send(`Great! ${character.name}’s ${template.stats[stat].name} is now ${character.stats[stat]}`);
								}
							});
						} else {
							// Not a valid stat. Let the user know
							return message.channel.send(`I don’t think ${stat} is used in ${template.game}. ` +
								`Possible options: ${Object.keys(template.stats).join(', ')}`);
						}
						// No value. Display the stat
					} else if(character.stats[stat]) {
						// Does it have a modifier function?
						if(template.stats && template.stats[stat] && template.stats[stat].calc) {
							// Modifier. Show the modifier value, and the base value
							const modifier = template.stats[stat].calc(character.stats[stat]);
							return message.channel.send(`${character.name}’s ${template.stats[stat].name} is currently ${modifier > 0 ? '+' + modifier : modifier} (${character.stats[stat]})`);
						} else if(template.stats && template.stats[stat]) {
							// No modifier. Just show the value, but it is a named stat
							return message.channel.send(`${character.name}’s ${template.stats[stat].name} is currently ${character.stats[stat]}`);
						} else {
							// No modifier. Unknown stat. Just show the value
							return message.channel.send(`${character.name}’s ${stat} is currently ${character.stats[stat]}`);
						}
					} else {
						// No stat for that.
						return message.channel.send(`${character.name}’s ${stat} not currently being tracked.`);
					}
				} else {
					// Freeform character
					// Did they pass a value?
					if(value) {
						// Yes. Update it
						if(value === 'delete') {
							delete character.stats[stat];
						} else {
							character.stats[stat] = value;
						}
						
						return this.saveSetting(message.member, true, userSettings, true)
						.then(() => {
							if(character.stats[stat]) {
								return message.channel.send(`Great! ${character.name}’s ${stat} is now ${character.stats[stat]}`);
							} else {
								return message.channel.send(`I’ve forgotten ${character.name}’s ${stat}`);
							}
						});
					} else if(character.stats[stat]) {
						// No, but the stat exists. Display the stat
						return message.channel.send(`${character.name}’s ${stat} is currently ${character.stats[stat]}`);
					} else {
						// Nothing doing.
						return message.channel.send(`${character.name}’s ${stat} not currently being tracked.`);
					}
				}
			});
		}
		
		characterInfo(params, message) {
			const parsedParams = /^(\w+)\s*([\s\S]*)$/.exec(params.trim());
			if(!parsedParams || !parsedParams[1]) {
				return this.fail(message);
			}
			const info = parsedParams[1].toLowerCase();
			const value = parsedParams[2].trim();
			
			if(['stats','image'].indexOf(info) >= 0) {
				return this.fail(message);
			}
			
			return this.getSetting(message.member, true)
			.then((userSettings) => {
				userSettings.characters = userSettings.characters || [];
				
				if(!userSettings.currentCharacter) {
					return message.channel.send(`You’re not currently playing a character. Please create or select a character first.`);
				}
				
				const character = userSettings.characters.find((c) => c.name === userSettings.currentCharacter);
				
				// Did they pass a value?
				if(value) {
					if(value === 'delete' && info !== 'name') {
						delete character[info];
					} else {
						character[info] = value;
					}
					
					let result = Bluebird.resolve();
					if(info === 'name') {
						userSettings.currentCharacter = value;
						
						result = result.then(() => {
							// Update the global list
							return this.getCharacterList(message.member)
							.then(characterList => {
								characterList[message.author.id] = userSettings.characters.map((c) => c.name);
								return this.saveCharacterList(message.member, characterList);
							});
						});
					}
					
					return result.then(() => {
						return this.saveSetting(message.member, true, userSettings, true)
						.then(() => {
							if(character[info] && character[info].length > 15) {
								return message.channel.send(`Great! ${character.name}’s ${info} is saved.`);
							} else if(character[info]) {
								return message.channel.send(`Great! ${character.name}’s ${info} is now ${character[info]}`);
							} else {
								return message.channel.send(`I’ve forgotten ${character.name}’s ${info}`);
							}
						});
					});
				} else if(character[info]) {
					// No, but the stat exists. Display the stat
					if(character[info].length > 15) {
						return message.channel.send(`${character.name}’s ${info} is as follows:\n\`\`\`${character[info]}\`\`\``);
					} else {
						return message.channel.send(`${character.name}’s ${info} is ${character[info]}`);
					}
				} else {
					// Nothing doing.
					return message.channel.send(`${character.name}’s ${info} not currently being tracked.`);
				}
			});
		}
		
		command__playas(params, message) {
			const name = params.trim();
			
			return this.getSetting(message.member, true)
			.then((userSettings) => {
				userSettings.characters = userSettings.characters || [];
				
				if(name === '') {
					delete userSettings.currentCharacter;
					return this.saveSetting(message.member, true, userSettings, true)
					.then(() => {
						return message.channel.send(`Ok. You're not currently playing as anyone.`);
					});
				}
				
				const chrNames = userSettings.characters.map(c => c.name);
				const fm = new FuzzyMatching(chrNames);
				const result = fm.get(name);
				
				if(!result.value && name !== '') {
					return message.channel.send(`I don’t believe I’ve met ${name}…`);
				}
				
				if(name !== '') {
					userSettings.currentCharacter = result.value;
				}
				
				return this.saveSetting(message.member, true, userSettings, true)
				.then(() => {
					return message.channel.send(`Ok. You're currently ${result.value}.`);
				});
			});
		}
		
		command__whois(params, message) {
			params = params.trim();
			
			if(params.toLowerCase() === 'all' || params.toLowerCase() === 'everyone') {
				return this.whoisAll(message);
			}
			
			params = params.split(/(, ?| |; ?)/);
			params = params.filter(p => p.length && !/^\s+$/.test(p) && !/^(, ?| |; ?)$/.test(p));
			
			// Map all the searched names to users
			return this.findUsers(params, message)
			.then((members) => {
				if(!members) {
					return this.fail(message);
				}
				
				// For each member, figure out who they are and look up their info
				return Bluebird.map(members, (member) => {
					if(member && member.id) {
						return this.getSetting(member)
						.then((userData) => {
							if(!userData) {
								throw new Error();
							}
							
							let result = '';
							if(member.id === message.author.id) {
								if(userData.currentCharacter) {
									result += `You are currently playing as **${userData.currentCharacter}**.`;
								} else {
									result += `You are not currently playing as anyone.`;
								}
							} else {
								if(userData.currentCharacter) {
									result += `${member.displayName} is currently playing as **${userData.currentCharacter}**.`;
								} else {
									result += `${member.displayName} is not currently playing as anyone.`;
								}
							}
							
							const characterNames = (userData.characters || []).map(c => c.name)
								.filter(c => c !== userData.currentCharacter);
							if(characterNames.length) {
								if(member.id === message.author.id) {
									result += `\nOther characters played by you: ${characterNames.join(', ')}.`;
								} else {
									result += `\nOther characters played by ${member.displayName}: ${characterNames.join(', ')}.`;
								}
							}
							
							return result;
						})
						.catch(() => {
							return message.channel.send(`**${member.displayName}:** An error occurred for that user.`);
						});
					} else {
						return `**${member}:** I couldn’t find that user.`;
					}
				})
				.then((results) => {
					// Join all results with newlines, and print the message
					message.channel.send(results.join('\n\n'));
				});
			});
		}
		
		whoisAll(message) {
			return this.getCharacterList(message.member)
				.then((list) => {
					const userIds = Object.keys(list);
					return userIds.map((userId) => {
						if(userId === message.author.id) {
							return `You are playing ${list[userId].join(', ')}`;
						} else {
							const member = message.guild.members.get(userId);
							if(member) {
								return `${member.displayName} is playing ${list[userId].join(', ')}`;
							}
						}
					});
				})
				.then((results) => {
					results = results.filter(r => r);
					
					// Join all results with newlines, and print the message
					message.channel.send(results.join('\n\n'));
				});
		}
		
		command__whoplays(params, message) {
			const name = params.trim();
			
			return this.findCharacter(name, message)
				.then(result => {
					if(result) {
						return message.channel.send(`${result.character} is played by **${result.user.displayName}**`);
					} else {
						return message.channel.send(`I don’t believe I’ve met ${name}…`);
					}
				});
		}
		
		characterSheet(name, message) {
			return Bluebird.try(() => {
				if(name) {
					// Name provided. Search characters by name
					return this.findCharacter(name, message);
				} else {
					// No name. Use the current character, if set
					return this.getSetting(message.member)
					.then((userData) => {
						if (userData.currentCharacter) {
							// Simulate the result above
							return {
								userId: message.author.id,
								user: message.author,
								character: userData.currentCharacter
							};
						}
					});
				}
			})
			.then(foundCharacter => {
				// Tried to search, and no result
				if(!foundCharacter && name) {
					return message.channel.send(`I don’t believe I’ve met ${name}…`);
				} else if(!foundCharacter) {
					// Didn't try to search, but current user has no characters
					return message.channel.send(`It doesn’t seem like you have a character to display.`);
				}
				
				// Get the member from the userId
				const member = message.guild.members.get(foundCharacter.userId);
				if(!member) {
					return message.channel.send(`**${name}:** An error occurred for that character.`);
				}
				// Look up their info
				return this.getSetting(member, true)
					.then((userSettings) => {
						// No info ?
						if(!userSettings || !userSettings.characters) {
							return message.channel.send(`**${member.displayName}:** An error occurred for that user.`);
						}
						// Get the character
						const character = userSettings.characters.find(c => c.name === foundCharacter.character);
						if(!character) {
							return message.channel.send(`**${foundCharacter.character}:** An error occurred for that character.`);
						}
						// Render the sheet
						return this.renderSheet(character, member, message);
					});
			});
		}
		
		renderSheet(character, member, message) {
			const replyObj = {
				title: (character.title ? character.title + ' ' : '') + character.name,
				description: character.description || 'Not much is known about this mysterious character…',
				fields: []
			};
			
			if(character.image) {
				replyObj.thumbnail = {
					url: character.image
				}
			}
			
			if(character.template && CharacterTemplates[character.template]) {
				replyObj.footer = {
					text: `A ${CharacterTemplates[character.template].game} character - Played by ${member.displayName}`
				};
			} else {
				replyObj.footer = {
					text: `A free-form character - Played by ${member.displayName}`
				};
			}
			
			if(character.race) {
				replyObj.fields.push({ name: "Race", value: character.race });
			}
			if(character.class) {
				if(character.level) {
					replyObj.fields.push({ name: "Class & Level", value: `Lvl. ${character.level} ${character.class}` });
				} else {
					replyObj.fields.push({ name: "Class", value: character.class });
				}
			} else if(character.level) {
				replyObj.fields.push({ name: "Level", value: character.level });
			}
			if(character.occupation || character.job) {
				replyObj.fields.push({ name: "Occupation", value: character.occupation || character.job });
			}
			
			
			if(character.template && CharacterTemplates[character.template]) {
				const template = CharacterTemplates[character.template];
				const statKeys = Object.keys(CharacterTemplates[character.template].stats);
				statKeys.forEach((stat) => {
					const statName = template.stats[stat].abbrev || template.stats[stat].name;
					let statVal = (character.stats && character.stats[stat]) || 'Not Set';
					if(template.stats[stat].calc && character.stats[stat]) {
						const modifier = template.stats[stat].calc(character.stats[stat]);
						statVal = `${modifier > 0 ? '+' + modifier : modifier} (${character.stats[stat]})`;
					}
					replyObj.fields.push({ name: statName, value: statVal, inline: true });
				});
			} else if(character.stats) {
				const statKeys = Object.keys(character.stats);
				statKeys.forEach((stat) => {
					replyObj.fields.push({ name: stat, value: character.stats[stat], inline: true });
				});
			}
			
			const fieldBlacklist = ['title','name','race','description','image','stats','level',
									'class','occupation','job','template'];
			const infoFields = Object.keys(character).filter(i => fieldBlacklist.indexOf(i) < 0);
			infoFields.forEach(info => {
				replyObj.fields.push({ name: capitalize(info), value: character[info] });
			});
			
			const replyEmbed = new BotBase.Discord.RichEmbed(replyObj);
			
			return message.channel.send({ embed: replyEmbed });
		}
		
		characterPic(params, message) {
			let image;
			if(message.attachments && message.attachments.size) {
				image = message.attachments.first();
			} else if(/^pic\s+delete/.test(params)) {
				image = null;
			} else {
				return this.fail(message);
			}
			
			return this.getSetting(message.member, true)
			.then((userSettings) => {
				userSettings.characters = userSettings.characters || [];
				
				if(!userSettings.currentCharacter) {
					return message.channel.send(`You’re not currently playing a character. Please create or select a character first.`);
				}
				
				const character = userSettings.characters.find((c) => c.name === userSettings.currentCharacter);
				
				if(image) {
					character.image = image.url;
				} else {
					delete character.image;
				}
				
				return this.saveSetting(message.member, true, userSettings, true)
				.then(() => {
					if(character.image) {
						return message.channel.send(`Wow! Now I know what ${character.name} looks like.`);
					} else {
						return message.channel.send(`Ok. I’ll get rid of that picture of ${character.name}.`);
					}
				});
			});
		}
		
		roll__getStat(stat, message) {
			stat = ('' + stat).trim().toLowerCase();
			
			return this.getSetting(message.member, true)
			.then((userSettings) => {
				userSettings.characters = userSettings.characters || [];
				
				if (!userSettings.currentCharacter) {
					return null;
				}
				
				const character = userSettings.characters.find((c) => c.name === userSettings.currentCharacter);
				if(!character) {
					return null;
				}
				
				let template;
				if(character.template && CharacterTemplates[character.template]) {
					template = CharacterTemplates[character.template];
				}
				
				if(template && template.stats && template.stats[stat] && template.stats[stat].calc && character.stats[stat]) {
					return template.stats[stat].calc(character.stats[stat]);
				} else if(character.stats[stat]) {
					const statVal = parseInt(character.stats[stat]);
					return Number.isNaN(statVal) ? null : statVal;
				} else {
					return null;
				}
			});
		}
	}
	
	
	
	CharacterMixin.ExistingCharacter = ExistingCharacter;
	
	return CharacterMixin;
};