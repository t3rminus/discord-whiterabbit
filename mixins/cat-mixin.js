'use strict';
const Bluebird = require('bluebird'),
	pr = require('request-promise'),
	Jimp = require('jimp');

const butt = Jimp.read('images/cat_butt.png'),
	head = Jimp.read('images/cat_head.png'),
	fuzz = Jimp.read('images/cat_fuzz.png');

const boiHeight = 50;

const MEOW_API = 'https://random.cat/meow';
const WOOF_API = 'https://random.dog/woof';

module.exports = (BotBase) =>
	class CatMixin extends BotBase {
		constructor() {
			super();
			
			this.commands['longcat'] = {
				helpText: 'Longcat is how long? Alias: {prefix}cat, {prefix}caat, {prefix}caaat, etc.',
				args: ['#'],
				method: 'command__longcat'
			};
			
			this.commands['meow'] = {
				helpText: 'Need a cat to cheer you up?',
				args: [],
				method: 'command__meow'
			};
			
			this.commands['woof'] = {
				helpText: 'Need a pupper to cheer you up?',
				args: [],
				method: 'command__woof'
			};
			
			this.addHandler(this.isACat);
		}
		
		command__longcat(params, message) {
			if(!params._ || !params._[0] || isNaN(+params._[0])) {
				return this.fail(message);
			}
			let longboi = +params._[0];
			longboi = longboi > 20 ? 20 : longboi;
			longboi = longboi <= 1 ? 1 : longboi;
			
			return Bluebird.all([butt, head, fuzz])
				.then(([butt, head, fuzz]) => {
					const cat = Math.floor(Math.random() * (head.bitmap.height / boiHeight)) * boiHeight;
					
					return CatMixin.newImage(butt.bitmap.width + head.bitmap.width + (fuzz.bitmap.width * longboi), boiHeight, 0x00000000)
						.then(newImage => {
							newImage.blit(butt,0,0,0,cat,butt.bitmap.width,boiHeight);
							for(let i = 0; i < longboi; i++) {
								newImage.blit(fuzz, butt.bitmap.width + (fuzz.bitmap.width * i), 0, 0, cat, fuzz.bitmap.width, boiHeight);
							}
							newImage.blit(head, butt.bitmap.width + (fuzz.bitmap.width * longboi), 0, 0, cat, head.bitmap.width, boiHeight);
							
							return Bluebird.fromCallback(cb => newImage.getBuffer(Jimp.MIME_PNG, cb));
						});
				})
				.then(imgBuffer => {
					return message.channel.send(new BotBase.Discord.Attachment(imgBuffer, 'cat.png'));
				});
		}
		
		command__meow(params, message) {
			return pr.get(MEOW_API)
				.then(JSON.parse)
				.then(({file}) => {
					return message.channel.send(new BotBase.Discord.Attachment(file, file));
				});
		}
		
		command__woof(params, message, count) {
			if(count && count > 5) {
				return message.channel.send('Good heavens! I’m having a bit of trouble getting a doggo for you right now!');
			}
			return pr.get(WOOF_API)
				.then(file => {
					if(/.jpe?g$/i.test(file)) {
						return message.channel.send(new BotBase.Discord.Attachment(`https://random.dog/${file}`, file));
					} else {
						return this.command__woof(params, message, count ? count + 1 : 1);
					}
				});
		}
		
		isACat(message) {
			if(message.member && message.member.id !== this.bot.user.id) {
				this.getServerSettings(message)
				.then((settings) => {
					const prefix = settings.prefix || '?';
					// Match command at beginning of message
					const matchCmd = new RegExp(`^${BotBase.Misc.escapeRegex(prefix)}c(a+)t(\s*|$)`);
					const match = matchCmd.exec(message.content);

					if(match && match.length && match[1]) {
						return this.command__longcat({'_':[match[1].length]}, message);
					}
				});
			}
		}
		
		static newImage(w, h, color) {
			return Bluebird.fromCallback(cb => {
				new Jimp(w, h, color, cb);
			});
		}
	};