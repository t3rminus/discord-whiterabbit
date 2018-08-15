'use strict';

const SIGIL_API = 'https://www.k3vin.net/sigils.php?submit=download&phrase=';

module.exports = (BotBase) =>
	class SigilMixin extends BotBase {
		constructor() {
			super();
			
			this.commands['sigil'] = {
				helpText: 'Construct a secret sigil based on an input phrase',
				args: ['phrase'],
				method: 'command__sigil',
				parseParams: false
			};
		}
		
		async command__sigil(params, message) {
			const fn = params.replace(/[^a-z0-9]+/g,'_').replace(/(^_+|_+$)/g, '') || 'unknown';
			
			await message.channel.send(new BotBase.Discord.Attachment(`${SIGIL_API}${encodeURIComponent(params)}`, `${fn}.png`));
			return message.delete();
		}
	};
