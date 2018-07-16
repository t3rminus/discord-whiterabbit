'use strict';
const pr = require('request-promise'),
	moment = require('moment-timezone'),
	geolib = require('geolib'),
	Bluebird = require('bluebird'),
	{ crc32 } = require('crc'),
	Misc = require('../lib/misc');

const unixTimestamp = function(date) {
	date = date || new Date();
	// date.getTime in MS, | 0 truncates integer
	return (date.getTime() / 1000) | 0;
};

const birmingham = { latitude: 52.4774169, longitude: -1.9336706 };

const formatNumber = (num, p = 2, d = 0, x = 3) => {
	const re = '\\d(?=(\\d{' + x + '})+' + (d > 0 ? '\\.' : '$') + ')';
	return (~~num.toPrecision(p)).toFixed(Math.max(0, ~~d)).replace(new RegExp(re, 'g'), '$&,');
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

			this.bot.on('guildMemberRemove', this.plHandleLeave.bind(this));
		}

		async command__place(params, message) {
			if(/^\s*$/.test(params)) {
				return this.fail(message);
			}

			try {
				// Lookup location
				const location = await LocationMixin.LookupLocation(params);

				// Save it
				const serverSettings = await this.getSetting(message.member, '-location') || {};
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
			const serverSettings = await this.getSetting(message.member, '-location') || {};
			delete serverSettings[message.member.id];
			await this.saveSetting(message.member, '-location', serverSettings, true);
			return message.channel.send('Poof! Your data is forgotten.');
		}

		async command__whereIs(params, message) {
			if(params.toLowerCase() === 'all' || params.toLowerCase() === 'everyone') {
				return this.whereIsAll(message);
			}

			params = Misc.tokenizeString(params);

			const userSettings = await this.getSetting(message.member, true);
			const locations = await this.getSetting(message.member, '-location') || {};
			const myData = locations && locations[message.member.id];

			const users = await this.findUsers(params, message);
			
			users.filter(m => m && m.user && m.user.bot).forEach(b => {
				const wonderland = geolib.computeDestinationPoint(birmingham, Math.random() * 200000, Math.random() * 360);
				locations[b.user.id] = {
					latitude: wonderland.latitude,
					longitude: wonderland.longitude,
					city: 'Wonderland',
					province: null,
					country: 'United Kingdom',
					formatted: 'Wonderland, United Kingdom'
				};
			});
			
			const results = users.map(member => {
				if(member && member.id) {
					if(locations && locations[member.user.id]) {
						if(myData) {
							const distance = Math.round(geolib.getDistanceSimple(locations[member.user.id], myData) / 1000);
							const displayDistance = userSettings && userSettings.units === 'imperial'
								? `${formatNumber(distance / 1.609344)} miles`
								: `${formatNumber(distance)} km`;
							return `**${member.displayName}:** is in ${locations[member.user.id].formatted}. They are ${displayDistance} away from you.`;
						} else {
							return `**${member.displayName}:** is in ${locations[member.user.id].formatted}`;
						}
					} else {
						return `**${member.displayName}:** I couldn’t find that user’s data.`;
					}
				} else {
					return `**${this.sanitize(member, message)}:** I couldn’t find that user.`;
				}
			}).filter(m => m);
			
			if(users.length === 2) {
				if(locations && locations[users[0].user.id] && locations[users[1].user.id]) {
					const distance = Math.round(geolib.getDistanceSimple(locations[users[0].user.id], locations[users[1].user.id]) / 1000);
					
					const displayDistance = userSettings && userSettings.units === 'imperial'
						? `${formatNumber(distance / 1.609344)} miles`
						: `${formatNumber(distance)} km`;
					
					if(distance < 100) {
						results.push(`${users[0].displayName} is in the same place as ${users[1].displayName}`);
					} else {
						results.push(`${users[0].displayName} is ${displayDistance} away from ${users[1].displayName}`);
					}
				}
			}
			
			// Join all results with newlines, and print the message
			return message.channel.send(results.join('\n\n'));
		}
		
		async whereIsAll(message) {
			const locations = await this.getSetting(message.member, '-location') || {};
			const summary = [];
			const markers = [];
			
			Object.keys(locations).forEach(id => {
				const country = locations[id].country || 'Unknown';
				const theCountry = summary.find(s => s.country === country);
				if(theCountry) {
					theCountry.count++;
				} else {
					summary.push({ country, count: 1 });
				}

				let color = message.member.guild.members.get(id).displayHexColor;
				color = color.replace(/^#/,'');
				if(color === '000000') {
					color = '7289DA';
				}
				markers.push(`size:tiny%7Ccolor:0x${color.toUpperCase()}%7C${locations[id].latitude},${locations[id].longitude}`);
			});
			
			summary.sort((a,b) => a.country.localeCompare(b.country));
			const result = summary.map(s => `**${s.country}:** ${s.count} member${s.count > 1 ? 's' : ''}`).join('\n')
				|| 'Nobody has saved their locations yet!';
			
			const markerStr = markers.map(m => `&markers=${m}`).join('');
			const gmap = `https://maps.googleapis.com/maps/api/staticmap?center=0,0&scale=2&zoom=1&size=600x380${markerStr}`;
			const crc = crc32(markerStr).toString(16);
			
			return message.channel.send(result, new BotBase.Discord.Attachment(gmap,`map${crc}.png`));
		}
		
		async plHandleLeave(member) {
			const serverSettings = await this.getSetting(member, '-location') || {};
			delete serverSettings[member.id];
			return this.saveSetting(member, '-location', serverSettings, true);
		}

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
				latitude: firstResult.geometry.location.lat,
				longitude: firstResult.geometry.location.lng,
				city, province, country,
				formatted: [city,province,country].filter(i => i).join(', ')
			};
		}
	};
