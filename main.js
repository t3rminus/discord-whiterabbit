'use strict';
const Bluebird = require('bluebird'),
	Discord = require('discord.js'),
	Redis = require('ioredis'),
	moment = require('moment-timezone'),
	FuzzyMatching = require('fuzzy-matching'),
	lib = require('./wrlib');

const bot = new Discord.Client();
const db = new Redis(process.env.REDIS_URL);

if(!String.prototype.capitalize) {
	String.prototype.capitalize = function() {
		return this.charAt(0).toUpperCase() + this.slice(1);
	}
}

bot.on('ready', function() {
	console.log('Logged in as %s - %s\n', bot.user.username, bot.user.id);
	
	bot.user.setUsername('White Rabbit');
	
	bot.user.setAvatar('./whiterabbit.jpg')
		.then(() => {
			console.log('Updated avatar');
		})
		.catch((err) => {
			console.log('Error updating avatar',err);
		});
});

bot.on('message', function(message) {
	if(message.content.indexOf('?tz ') === 0) {
		const params = message.content.slice(3);
		lib.lookupCity(params)
			.then((result) => {
				result.user = message.author.username + '#' + message.author.discriminator;
				return db.set(result.user, JSON.stringify(result))
					.then(() => result);
			})
			.then((result) => {
				message.channel.send('I’ll remember your info, so you’ll never be late!\n' +
					'```\nYour location: ' + result.address + '\n' +
					'Your time zone: ' + result.timezone + '\n' +
					'Your UTC offset: UTC' + (result.offset > 0 ? '+' : '') + (result.offset / 3600) + '\n' +
					'Your local time: ' + moment().tz(result.timezone).format('h:mm a z') + '```');
			})
			.catch((err) => {
				message.channel.send('Sorry. Something has gone terribly wrong!');
				console.log(err);
			});
	}
	
	if(message.content.indexOf('?tzdelete') === 0) {
		const user = message.author.username + '#' + message.author.discriminator;
		return db.del(user)
			.then(() => {
				message.channel.send('Poof! Your data is gone.');
			})
			.catch((err) => {
				message.channel.send('Sorry. Something has gone terribly wrong!');
				console.log(err);
			});
	}
	
	if(message.content.indexOf('?whiterabbit') === 0) {
		message.channel.send('Oh dear! Oh dear! I shall be too late!' +
			'\n\n • `?tz city/region/country` - Set your local time zone' +
			'\n\n • `?tzdelete` - Clear your information' +
			'\n\n • `?whenis name` - Look up someone’s information. You can look up several people at once.');
	}
	
	if(message.content.indexOf('?whenis ') === 0) {
		let params = message.content.slice(7).split(/(, ?| |; ?)/);
		params = params.filter(p => p.length && !/^\s+$/.test(p) && !/^(, ?| |; ?)$/.test(p));
		if(message && message.channel && message.channel.guild && message.channel.guild.members) {
			const userMap = {};
			const nicknameMap = {};
			for(const value of message.channel.guild.members) {
				const fn = value[1].user.username + '#' + value[1].user.discriminator;
				userMap[value[1].nickname] = fn;
				userMap[value[1].user.username] = fn;
				userMap['@' + fn] = fn;
				userMap['<@!'+value[0]+'>'] = fn;
				nicknameMap[fn] = value[1].nickname || value[1].user.username;
			}
			const fm = new FuzzyMatching(Object.keys(userMap));
			params = params.map((p) => {
				const result = fm.get(p);
				return {
					search: p,
					result: result ? result.value : null,
					user: result ? userMap[result.value] : null
				};
			});
			
			db.get(message.author.username + '#' + message.author.discriminator)
				.then((myData) => {
					try {
						return JSON.parse(myData);
					} catch(e) {
						return null;
					}
				})
				.then((myData) => {
					return Bluebird.map(params, (param) => {
						if(param.user) {
							const nick = nicknameMap[param.user];
							return db.get(param.user)
							.then(JSON.parse)
							.then((userData) => {
								if(userData) {
									return lib.generateMessage(nick, userData, myData);
								} else {
									return nick + ': I couldn’t find that user’s data.';
								}
							})
							.catch(() => {
								return nick + ': An error occurred for that user.'
							});
						} else {
							return param.search + ': I couldn’t find that user.'
						}
					})
				})
				.then((userDatas) => {
					message.channel.send('```' + userDatas.join('``` ```') + '```');
				})
				.catch((err) => {
					message.channel.send('Sorry. Something has gone terribly wrong!');
					console.log(err);
				});
		} else {
			console.log('Couldn\'t get server users');
		}
	}
	
	if(message.content === 'Callooh! Callay!') {
		db.get('jabberwocky-verse')
			.then((result) => {
				result = +result;
				if(!Number.isInteger(result)) {
					result = 0;
				}
				const verse = lib.VERSE[result];
				result = (result + 1) % lib.VERSE.length;
				db.set('jabberwocky-verse', result)
					.then(() => {
						message.channel.send(verse);
					});
			});
	}
});

bot.on('error', function(err) {
	console.log(err);
});

// Start the bot!
bot.login(process.env.DISCORD_TOKEN);