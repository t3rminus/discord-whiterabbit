'use strict';

const pr = require('request-promise'),
	moment = require('moment-timezone');

module.exports = {
	VERSE: [
		'`Twas brillig, and the slithy toves\n  Did gyre and gimble in the wabe:\nAll mimsy were the borogoves,\n  And the mome raths outgrabe.',
		'"Beware the Jabberwock, my son!\n  The jaws that bite, the claws that catch!\nBeware the Jubjub bird, and shun\n  The frumious Bandersnatch!"',
		'He took his vorpal sword in hand:\n  Long time the manxome foe he sought --\nSo rested he by the Tumtum tree,\n  And stood awhile in thought.',
		'And, as in uffish thought he stood,\n  The Jabberwock, with eyes of flame,\nCame whiffling through the tulgey wood,\n  And burbled as it came!',
		'One, two! One, two! And through and through\n  The vorpal blade went snicker-snack!\nHe left it dead, and with its head\n\  He went galumphing back.',
		'"And, has thou slain the Jabberwock?\n  Come to my arms, my beamish boy!\nO frabjous day! Callooh! Callay!"\n  He chortled in his joy.'
	],
	lookupCity: function lookupCity(city) {
		let address, location;
		return pr('https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(city))
		.then(JSON.parse)
		.then((result) => {
			if (result.status !== 'OK' || !result.results || !result.results[0]) {
				throw new Error('An error occurred looking up that city.');
			}
			
			result = result.results[0];
			address = result.formatted_address;
			location = result.geometry.location;
			
			const curTime = moment().unix();
			return pr('https://maps.googleapis.com/maps/api/timezone/json?timestamp=' +
				encodeURIComponent(curTime) + '&location=' +
				encodeURIComponent(location.lat) + ',' + encodeURIComponent(location.lng))
			.then(JSON.parse)
			.then((tzResult) => {
				if (!tzResult || tzResult.status !== 'OK' || !tzResult.timeZoneId) {
					throw new Error('An error occurred looking up that time zone.');
				}
				
				return {
					address: address,
					timezone: tzResult.timeZoneId,
					offset: tzResult.rawOffset
				};
			});
		});
	},
	generateMessage: function generateMessage(nick, theirData, myData) {
		if (myData && myData.user !== theirData.user) {
			let result = nick + ': Their local time is ' + moment().tz(theirData.timezone).format('h:mm a z');
			
			// get the current time so we know which offset to take (DST is such bullkitten)
			const now = moment.utc();
			// get the zone offsets for this time, in minutes
			const theirOffset = moment.tz.zone(theirData.timezone).offset(now);
			const yourOffset = moment.tz.zone(myData.timezone).offset(now);
			// calculate the difference in hours
			const hrDiff = (theirOffset - yourOffset) / 60;
			
			//const hrDiff = ((theirData.offset - myData.offset) / 3600),
			const fmtDiff = Math.abs(hrDiff).toFixed(2).replace(/[0.]+$/, '');
			if (hrDiff === 0) {
				result += '\nThey are in the same time zone as you!';
			} else {
				result += '\nThey are ' + fmtDiff + ' hour' + (fmtDiff === '1' ? '' : 's') + ' ' + ((hrDiff < 0) ? 'ahead of' : 'behind') + ' you';
			}
			return result;
		} else if (myData && myData.user === theirData.user) {
			return nick + ': Your local time is ' + moment().tz(theirData.timezone).format('h:mm a z')
		} else {
			return nick + ': Their local time is ' + moment().tz(theirData.timezone).format('h:mm a z');
		}
	}
};