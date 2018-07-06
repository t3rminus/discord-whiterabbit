const dnd5eModifier = (val) => Math.floor((val - 10) / 2);

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
				abbrev: 'Level',
				alias: ['lvl'],
				calc: (character) => {
					if(!character || !character.stats || !character.stats.exp) {
						return null;
					}
					const exp = [0,300,900,2700,6500,14000,23000,34000,48000,64000,85000,
								 100000,120000,140000,165000,195000,225000,265000,305000,355000,Infinity];
					const level = exp.findIndex((i) => character.stats.exp < i);
					return Math.max(level, 1) || null;
				}
			},
			'proficiency': {
				name: 'Proficiency',
				abbrev: 'Proficiency',
				alias: ['prof','pro','pr'],
				calc: (character) => {
					const level = CharacterTemplates['d&d5e'].derivedStats.level.calc(character);
					if(level === null) {
						return null;
					}
					
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
			},
			'initiative': {
				name: 'Initiative',
				abbrev: 'Initiative',
				alias: ['init'],
				calc: (character) => {
					if(character.stats && character.stats.dex) {
						return CharacterTemplates['d&d5e'].stats.dex.calc(character.stats.dex);
					} else {
						return null;
					}
				}
			},
			'passive_perception': {
				name: 'Passive Perception',
				abbrev: 'Passive Perception',
				calc: (character) => {
					if(character.stats && character.stats.wis) {
						return 10 + CharacterTemplates['d&d5e'].stats.wis.calc(character.stats.wis);
					} else {
						return null;
					}
				}
			}
		}
	}
};

module.exports = CharacterTemplates;