'use strict';

const Bluebird = require('bluebird'),
	Discord = require('discord.js'),
	Redis = require('ioredis'),
	moment = require('moment-timezone'),
	FuzzyMatching = require('fuzzy-matching'),
	DiceRoll = require('./dice-roll'),
	Misc = require('./misc'),
	FindTimeZone = require('./find-time-zone');

const prefix = '?';



class WhiteRabbit {
	constructor() {
		this.bot = new Discord.Client();
		this.db = new Redis(process.env.REDIS_URL);
		
		this.init();
		
		// Log errors
		this.bot.on('error', (err) => console.log(err));
		
		// Start the bot!
		this.bot.login(process.env.DISCORD_TOKEN);
	}
	
	init() {
		this.commands = [];
		Object.getOwnPropertyNames(WhiteRabbit.prototype).forEach((method) => {
			if(/^command__/.test(method)) {
				this.commands.push(method.replace(/^command__/, ''));
			}
		});
		
		this.phrases = {
			'phrase__jabberwocky': 'Callooh! Callay!'
			// TODO: Detect time, and convert to others
		};
		
		this.bot.on('message', (message) => this.handleMessage(this.bot, message));
		this.bot.on('ready', () => this.botReady(this.bot));
	}
	
	handleMessage(bot, message) {
		let handled = false;
		
		this.commands.forEach((command) => {
			// Match command at beginning of message
			const matchCmd = new RegExp('^' + Misc.escapeRegex(prefix + command) + '( |$)');
			if(matchCmd.test(message.content) && this['command__' + command]) {
				const params = message.content.replace(matchCmd, '');
				// Exec the command handler
				const result = this['command__' + command](params, message);
				handled = true;
				// If the returned value is promise-like
				// handle any errors to prevent uncaught promises
				if(result && result.catch) {
					result.catch((err) => { console.log(err) });
				}
			}
		});
		
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
		}
	}
	
	botReady(bot) {
		// Track ready functions
		const readyTracker = [];
		
		// Set status message for help
		readyTracker.push(bot.user.setGame('?whiterabbit for help'));
		
		// If we're doing production stuff
		if(process.env.NODE_ENV !== 'dev') {
			// Update the avater
			readyTracker.push(bot.user.setAvatar('./whiterabbit.jpg'));
			
			// Loop through all servers (guilds) the bot is on, and set the nickname.
			bot.guilds.forEach((guild) => {
				readyTracker.push(Bluebird.try(() => {
					const member = guild.members.get(bot.user.id);
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
				console.log('Logged & ready in as %s - %s\n', bot.user.username, bot.user.id);
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
		const commandHelp = {
			'whiterabbit': 'Get some help',
			'tz place': 'Set your local time zone',
			'tzdelete': 'Clear your local time zone',
			'whenis name': 'Look up someone’s information. You can look up several people at once',
			'roll #d#+#': 'Roll dice. You can roll several dice at once'
		};
		let reply = 'Oh dear! Oh dear! I shall be too late!';
		Object.keys(commandHelp).forEach((command) => {
			reply += '\n\n • `' + prefix + command + '` - ' + commandHelp[command];
		});
		
		message.channel.send(reply);
	}
	
	command__tz(params, message) {
		if(/^\s*$/.test(params)) {
			return this.snark(message);
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
		params = params.replace(/(^\s+|\s+$)/,'');

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
							return this.snark(message);
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
					let resultMessage = '**' + timeEntry.time + ':** '
						+ (timeEntry.users.map(u => message.guild.members.get(u))
							.filter(u => !!u).map(u => u.displayName).join(', '));
					
					if(timeEntry.count > 50) {
						resultMessage += ' …and ' + (timeEntry.users.length - 50) + ' more';
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
	
	command__roll(params, message) {
		Bluebird.try(() => {
			const diceResult = DiceRoll(params);
			
			if(!diceResult || !diceResult.dice || !diceResult.dice.length) {
				return this.snark(message);
			}
			
			let resultMessage = '';
			const singleDie = diceResult.dice[0];
			
			diceResult.dice.forEach((die) => {
				resultMessage += 'Rolled ' + die.count + 'd' + die.max
					+ ': ' + die.results.join(', ');
				if(die.modifier !== null) {
					resultMessage += ' (with ' + ((die.modifier > 0) ? '+' : '-') + Math.abs(die.modifier) + ')' +
						' = **' + (die.modifier + die.total) + '**';
				} else if(die.count > 1) {
					resultMessage += ' = **' + die.total + '**';
				}
				resultMessage += '\n';
			});
			
			if(diceResult.dice.length > 1) {
				if(diceResult.modifierTotal !== null) {
					resultMessage += 'Final total: **' + (diceResult.total + diceResult.modifierTotal) + '**'
						+ ' (**' + diceResult.total + '** without modifiers)';
				} else {
					resultMessage += 'Final total: **' + diceResult.total + '**';
				}
			} else if(diceResult.dice.length === 1 && singleDie.count === 1 && singleDie.total === singleDie.max) {
				resultMessage = 'Rolled 1d' + singleDie.max + ': **' + singleDie.total+'**! CRITICAL HIT! :tada: :confetti_ball:';
				if(singleDie.modifier) {
					resultMessage += '  ' + singleDie.total + ' with ' +
						((singleDie.modifier > 0) ? '+' : '-') + Math.abs(singleDie.modifier) +
						' = **' + (singleDie.total + singleDie.modifier) + '**';
				}
			} else if(diceResult.dice.length === 1 && singleDie.count === 1 && singleDie.total === 1) {
				resultMessage = 'Rolled 1d' + singleDie.max + ': **1** …critical failure :confounded:\n';
				if(singleDie.modifier) {
					resultMessage += '  ' + singleDie.total + ' with ' + ((singleDie.modifier > 0) ? '+' : '-') +
						Math.abs(singleDie.add) + ' = **' + (singleDie.total + singleDie.modifier) + '**';
				}
			}
			
			
			message.channel.send(resultMessage);
		})
		.catch((err) => {
			return this.snark(message);
		});
	}
	
	isAdmin(user, message) {
	
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
				if(member.nickname && !userMap[member.nickname]) {
					userMap[member.nickname] = member;
				}
				// Username
				if(!userMap[member.user.username]) {
					userMap[member.user.username] = member;
				}
				// Flat mention
				const mentionName = '@' + member.user.username + '#' + member.user.discriminator;
				if(!userMap[mentionName]) {
					userMap[mentionName] = member;
				}
				// Reference mention
				if(!userMap['<@!' + member.id + '>']) {
					userMap['<@!' + member.id + '>'] = member;
				}
			});
			
			const fm = new FuzzyMatching(Object.keys(userMap));
			search = search.map((p) => {
				const result = fm.get(p);
				if(result && result.value && userMap[result.value]) {
					return userMap[result.value];
				}
				
				return p;
			});
			
			return plural ? search : search[0];
		});
	}
	
	getSetting(member, key) {
		return Bluebird.try(() => {
			const dataKey = WhiteRabbit.getDataKey(member, key);
			if(!dataKey) {
				return null;
			}
			
			return this.db.get(dataKey)
				.then(JSON.parse)
				.catch(() => null);
		});
	}
	
	saveSetting(member, key, settings, overwrite) {
		return Bluebird.try(() => {
			const dataKey = WhiteRabbit.getDataKey(member, key);
			if (!dataKey) {
				return null;
			}
			
			if (overwrite) {
				if (settings === null) {
					return this.db.del(dataKey);
				} else {
					return this.db.set(dataKey, JSON.stringify(settings));
				}
			} else {
				return this.getSetting(dataKey, key)
				.then((oldSettings) => {
					oldSettings = oldSettings || {};
					settings = Object.assign(oldSettings, settings);
					
					return this.db.set(dataKey, JSON.stringify(settings));
				});
			}
		});
	}
	
	static snark(message) {
		const snark = ['I beg your pardon?', 'Hmm?', 'Pardon me?', 'Very sorry!', 'Wot’s this?', 'Oh dear…'];
		const which = Math.round(Math.random() * (snark.length - 1));
		message.channel.send(snark[which]);
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
	
	// TODO: Make this server-specific
	static getAuthor(message) {
		return message.author.username + '#' + message.author.discriminator;
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
}

module.exports = WhiteRabbit;