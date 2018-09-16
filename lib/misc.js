'use strict';

const Misc = {
	unixTimestamp(date) {
		return +(date || new Date) / 1e3 | 0;
	},
	escapeRegex(str) {
		return str.replace(/[\-\[\]\/{}()*+?.\\^$|]/g, '\\$&');
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
	stringNormalize(string) {
		return string.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z]/g,'');
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
	},
	arrayEquals(a, b, strict) {
		if(!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
			return false;
		}
		for(let i = 0; i < a.length; i++) {
			if(strict && a !== b) {
				return false;
			} else if(a != b) {
				return false;
			}
		}
		return true;
	},
	tokenizeString(argString, maxArgs = Infinity) {
		if(!argString || !argString.length) {
			return [];
		}
		
		argString = argString.trim();
		
		let quote = null;
		let escaped = false;
		let arg = '';
		const args = [];
		
		for (let i = 0; i < argString.length; i++) {
			const c = argString[i];
			
			if (((/\s/.test(c) || c === '"' || c === '\'') && !escaped) && !quote && arg) {
				escaped = false;
				quote = null;
				args.push(arg);
				arg = '';
				
				if(args.length === maxArgs) {
					const rest = argString.slice(i + 1).trim();
					if(rest) {
						args.push(rest.trim());
					}
					return args;
				}
			}
			
			if(escaped) {
				if(c === '\\') {
					arg += '\\';
				} else if((c === '"' || c === '\'')) {
					arg += c;
				} else if(/\s/.test(c)) {
					arg += c;
				} else {
					arg += '\\' + c;
				}
				escaped = false;
			} else if (c === '\\') {
				escaped = true;
			} else if (c === quote) {
				quote = null;
			} else if ((c === '"' || c === '\'') && !quote) {
				quote = c;
			} else if (!/\s/.test(c) || quote) {
				arg += c;
			}
		}
		
		if(arg) {
			args.push(arg);
		}
		
		return args;
	},
	parseString(argString) {
		const tokenString = Misc.tokenizeString(argString);
		
		const result = [];
		result.flags = {};
		
		let lastFlag, singleFlag = false;
		tokenString.forEach((token) => {
			let match;
			
			match = /^--(.+)=(.+)$/.exec(token);
			if(match && match[1] && match[2]) {
				result.flags[match[1]] = match[2];
				lastFlag = null;
				singleFlag = true;
				return;
			}
			
			match = /^--(.+)=$/.exec(token);
			if(match && match[1]) {
				lastFlag = match[1];
				result.flags[match[1]] = true;
				singleFlag = true;
				return;
			}
			
			match = /^--(.+)$/.exec(token);
			if(match && match[1]) {
				// Long form flags
				lastFlag = match[1];
				result.flags[match[1]] = true;
				singleFlag = false;
				return;
			}
			
			if(/^--$/.exec(token)) {
				lastFlag = null;
				singleFlag = false;
				return;
			}
			
			match = /^-(.+)$/.exec(token);
			if(match && match[1]) {
				// Short flags
				const shortFlags = match[1].split('');
				shortFlags.forEach(flag => result.flags[flag] = true);
				lastFlag = shortFlags.pop();
				singleFlag = false;
				return;
			}
			
			if(lastFlag && result.flags[lastFlag].push) {
				result.flags[lastFlag].push(token);
			} else if(lastFlag && result.flags[lastFlag] !== true) {
				result.flags[lastFlag] = [result.flags[lastFlag], token];
			} else if(lastFlag) {
				result.flags[lastFlag] = token;
				if(singleFlag) {
					lastFlag = null;
					singleFlag = false;
				}
			} else {
				result.push(token);
			}
		});
		
		return result;
	}
};

module.exports = Misc;