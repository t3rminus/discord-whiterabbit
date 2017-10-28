'use strict';

module.exports = {
	escapeRegex(str) {
		return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
	},
	capitalize(str) {
		return str.charAt(0).toUpperCase() + str.slice(1);
	},
	isString(value) {
		return typeof value === 'string' ||
			(!Array.isArray(value) &&
				(!!value && typeof value === 'object') &&
				Object.prototype.toString.call(value) === '[object String]');
	},
	arrayRemove(array) {
		const a = Array.prototype.slice.call(arguments, 1);
		let what, L = a.length, ax;
		while (L && array.length) {
			what = a[--L];
			while ((ax = array.indexOf(what)) !== -1) {
				array.splice(ax, 1);
			}
		}
		return array;
	}
};