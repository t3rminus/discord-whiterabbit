'use strict';
const pr = require('request-promise');

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

module.exports = function searchTimezone(city) {
	let address, location;
	return pr('https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(city))
	.then(JSON.parse)
	.then((result) => {
		if (result.status !== 'OK' || !result.results || !result.results[0]) {
			throw new NoResultError('Could not find that city');
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
				throw new NoResultError('Could not find that city’s time zone');
			}
			
			return {
				timezone: tzResult.timeZoneId
			};
		});
	});
};

module.exports.NoResultError = NoResultError;