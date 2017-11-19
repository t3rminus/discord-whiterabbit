'use strict';

const Bluebird = require('bluebird'),
	Discord = require('discord.js'),
	Redis = require('ioredis'),
	moment = require('moment-timezone'),
	FuzzyMatching = require('fuzzy-matching'),
	Misc = require('./misc'),
	FindTimeZone = require('./find-time-zone'),
	Spell5e = require('./spells-dnd5e');

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
	}
	
	command__whiterabbit(params, message) {
		return super.displayHelp(message, 'Oh dear! Oh dear! I shall be too late!');
	}
	
	command__whiterabbitcfg() {
	
	}

	/*
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
		if(!params.length) {
			return this.whiterabbitHelp(message);
		}
		
		params = params.trim().split(/(,\s*|\s+|;\s*)/);
		params = params.filter(p => p.length && !/^\s+$/.test(p) && !/^(\s+|,\s*|;\s*)$/.test(p));
		
		let handled = false;
		if(params[0] === 'config') {
			params.shift();
			return this.setConfig(params, message);
		}
		
		if(!handled) {
			return WhiteRabbit.snark(message);
		}
	}
	
	
	
	whiterabbitHelp(message) {
		return this.getServerSettings(message)
			.then((settings) => {
				const commandHelp = {
					'whiterabbit': {
						description: 'Get some help',
						ignorePrefix: true
					},
					'whiterabbit config': {
						description: 'Set a configuration value. Possible types are: `' + this.settingsWhitelist.join('`,`') + '`',
						args: ['type','newvalue'],
						ignorePrefix: true
					},
					'tz': {
						description: 'Set your local time zone',
						args: ['place']
					},
					'tzdelete': {
						description: 'Clear your local time zone',
					},
					'whenis': {
						description: 'Look up someone’s information. You can look up several people at once',
						args: ['name', '(…name)']
					},
					'roll': {
						description: 'Roll dice. You can roll several dice at once',
						args: ['#d# + #','(…#d# + #)']
					},
					'spell5e': {
						description: 'Look up a Dungeons & Dragons 5th Edition Spell',
						args: ['spell name']
					}
				};
				let reply = 'Oh dear! Oh dear! I shall be too late!';
				Object.keys(commandHelp).forEach((command) => {
					if(commandHelp[command].ignorePrefix) {
						reply += '\n\n • `?' + command + '` ';
					} else {
						reply += '\n\n • `' + settings.prefix + command + '` ';
					}
					if(commandHelp[command].args) {
						reply += commandHelp[command].args.map(a => '`' + a + '`').join(' ');
					}
					if(commandHelp[command].description) {
						reply += ' - ' + commandHelp[command].description;
					}
				});
				
				message.channel.send(reply);
			});
	}
	
	command__tz(params, message) {
		if(/^\s*$/.test(params)) {
			return WhiteRabbit.snark(message);
		}
		// Look up their timezone
		return FindTimeZone(params)
			.then((result) => {
				// Update global timezone list
				return this.manageTimezoneList(message.member, result)
					.then(() => {
						// Save the individual user's setting
						return this.saveSetting(message.member, true, result);
					})
					.then(() => {
						// Let them know what we found
						const reply = 'I’ll remember your info, so you’ll never be late!\n\n' +
							'**Your time zone:** ' + result.timezone + '\n' +
							'**Your local time:** ' + moment().tz(result.timezone).format('h:mma z');
						
						message.channel.send(reply);
					});
			})
			.catch(FindTimeZone.NoResultError, (err) => {
				message.channel.send(err.message);
			});
	}
	
	command__whenis(params, message) {
		params = params.trim();

		if(params.toLowerCase() === 'all' || params.toLowerCase() === 'everyone') {
			return this.whenisAll(message);
		}
		
		params = params.split(/(, ?| |; ?)/);
		params = params.filter(p => p.length && !/^\s+$/.test(p) && !/^(, ?| |; ?)$/.test(p));
		
		return this.getSetting(message.member)
			.then((myData) => {
				myData.user = message.member.id;
				return this.findUsers(params, message)
					.then((members) => {
						if(!members) {
							return WhiteRabbit.snark(message);
						}
						
						return Bluebird.map(members, (member) => {
							if(member && member.id) {
								return this.getSetting(member)
									.then((userData) => {
										userData.user = member.id;
										
										if(userData) {
											return this.generateMessage(member, userData, myData);
										} else {
											return '**' + member.displayName + ':** I couldn’t find that user’s data.';
										}
									})
									.catch(() => {
										return '**' + member.displayName + ':**  An error occurred for that user.'
									});
							} else {
								return '**' + member + ':** I couldn’t find that user.'
							}
						})
						.then((results) => {
							// If we have exactly 2 users, and every one was found
							if(members.length === 2 && members.every((m) => !!(m && m.id))) {
								return Bluebird.join(
									this.getSetting(members[0]),
									this.getSetting(members[1]),
									(data1, data2) => {
										if(data1 && data2) {
											const diff = WhiteRabbit.getTimezoneDifference(data1.timezone, data2.timezone);
											
											if (diff.difference === 0) {
												return members[0].displayName + ' is in the same time zone as ' +
													members[1].displayName;
											} else {
												return members[0].displayName + ' is ' +
													diff.formatted + ' ' + diff.plural + ' ' + diff.comparison + ' ' +
													members[1].displayName;
											}
										}
									})
									.then((text) => {
										if(text) {
											results.push(text);
										}
										return results;
									});
							}
							return results;
						})
						.then((results) => {
							message.channel.send(results.join('\n\n'));
						});
					});
			});
	}
	
	generateMessage(user, theirData, myData) {
		if (myData && myData.user !== theirData.user) {
			let result = '**' + user.displayName + ':** Their local time is ' + moment().tz(theirData.timezone).format('h:mma z') + '.';
			const diff = WhiteRabbit.getTimezoneDifference(theirData.timezone, myData.timezone);
			
			if (diff.difference === 0) {
				result += ' They are in the same time zone as you!';
			} else {
				result += ' They are ' + diff.formatted + ' ' + diff.plural + ' ' + diff.comparison + ' you.';
			}
			return result;
		} else if (myData && myData.user === theirData.user) {
			return '**' + user.displayName + ':** Your local time is ' + moment().tz(theirData.timezone).format('h:mma z') + '.'
		} else {
			return '**' + user.displayName + ':** Their local time is ' + moment().tz(theirData.timezone).format('h:mma z') + '.';
		}
	}
	
	whenisAll(message) {
		return this.getSetting(message.member, '-timezones')
			.then((data) => {
				const result = [];
				const timeMap = [];
				
				// Group same times together, even if they're not in the same timezone
				Object.keys(data).forEach((timezone) => {
					const userData = data[timezone];
					const timeKey = moment().tz(timezone).format('Hmm');
					const timeData = timeMap.find((o) => o.key === timeKey);
					if(timeData) {
						timeData.users = timeData.users.concat(userData.users);
						timeData.count += userData.count;
					} else {
						timeMap.push({
							key: timeKey,
							time: moment().tz(timezone).format('h:mma'),
							users: userData.users,
							count: userData.count
						});
					}
				});
				
				timeMap.sort((a,b) => (+a.key) - (+b.key));
				
				timeMap.forEach((timeEntry) => {
					const entryNames = timeEntry.users.slice(0,50);
					let resultMessage = '**' + timeEntry.time + ':** '
						+ (entryNames.map(u => message.guild.members.get(u))
							.filter(u => !!u).map(u => u.displayName).join(', '));
					
					if(entryNames.length !== timeEntry.count) {
						resultMessage += ' …and ' + (timeEntry.count - entryNames.length) + ' more';
					}
					
					result.push(resultMessage);
				});
				
				return result;
			})
			.then((results) => {
				message.channel.send(results.join('\n\n'));
			});
	}

	command__tzdelete(params, message) {
		return this.manageTimezoneList(message.member)
			.then(() => {
				// Delete the saved data
				return this.saveSetting(message.member, true, null, true)
					.then(() => {
						// Let the user know
						const reply = 'Poof! Your data is forgotten.';
						message.channel.send(reply);
					});
			});
	}

	manageTimezoneList(member, newData) {
		// Load global timezone list
		return this.getSetting(member, '-timezones')
			.then((data) => {
				data = data || {};
				Object.keys(data).forEach((tz) => {
					// Remove the user from any lists they were in before
					const oCount = data[tz].users.length;
					data[tz].users.forEach((id) => {
						if(!member.guild.members.get(id) || id === member.id.toString()) {
							Misc.arrayRemove(data[tz].users, id)
						}
					});
					
					// Update count if the user was removed
					if(oCount > data[tz].users.length) {
						data[tz].count -= (oCount - data[tz].users.length);
					}
					
					// Reset the count if we're below the limit. Otherwise data loss is acceptable.
					if(data[tz].users.length < 50) {
						data[tz].count = data[tz].users.length;
					}
					
					// Delete the timezone entirely if there are no more users registered
					if(!data[tz].users.length) {
						delete data[tz];
					}
				});
				
				if(newData && newData.timezone) {
					// Set-up the timezone list again if we need to
					data[newData.timezone] = data[newData.timezone] || { users: [], count: 0 };
					// If the list length is too long, don't add the user to it
					if(data[newData.timezone].users.length < 50) {
						data[newData.timezone].users.push(member.id.toString());
					}
					// Keep track of how many users in that timezone
					data[newData.timezone].count++;
				}
				
				// Save this!
				return this.saveSetting(member, '-timezones', data, true);
			});
	}
	
	
	
	command__spell5e(params, message) {
		const search = params.trim().toLowerCase().replace(/[^a-z0-9 \-'’]+/g, '');
		
		return Spell5e().then((spells) => {
			const fm = new FuzzyMatching(Object.keys(spells));
			const result = fm.get(search);
			
			if(result.distance < 0.5) {
				return message.channel.send('**' + search + ':** I couldn’t find a spell like that.');
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
				spellInfo.description += '\n\n[... snip ...]';
			}
			
			if(spellInfo.level === 0) {
				spellInfo.level = 'Cantrip'
			}

			const reply = new Discord.RichEmbed({
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
	
	
	
	
	static getTimezoneDifference(zone1, zone2) {
		const now = moment.utc();
		// get the zone offsets for this time, in minutes
		const offset1 = moment.tz.zone(zone1).offset(now);
		const offset2 = moment.tz.zone(zone2).offset(now);
		// calculate the difference in hours
		const hrDiff = (offset1 - offset2) / 60;
		const fmtDiff = Math.abs(hrDiff).toFixed(2).replace(/[0.]+$/, '');
		
		let comparison = 'the same as';
		if(hrDiff !== 0) {
			comparison = ((hrDiff < 0) ? 'ahead of' : 'behind');
		}
		
		return {
			difference: hrDiff,
			formatted: fmtDiff,
			plural: Math.abs(hrDiff) === 1 ? 'hour' : 'hours',
			comparison: comparison
		};
	}
	*/
}

module.exports = WhiteRabbit;