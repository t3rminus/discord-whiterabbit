'use strict';
const Path = require('path'),
	pr = require('request-promise'),
	fs = require('fs-extra'),
	FuzzyMatching = require('fuzzy-matching');

const SRC_URL = 'https://raw.githubusercontent.com/astranauta/astranauta.github.io/master/data/spells.json';
const localFile = Path.join(process.cwd(), 'spells.json');

const schools = {
	N: {
		name: 'Necromancy',
		icon: 'https://media-waterdeep.cursecdn.com/attachments/2/720/necromancy.png'
	},
	A: {
		name: 'Abjuration',
		icon: 'https://media-waterdeep.cursecdn.com/attachments/2/707/abjuration.png'
	},
	C: {
		name: 'Conjuration',
		icon: 'https://media-waterdeep.cursecdn.com/attachments/2/708/conjuration.png'
	},
	EV: {
		name: 'Evocation',
		icon: 'https://media-waterdeep.cursecdn.com/attachments/2/703/evocation.png'
	},
	T: {
		name: 'Transmutation',
		icon: 'https://media-waterdeep.cursecdn.com/attachments/2/722/transmutation.png'
	},
	EN: {
		name: 'Enchantment',
		icon: 'https://media-waterdeep.cursecdn.com/attachments/2/702/enchantment.png'
	},
	I: {
		name: 'Illusion',
		icon: 'https://media-waterdeep.cursecdn.com/attachments/2/704/illusion.png'
	},
	D: {
		name: 'Divination',
		icon: 'https://media-waterdeep.cursecdn.com/attachments/2/709/divination.png'
	}
};

let spellCache;

module.exports = (BotBase) =>
class DnDSpellMixin extends BotBase {
	constructor() {
		super();
		
		this.commands['spell5e'] = {
			helpText: 'Look up a Dungeons & Dragons 5th Edition Spell',
			args: ['spellname'],
			method: 'command__spell5e',
			parseParams: false,
			sort: 100
		};
	}
	
	command__spell5e(params, message) {
		const search = params.trim().toLowerCase().replace(/[^a-z0-9 \-'’]+/g, '');
		
		return DnDSpellMixin.getSpellInfo().then((spells) => {
			const fm = new FuzzyMatching(Object.keys(spells));
			const result = fm.get(search);
			
			if(result.distance < 0.5) {
				return message.channel.send(`**${search}:** I couldn't find a spell like that.`);
			}
			
			let spellInfo = spells[result.value];
			
			if(spellInfo.components) {
				if(spellInfo.components.material && spellInfo.components.material.length) {
					spellInfo.description += '\n\nMaterial Components Required: '+spellInfo.components.material;
				}
			}
			
			if(spellInfo.description.length > 1600) {
				while(spellInfo.description.length > 1600) {
					const lastIndex = spellInfo.description.lastIndexOf('\n\n');
					spellInfo.description = spellInfo.description.slice(0, lastIndex);
				}
				spellInfo.description += '\n\n[... too long for display ...]';
			}
			
			if(spellInfo.level === 0) {
				spellInfo.level = 'Cantrip'
			}
			
			const reply = new BotBase.Discord.RichEmbed({
				title: spellInfo.ritual ? spellInfo.name + ' (Ritual)' : spellInfo.name,
				description: spellInfo.description,
				thumbnail: {
					url: spellInfo.icon,
					width: 128, height: 128
				},
				fields: [
					{ name: "Casting Time", value: spellInfo.castingTime, inline: true },
					{ name: "Duration", value: spellInfo.duration, inline: true },
					{ name: "Range", value: spellInfo.range, inline: true },
					
					{ name: "Components", value: spellInfo.stringComponents.replace(/\s*\([^)]+\)\s*$/,''), inline: true },
					{ name: "Level", value: spellInfo.level, inline: true },
					{ name: "School of Magic", value: spellInfo.school, inline: true },
				],
				footer: {
					text: `Classes: ${spellInfo.classes.join(', ')}`
				}
			});
			
			return message.channel.send({ embed: reply });
		});
	}
	
	static getSpellInfo() {
		if(!spellCache) {
			spellCache = fs.readFile(localFile)
			.catch(() => {
				return pr.get(SRC_URL)
				.then((result) => {
					result = result.replace(/^.+{/, '{');
					return fs.writeFile(localFile, result)
					.then(() => result);
				});
			})
			.then(JSON.parse);
		}
		
		return spellCache.then((spells) => {
			if(spells.compendium && spells.compendium.spell) {
				spells = spells.compendium.spell;
			}
			
			spells = spells.reduce((out, spell) => {
				// Generate a slug for this spell
				const slug = spell.name.toLowerCase()
				.replace(/'/g,'')
				.replace(/(^[^a-z]+|[^a-z]+$)/g,'')
				.replace(/[^a-z]+/g,'-');
				
				// Get components into a usable format
				let components = { verbal: false, somatic: false, material: false };
				if(spell.components) {
					const tmpComponents = spell.components.split('(');
					components.verbal = tmpComponents[0].indexOf('V') > -1;
					components.somatic = tmpComponents[0].indexOf('S') > -1;
					components.material = tmpComponents[0].indexOf('M') > -1;
					if(tmpComponents[1]) {
						components.material = tmpComponents[1].replace(/\)$/,'').trim();
					}
				}
				
				// Preserve bulleted list spacing,
				// but add additional newlines before all paragraphs
				let description = [];
				if(spell.text) {
					if(!Array.isArray(spell.text)) {
						spell.text = [spell.text];
					}
					description = spell.text.map((t, i) => {
						// Skip invalid values
						if(!t.trim) {
							return null;
						}
						// Trim the string
						t = t.trim();
						
						// Not first entry, or bulleted entry, add extra newline
						// at beginning
						if(i > 0 && t.indexOf('•') !== 0) {
							t = '\n' + t;
						}
						return t;
					}).filter(t => t !== null);
				}
				
				// Format output
				out[slug] = {
					name: spell.name,
					description: description.join('\n'),
					slug: slug,
					level: +spell.level,
					castingTime: spell.time,
					classes: spell.classes.split(',').map(s => s.trim()),
					duration: spell.duration,
					stringComponents: spell.components,
					components: components,
					range: spell.range,
					school: schools[spell.school].name,
					icon: schools[spell.school].icon,
					ritual: spell.ritual === 'YES'
				};
				
				return out;
			}, {});
			
			return spells;
		});
	}
};