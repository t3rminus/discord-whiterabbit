'use strict';
const pr = require('request-promise'),
	moment = require('moment-timezone'),
	geolib = require('geolib'),
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

module.exports = (BotBase) =>
	class LocationMixin extends BotBase {
		constructor() {
			super();

			this.commands['place'] = {
				helpText: 'Set your location. `place` is the city or country where you live.',
				args: ['city'],
				method: 'command__place',
				parseParams: false,
				sort: 13
			};

			this.commands['placedelete'] = {
				helpText: 'Clear your location information.',
				method: 'command__placeDelete',
				parseParams: false,
				sort: 14
			};

			this.commands['whereis'] = {
				helpText: 'Look up someone’s information. You can look up several people at once.',
				args: ['name', '(…name)'],
				method: 'command__whereIs',
				parseParams: false,
				sort: 15
			};

			// this.bot.on('guildMemberRemove', this.plHandleLeave.bind(this));
		}

		async command__place(params, message) {
			if(/^\s*$/.test(params)) {
				return this.fail(message);
			}

			try {
				// Lookup location
				const location = await LocationMixin.LookupLocation(params);

				// Save it
				const serverSettings = await this.getSetting(message.member, '-location');
				serverSettings[message.member.id] = location;
				await this.saveSetting(message.member, '-location', serverSettings, true);

				// Let them know!
				const reply = 'I’ll remember your info, so you’ll never be lost!\n\n' +
					`**Your location:** ${location.formatted}\n`;
				return message.channel.send(reply);
			} catch(err) {
				if(err instanceof NoResultError) {
					return message.channel.send(err.message);
				}
				throw err;
			}
		}

		async command__placeDelete(params, message) {
			const serverSettings = await this.getSetting(message.member, '-location');
			delete serverSettings[message.member.id];
			await this.saveSetting(message.member, '-location', serverSettings, true);
			return message.channel.send('Poof! Your data is forgotten.');
		}

		async command__whereIs(params, message) {
			if(params.toLowerCase() === 'all' || params.toLowerCase() === 'everyone') {
				return this.whereIsAll(message);
			}

			params = Misc.tokenizeString(params);

			const locations = await this.getSetting(message.member, '-location');
			const myData = locations && locations[message.member.id];

			const allUsers = await this.findUsers(params, message);
			const users = allUsers.filter(m => !m.user.bot);
			const bots = allUsers.filter(m => m.user.bot);

			bots.forEach(b => {
				locations[b] = {
					
				}
			});


			return this.getSetting(message.member)
				.then((myData) => {
					if(myData) {
						// Current info
						myData.user = message.member.id;
					}

					// Map all the searched names to users
					return this.findUsers(params, message)
						.then((members) => {
							if(!members) {
								return this.fail(message);
							}

							// For each member, figure out who they are and look up their info
							return Bluebird.map(members, (member) => {
								if(member && member.id === this.bot.user.id) {
									const userData = {
										user: member.id,
										timezone: 'Europe/Wonderland',
										isBot: true
									};
									return TimezoneMixin.whenIsMessage(member, userData, myData);
								} else if(member && member.id) {
									// Get the user's info
									return this.getSetting(member)
										.then((userData) => {
											// Show a message for them
											if(userData) {
												userData.user = member.id;
												return TimezoneMixin.whenIsMessage(member, userData, myData);
											} else {
												return `**${member.displayName}:** I couldn’t find that user’s data.`;
											}
										})
										.catch(() => {
											return `**${member.displayName}:**  An error occurred for that user.`;
										});
								} else {
									return `**${member}:** I couldn’t find that user.`;
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
													const diff = TimezoneMixin.getTimezoneDifference(data1.timezone, data2.timezone);

													if (diff.difference === 0) {
														// Same time zone
														return `${members[0].displayName} is in the ` +
															`same time zone as ${members[1].displayName}`;
													} else {
														// Different time zone
														return `${members[0].displayName} is ${diff.formatted} ` +
															`${diff.plural} ${diff.comparison} ${members[1].displayName}`;
													}
												}
											})
											.then((text) => {
												// Add it to the results
												if(text) {
													results.push(text);
												}
												return results;
											});
									}
									return results;
								})
								.then((results) => {
									// Join all results with newlines, and print the message
									message.channel.send(results.join('\n\n'));
								});
						});
				});
		}

		whereisAll(message) {
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

		static whereIsMessage(user, theirData, myData) {
			if(theirData.isBot) {
				const time = BOT_TIMEZONE[Math.floor(Math.random() * BOT_TIMEZONE.length)];
				return `**${user.displayName}:** Their local time ${time}`;
			} else if (myData && myData.user !== theirData.user) {
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

		manageLocationList(member, newData) {
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

		plHandleLeave(member) {
			return this.manageLocationList(member);
		}  */

		static async LookupLocation(place) {
			const result = JSON.parse(await pr('https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(place)));
			if (result.status !== 'OK' || !result.results || !result.results[0]) {
				throw new NoResultError('Could not find that location');
			}

			const {results: [firstResult = { address_components: [] }] = []} = result;

			let city = firstResult.address_components.find(c => c.types.includes('locality')) || null;
			let province = firstResult.address_components.find(c => c.types.includes('administrative_area_level_1')) || null;
			let country = firstResult.address_components.find(c => c.types.includes('country')) || null;

			city = city && city.long_name;
			province = province && province.short_name;
			country = country && country.long_name;

			if(!country) {
				throw new NoResultError('Could not find that location');
			}

			return {
				lat: firstResult.geometry.location.lat,
				lon: firstResult.geometry.location.lng,
				city, province, country,
				formatted: [city,province,country].filter(i => i).join(', ')
			};
		}

		/*
		static getLocationDifference(zone1, zone2) {
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
		*/
	};
