'use strict';
const pr = require('request-promise'),
	moment = require('moment-timezone'),
	Bluebird = require('bluebird'),
	Misc = require('../lib/misc');

const unixTimestamp = function(date) {
	date = date || new Date();
	// date.getTime in MS, | 0 truncates integer
	return (date.getTime() / 1000) | 0;
};

class NoResultError extends Error {
	constructor(message) {
		super(message);
		this.name = this.constructor.name;
		Error.captureStackTrace(this, this.constructor);
	}
}

const BOT_TIMEZONE = [
	'is behind schedule.',
	'is happening presently.',
	'flows slightly slower than usual.',
	'runs faster than you might expect.',
	'might be getting away from them.',
	'is exactly π minutes later than now.',
	'is half-past teatime.',
	'keeps on slippin\'... slippin\'...slippin\'.',
	'couldn\'t be the slightest bit less important.',
	'... Oh goodness! I\'m late!',
	'is difficult to measure.',
	'is being enjoyed to the fullest.',
	'is not being wasted.',
	'is a sight to behold.',
	'is purple.',
	'smells like cherries.',
	'is like a big ball of wibbly-wobbly, timey-wimey... stuff.',
	'is 27:82 -∞',
	'is bigger than a breadbox.'
];

module.exports = (BotBase) =>
class TimezoneMixin extends BotBase {
	constructor() {
		super();
		
		this.commands['tz'] = {
			helpText: 'Set your local time zone. `place` is your address or a nearby city.',
			args: ['place'],
			method: 'command__tz',
			parseParams: false,
			sort: 10
		};
		
		this.commands['tzdelete'] = {
			helpText: 'Clear your time zone information.',
			method: 'command__tzDelete',
			parseParams: false,
			sort: 11
		};
		
		this.commands['whenis'] = {
			helpText: 'Look up someone’s information. You can look up several people at once.',
			args: ['name', '(…name)'],
			method: 'command__whenIs',
			parseParams: false,
			sort: 12
		};

		this.bot.on('guildMemberRemove', this.tzHandleLeave.bind(this));
	}
	
	command__tz(params, message) {
		if(/^\s*$/.test(params)) {
			return this.fail(message);
		}
		
		// Look up their timezone
		return TimezoneMixin.LookupTimezone(params)
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
					`**Your time zone:** ${result.timezone}\n` +
					`**Your local time:** ${moment().tz(result.timezone).format('h:mma z')}`;
				
				message.channel.send(reply);
			});
		})
		.catch(NoResultError, (err) => {
			message.channel.send(err.message);
		});
	}
	
	command__tzDelete(params, message) {
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
	
	async command__whenIs(params, message) {
		params = this.sanitize(params.trim(), message);
		
		if(params.toLowerCase() === 'all' || params.toLowerCase() === 'everyone') {
			return this.whenisAll(message);
		}
		params = Misc.tokenizeString(params).map(p => p.trim()).filter(p => p);
		
		const myData = await this.getSetting(message.member);
		if (myData) {
			// Current info
			myData.user = message.member.id;
		}
		
		const members = await this.findUsers(params, message);
		if(!members) {
			return this.fail(message);
		}
		
		const infoResult = members.map(async (member) => {
			if(member && member.id === this.bot.user.id) {
				const userData = {
					user: member.id,
					timezone: 'Europe/Wonderland',
					isBot: true
				};
				return TimezoneMixin.whenIsMessage(member, userData, myData);
			} else if(member && member.id) {
				// Get the user's info
				try {
					const userData = await this.getSetting(member);
					// Show a message for them
					if(userData && userData.timezone) {
						userData.user = member.id;
						return TimezoneMixin.whenIsMessage(member, userData, myData);
					} else {
						return `**${member.displayName}:** I couldn’t find that user’s data.`;
					}
				} catch(err) {
					return `**${member.displayName}:**  An error occurred for that user.`;
				}
			} else {
				return `**${this.sanitize(member, message)}:** I couldn’t find that user.`;
			}
		})
		
		// For each member, figure out who they are and look up their info
		const results = await Promise.all(infoResult);
		
		// If we have exactly 2 users, and every one was found
		if(members.length === 2 && members.every((m) => !!(m && m.id))) {
			const data1 = await this.getSetting(members[0]);
			const data2 = await this.getSetting(members[1]);
			
			if(data1 && data1.timezone && data2 && data2.timezone) {
				const diff = TimezoneMixin.getTimezoneDifference(data1.timezone, data2.timezone);
				
				if (diff.difference === 0) {
					// Same time zone
					results.push(`${members[0].displayName} is in the ` +
						`same time zone as ${members[1].displayName}`);
				} else {
					// Different time zone
					results.push(`${members[0].displayName} is ${diff.formatted} ` +
						`${diff.plural} ${diff.comparison} ${members[1].displayName}`);
				}
			}
		}
		
		// Join all results with newlines, and print the message
		return message.channel.send(results.join('\n\n'));
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
	
	static whenIsMessage(user, theirData, myData) {
		if(theirData.isBot) {
			const time = BOT_TIMEZONE[Math.floor(Math.random() * BOT_TIMEZONE.length)];
			return `**${user.displayName}:** Their local time ${time}`;
		} else if (myData && myData.timezone && myData.user !== theirData.user) {
			let result = `**${user.displayName}:** Their local time is ${moment().tz(theirData.timezone).format('h:mma z')}.`;
			const diff = TimezoneMixin.getTimezoneDifference(theirData.timezone, myData.timezone);
			
			if (diff.difference === 0) {
				result += ' They are in the same time zone as you!';
			} else {
				result += ` They are ${diff.formatted} ${diff.plural} ${diff.comparison} you.`;
			}
			return result;
		} else if (myData && myData.user === theirData.user) {
			return `**${user.displayName}:** Your local time is ${moment().tz(theirData.timezone).format('h:mma z')}.`
		} else {
			return `**${user.displayName}:** Their local time is ${moment().tz(theirData.timezone).format('h:mma z')}.`;
		}
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

	tzHandleLeave(member) {
		return this.manageTimezoneList(member);
	}
	
	static LookupTimezone(place) {
		let address, location;
		return pr('https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(place))
		.then(JSON.parse)
		.then((result) => {
			if (result.status !== 'OK' || !result.results || !result.results[0]) {
				throw new NoResultError('Could not find that location');
			}
			
			result = result.results[0];
			address = result.formatted_address;
			location = result.geometry.location;
			
			const curTime = unixTimestamp();
			return pr('https://maps.googleapis.com/maps/api/timezone/json?timestamp=' +
				encodeURIComponent(curTime) + '&location=' +
				encodeURIComponent(location.lat) + ',' + encodeURIComponent(location.lng))
			
			.then(JSON.parse)
			.then((tzResult) => {
				if (!tzResult || tzResult.status !== 'OK' || !tzResult.timeZoneId) {
					throw new NoResultError('Could not find that location’s time zone');
				}
				
				return {
					timezone: tzResult.timeZoneId
				};
			});
		});
	}
	
	static getTimezoneDifference(zone1, zone2) {
		const now = moment.utc();
		// get the zone offsets for this time, in minutes
		const offset1 = moment.tz.zone(zone1).offset(now);
		const offset2 = moment.tz.zone(zone2).offset(now);
		// calculate the difference in hours
		const hrDiff = (offset1 - offset2) / 60;
		const fmtDiff = Math.abs(hrDiff).toFixed(2).replace(/\.([1-9]+)0+$/,'.$1').replace(/\.0+$/, '');
		
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
};