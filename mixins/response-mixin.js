'use strict';
const FuzzyMatching = require('fuzzy-matching');

module.exports = (BotBase) =>
	class ResponderMixin extends BotBase {
		constructor() {
			super();
			
			this.commands['response'] = {
				helpText: 'When you say __marco__, I say __polo__. Enclose marco/polo in `"` quotes. Use `"delete"` for polo to remove a response. Use --fuzzy to roughly match, and --partial to respond if it’s anywhere in a message.',
				args: ['"marco"','"polo"','(--fuzzy)','(--partial)'],
				method: 'command__response',
				adminOnly: true
			};
			
			this.addHandler(this.msg_response);
		}
		
		command__response(params, message) {
			return this.isAdmin(message).then(() => {
				if(params._.length !== 2) {
					throw new Error('Unknown number of parameters');
				}
				
				return this.getServerSettings(message);
			})
			.then((settings) => {
				settings.responses = settings.responses || [];
				const marco = params._[0].toLowerCase();
				const polo = params._[1];
				if(polo === 'delete') {
					const del = settings.responses.findIndex((i) => i.marco === marco);
					if(del > -1) {
						settings.responses.splice(del, 1);
						return message.channel.send(`I’ve forgotten the response to "${marco}"`);
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
					fuzzy: params['fuzzy'],
					partial: params['partial']
				});
				
				return this.saveServerSettings(message, settings, true)
					.then(() => {
						if(params['fuzzy']) {
							return message.channel.send(`Ok! When someone says something similar to "${marco}, I’ll say "${polo}"!`);
						} else if(params['partial']) {
							return message.channel.send(`Ok! When someone says something with "${marco}" in it, I’ll say "${polo}"!`);
						} else {
							return message.channel.send(`Ok! When someone says "${marco}", I’ll say "${polo}"!`);
						}
					});
			});
		}
		
		msg_response(message) {
			if(message.member && message.member.id !== this.bot.user.id) {
				this.getServerSettings(message)
				.then((settings) => {
					const response = ResponderMixin.findResponse(settings, message.content.toLowerCase());
					if(response) {
						message.channel.send(response.polo);
						return true;
					}
				});
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