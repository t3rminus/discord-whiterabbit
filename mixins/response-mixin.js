'use strict';
const FuzzyMatching = require('fuzzy-matching');

module.exports = (BotBase) =>
	class ResponderMixin extends BotBase {
		constructor() {
			super();

			this.commands['response'] = {
				helpText: 'When you say __marco__, I say __polo__. Enclose marco/polo in `"` quotes. Use `"delete"` ' +
				'for polo to remove a response. Use --fuzzy to roughly match, and --partial to respond if it’s ' +
				'anywhere in a message. Add more than one "polo" to randomly select one.',
				args: ['"marco"','"polo"','(..."polo")','(--fuzzy)','(--partial)','(--replace)'],
				method: 'command__response',
				adminOnly: true,
				sort: 9
			};

			this.addHandler(this.msg_response);
		}

		async command__response(params, message) {
			if(!(await this.isAdmin(message))) {
				return this.fail(message);
			}
			if(params.length < 2) {
				throw new Error('Unknown number of parameters');
			}
			const settings = await this.getServerSettings(message);
			
			settings.responses = settings.responses || [];
			const marco = params[0].toLowerCase();
			let polo = params[1];
			if(params.length > 2) {
				polo = params.slice(1);
			}
			
			if(polo === 'delete') {
				const del = settings.responses.findIndex((i) => i.marco === marco);
				if(del > -1) {
					settings.responses.splice(del, 1);
					return this.saveServerSettings(message, settings, true)
					.then(() => {
						return message.channel.send(`I’ve forgotten the response to "${marco}"`);
					});
				} else {
					return message.channel.send(`I don’t have a response for "${marco}"`);
				}
			}
			
			const existing = ResponderMixin.findResponse(settings, marco);
			if(existing) {
				return message.channel.send(`I'm already responding to "${marco}": "${existing.polo}"`);
			}
			
			settings.responses.push({
				marco, polo,
				fuzzy: params.flags.fuzzy,
				partial: params.flags.partial,
				replace: params.flags.replace
			});

			await this.saveServerSettings(message, settings, true);
			
			let theResp = `"${polo}"`;
			if(Array.isArray(polo)) {
				theResp = `one of ${polo.length} things`;
			}
			const replace = params.flags.replace;
			if(params.flags.fuzzy) {
				return this.sendReply(message, `Ok! When someone says something similar to "${marco}, I’ll ${replace ? 'replace it with' : 'say'} ${theResp}!`);
			} else if(params.flags.partial) {
				return this.sendReply(message, `Ok! When someone says something with "${marco}" in it, I’ll ${replace ? 'replace it with' : 'say'} ${theResp}!`);
			} else {
				return this.sendReply(message, `Ok! When someone says "${marco}", I’ll ${replace ? 'replace it with' : 'say'} ${theResp}!`);
			}
		}

		async msg_response(message) {
			if(message.member && message.member.id !== this.bot.user.id) {
				const settings = await this.getServerSettings(message);
				const response = ResponderMixin.findResponse(settings, message.content.toLowerCase());
				if (response) {
					if (Array.isArray(response.polo)) {
						const responseText = response.polo[Math.floor(Math.random() * response.polo.length)];
						this.sendReply(message, responseText);
					} else {
						this.sendReply(message, response.polo);
					}
					
					if (response.replace) {
						message.delete();
					}
					return true;
				}
			}
			return false;
		}

		static findResponseIndex(settings, find) {
			let index = -1;
			if(settings.responses && settings.responses.length) {
				index = settings.responses.findIndex((r) => {
					if(r.fuzzy) {
						const fm = new FuzzyMatching([r.marco]);
						const result = fm.get(find, { min: 0.8 });

						if(result.value) {
							return true;
						}
					} else if(r.partial) {
						if(find.indexOf(r.marco) > -1) {
							return true;
						}
					} else {
						if(find === r.marco) {
							return true;
						}
					}
				});
			}
			return index;
		}

		static findResponse(settings, find) {
			if(settings.responses && settings.responses.length) {
				const index = ResponderMixin.findResponseIndex(settings, find);
				if(index > -1) {
					return settings.responses[index];
				}
			}

			return null;
		}
	};
