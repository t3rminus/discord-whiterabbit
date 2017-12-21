'use strict';
const Bluebird = require('bluebird');

module.exports = (BotBase) =>
	class ModMixin extends BotBase {
		constructor() {
			super();
			
			this.commands['behead'] = {
				helpText: 'Off with his head! Delete # messages.',
				args: ['#'],
				method: 'command__behead',
				adminOnly: true
			};
		}
		
		command__behead(params, message) {
			return this.isAdmin(message).then(() => {
				if(params._.length !== 1) {
					return this.fail(message);
				}
				let count = parseInt(params._[0]);
				if(isNaN(count)) {
					return this.fail(message);
				}
				
				if(count > 20) {
					return message.channel.send('Oh my! That seems like an awful lot of messages. I don’t think I can handle more than 20 at a time.');
				}
				if(count < 1) {
					return message.channel.send('Well, I can try, but there wouldn’t be much point, now would there?');
				}
				
				return message.channel.bulkDelete(count + 1)
					.catch((err) => {
						console.log(err);
						return message.channel.send('How dreadful! I wasn’t permitted to behead any messages. You may need to invite me again!');
					});
			});
		}
	};