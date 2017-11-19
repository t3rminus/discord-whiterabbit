'use strict';

const Bluebird = require('bluebird');

const dnd5eModifier = function(val) {
	return Math.floor((val - 10) / 2);
};

const CharacterTemplates = {
	'd&d5e': {
		game: 'Dungeons & Dragons 5th Edition',
		stats: {
			'str': { name: 'Strength', calc: dnd5eModifier },
			'dex': { name: 'Dexterity', calc: dnd5eModifier },
			'con': { name: 'Constitution', calc: dnd5eModifier },
			'int': { name: 'Intelligence', calc: dnd5eModifier },
			'wis': { name: 'Wisdom', calc: dnd5eModifier },
			'cha': { name: 'Charisma', calc: dnd5eModifier }
		}
	}
};
const CharacterNameDistance = 0.8;

module.exports = (BotBase) =>
class DiceMixin extends BotBase {
	constructor() {
		super();
		
		this.commands['character'] = {
			helpText: 'Look up a Dungeons & Dragons 5th Edition Spell',
			args: ['spellname'],
			method: 'command__character'
		};
	}
	
	command__character(params, message) {
		params = params.trim().split(/(, ?| |; ?)/);
		params = params.filter(p => p.length && !/^\s+$/.test(p) && !/^(, ?| |; ?)$/.test(p));
		
		const command = params.shift();
		switch(command) {
			case 'create':
			case 'new':
				return this.newCharacter(params, message);
			case 'stat':
				return this.characterStat(params, message);
				break;
			case 'desc':
			case 'description':
				//return this.characterDesc(params, message);
				break;
			case 'pic':
			case 'picture':
			case 'photo':
			case 'image':
			//return this.characterPic(params, message);
		}
	}
	
	newCharacter(params, message) {
		let template = null;
		if(CharacterTemplates[params[params.length - 1]]) {
			template = params.pop();
		}
		
		const name = params.join(' ');
		
		return this.getSetting(message.member, true)
		.then((userSettings) => {
			userSettings.characters = userSettings.characters || [];
			
			const chrNames = userSettings.characters.map(c => c.name);
			const fm = new FuzzyMatching(chrNames);
			const result = fm.get(name, { min: CharacterNameDistance });
			
			if(result.value) {
				return message.channel.send(`That’s very similar to ${result.value}… Try something else to avoid confusion.`)
			}
			
			const newChr = {
				name: name
			};
			if(template) {
				newChr.template = template;
			}
			
			userSettings.currentCharacter = name;
			userSettings.characters.push(newChr);
			return this.saveSetting(message.member, true, userSettings, true)
			.then(() => {
				return message.channel.send(`Nice to meet you, ${name}! I’ll keep track of your ${(CharacterTemplates[template] && CharacterTemplates[template].game) || 'freeform'} stats.`);
			});
		});
	}
	
	characterStat(params, message) {
		const stat = params[0];
		const value = params[1];
		
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
						return message.channel.send(`I don’t think ${stat} is used in ${template.game}.` +
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
					character.stats[stat] = value;
					return this.saveSetting(message.member, true, userSettings, true)
					.then(() => {
						return message.channel.send(`Great! ${character.name}’s ${stat} is now ${character.stats[stat]}`);
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
	
	command__characterdelete(params, message) {
		const name = params;
		const safeName = name.replace(/[^a-zA-Z0-9'’]+/g,' ');
		return this.getSetting(message.member, true)
		.then((userSettings) => {
			userSettings.characters = userSettings.characters || [];
			
			const chrNames = userSettings.characters.map(c => c.name);
			const fm = new FuzzyMatching(chrNames);
			const result = fm.get(name, { min: CharacterNameDistance });
			
			if(!result.value) {
				return message.channel.send(`I don’t believe I’ve met ${safeName}…`);
			}
			
			const idx = userSettings.characters.findIndex((c) => c.name === result.value);
			userSettings.characters.splice(idx, 1);
			
			// If they're currently that character. Forget about it.
			if(userSettings.currentCharacter === result.value) {
				delete userSettings.currentCharacter;
			}
			
			return this.saveSetting(message.member, true, userSettings, true)
			.then(() => {
				return message.channel.send(`Goodbye ${name}! It was nice knowing you.`);
			});
		});
	}
	
	command__currentcharacter(params, message) {
		const name = params.trim();
		const safeName = name.replace(/[^a-zA-Z0-9'’]+/g,' ');
		
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
			const result = fm.get(name, { min: CharacterNameDistance });
			
			if(!result.value && name !== '') {
				return message.channel.send(`I don’t believe I’ve met ${safeName}…`);
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
		return this.findUsers(params, message)
		.then((member) => {
			if(member && member.id) {
				return this.getSetting(member)
				.then((userData) => {
					if(!userData) {
						throw new Error();
					}
					
					let result = '';
					if(userData.currentCharacter) {
						result += `${member.displayName} is currently playing as ${userData.currentCharacter}.`;
					} else {
						result += `${member.displayName} is not currently playing as anyone.`;
					}
					
					const characterNames = (userData.characters || []).map(c => c.name)
					.filter(c => c !== userData.currentCharacter);
					if(characterNames.length) {
						result += `\nOther characters played by ${member.displayName}: ${characterNames.join(', ')}.`;
					}
					
					return message.channel.send(result);
				})
				.catch(() => {
					return message.channel.send(`**${member.displayName}:** An error occurred for that user.`);
				});
			} else {
				return message.channel.send(`**${member.displayName}:** I couldn’t find that user.`);
			}
		});
	}
};