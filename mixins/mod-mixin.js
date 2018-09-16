'use strict';
const Misc = require('../lib/misc');

module.exports = (BotBase) =>
	class ModMixin extends BotBase {
		constructor() {
			super();
			
			this.commands['behead'] = {
				helpText: 'Off with his head! Delete # messages.',
				args: ['#'],
				method: 'command__behead',
				adminOnly: true,
				sort: 7
			};
			
			this.commands['allowrole'] = {
				helpText: 'Allow users to assign themselves one or more from a group of roles. Generated command takes the format {prefix}group role',
				args: ['group','role','(...role)','(--single (true|false)'],
				method: 'command__allowrole',
				adminOnly: true,
				sort: 6
			};
			
			this.addHandler(this.msg_rolecheck);
		}
		
		async command__behead(params, message) {
			if(!(await this.isAdmin(message))) {
				return;
			}
			
			if(params.length !== 1) {
				return this.fail(message);
			}
			let count = parseInt(params[0]);
			if(isNaN(count)) {
				return this.fail(message);
			}
			
			if(count > 20) {
				return message.channel.send('Oh my! That seems like an awful lot of messages. I don’t think I can handle more than 20 at a time.');
			}
			if(count < 1) {
				return message.channel.send('Well, I can try, but there wouldn’t be much point, now would there?');
			}
			
			try {
				return message.channel.bulkDelete(count + 1);
			} catch(err) {
				return message.channel.send('How dreadful! I wasn’t permitted to behead any messages. You may need to invite me again!');
			}
		}
		
		async command__allowrole(params, message) {
			if(!(await this.isAdmin(message))) {
				return;
			}
			const settings = await this.getServerSettings(message);
			const prefix = settings.prefix || this.defaultSettings.prefix;
			settings.allowroles = settings.allowroles || {};
			
			const group = params.shift().toLowerCase();
			let method, value;
			if(['add','remove','list','show','set','reset'].includes(params[0])) {
				method = params.shift();
				value = params;
			} else if(params.length) {
				method = 'set';
				value = params;
			} else {
				method = 'show';
			}
			
			settings.allowroles[group] = settings.allowroles[group] || { list: [], single: false };
			
			if(params.flags && params.flags.single) {
				settings.allowroles[group].single = params.flags.single !== 'false';
			}
			
			switch(method) {
				case 'add':
					settings.allowroles[group].list = settings.allowroles[group].list.concat(value);
					break;
				case 'remove':
					value.forEach(item => {
						const idx = settings.allowroles[group].list.indexOf(item);
						if(idx < 0) {
							throw new BotBase.NotFoundError();
						}
						settings.allowroles[group].list.splice(idx, 1);
					});
					break;
				case 'set':
					settings.allowroles[group].list = params;
					break;
				case 'reset':
					delete settings.allowroles[group];
					break;
			}
			
			if(['add','remove','set','reset'].includes(method)) {
				await this.saveServerSettings(message, settings, true);
				
				if(method === 'reset') {
					return this.sendReply(message, `Okay. I won't let users assign themselves `
						+ `a role with ${prefix}${group}.`);
				} else {
					const list = settings.allowroles[group].list.map((value) => `\n • ${value}`).join('');
					const output = `Okay. Users can select from the following roles `
						+ `with the ${prefix}${group} command.\n${list}`;
					return this.sendReply(message, output);
				}
			} else {
				const list = settings.allowroles[group].list.map((value) => `\n • ${value}`).join('');
				const output = `Users can select from the following roles `
					+ `in ${group} with the ${prefix}${group} command.\n${list}`;
				return this.sendReply(message, output);
			}
		}
		
		async msg_rolecheck(message) {
			if(!message.member || message.member.id === this.bot.user.id || message.author.bot) {
				return false;
			}
			
			const settings = await this.getServerSettings(message);
			const prefix = settings.prefix || this.defaultSettings.prefix;
			const prefixRegEx = new RegExp(`^${Misc.escapeRegex(prefix)}`);
			if(prefixRegEx.test(message.content)) {
				const params = Misc.parseString(message.content.replace(prefixRegEx, ''));
				if(!params.length || params.length > 2) {
					return false;
				}
				const group = params.shift().toLowerCase();
				if(!settings.allowroles[group]) {
					return false;
				}
				if(!params.length) {
					const list = settings.allowroles[group].list.map((value) => `\n • ${value}`).join('');
					await this.sendReply(message, `You can choose a \`${prefix}${group}\` from the `
						+ `following list:\n${list}`);
					
					return true;
				}
				
				const role = Misc.stringNormalize(params.shift());
				if(!role.length) {
					return false;
				}
				
				const roleRegex = new RegExp(`^${Misc.escapeRegex(role)}`);
				const matchingRole = settings.allowroles[group].list.find((item) => {
					return roleRegex.test(Misc.stringNormalize(item));
				});
				
				try {
					if(matchingRole) {
						const addRole = message.guild.roles.find((role) => role.name === matchingRole);
						if(addRole) {
							if(settings.allowroles[group].single) {
								const allRoles = settings.allowroles[group].list;
								const removeRoles = message.guild.roles.filter((role) => allRoles.includes(role.name) && role !== addRole);
								await message.member.removeRoles(removeRoles);
							}
							
							await message.member.addRole(addRole);
							if(settings.allowroles[group].single) {
								await this.sendReply(message, `Ok. I've set your ${group} to ${addRole.name}`);
							} else {
								await this.sendReply(message, `Ok. I've added ${addRole.name} to your ${group} list`);
							}
							return true;
						}
					}
				} catch(err) {
					console.error(err);
				}
			}
			return false;
		}
	};