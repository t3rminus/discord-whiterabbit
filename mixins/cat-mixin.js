'use strict';
const Misc = require('../lib/misc'),
	pr = require('request-promise'),
	{ extname } = require('path'),
	Jimp = require('jimp');

const buttSRC = Jimp.read('images/cat_butt.png'),
	headSRC = Jimp.read('images/cat_head.png'),
	fuzzSRC = Jimp.read('images/cat_fuzz.png');

const boiHeight = 60;

const APIS = {
	cat: {
		uri: 'https://api.thecatapi.com/v1/images/search',
		votes: 'https://api.thecatapi.com/v1/votes',
		key: process.env.CAT_API_KEY
	},
	dog: {
		uri: 'https://api.thedogapi.com/v1/images/search',
		votes: 'https://api.thedogapi.com/v1/votes',
		key: process.env.DOG_API_KEY
	}
};

module.exports = (BotBase) =>
	class CatMixin extends BotBase {
		constructor() {
			super();

			this.commands['longcat'] = {
				helpText: 'Longcat is how long? Alias: {prefix}cat, {prefix}caat, {prefix}caaat, etc.',
				args: ['#'],
				method: 'command__longcat',
				sort: 140
			};

			this.commands['meow'] = {
				helpText: 'Need a cat to cheer you up?',
				args: [],
				method: 'command__meow',
				sort: 141
			};

			this.commands['woof'] = {
				helpText: 'Need a pupper to cheer you up?',
				args: [],
				method: 'command__woof',
				sort: 142
			};

			this.addHandler(this.isACat);
			this.bot.on('messageReactionAdd', this.reactionAdded.bind(this));
		}

		async command__longcat(params, message) {
			if(!params[0] || isNaN(+params[0])) {
				return this.fail(message);
			}
			let longboi = +params[0];
			longboi = longboi > 20 ? 20 : longboi;
			longboi = longboi <= 1 ? 1 : longboi;

			const [butt, head, fuzz] = await Promise.all([buttSRC, headSRC, fuzzSRC]);
			const cat = Math.floor(Math.random() * (head.bitmap.height / boiHeight)) * boiHeight;
			const newImage = await CatMixin.newImage(butt.bitmap.width + head.bitmap.width + (fuzz.bitmap.width * longboi), boiHeight, 0x00000000);
			
			newImage.blit(butt,0,0,0,cat,butt.bitmap.width,boiHeight);
			for(let i = 0; i < longboi; i++) {
				newImage.blit(fuzz, butt.bitmap.width + (fuzz.bitmap.width * i), 0, 0, cat, fuzz.bitmap.width, boiHeight);
			}
			newImage.blit(head, butt.bitmap.width + (fuzz.bitmap.width * longboi), 0, 0, cat, head.bitmap.width, boiHeight);
			
			const imgBuffer = await CatMixin.getImageBuffer(newImage, Jimp.MIME_PNG);
			
			return this.sendReply(message, new BotBase.Discord.Attachment(imgBuffer, `cat_${Misc.unixTimestamp()}.png`));
		}
		
		async getPet(message, kind) {
			if(!APIS[kind]) {
				throw new Error('Unknown pet kind');
			}
			
			const request = {
				uri: APIS[kind].uri,
				qs: {
					size: 'med',
					format: 'json',
					order: 'RANDOM',
					page: 0,
					limit: 1
				},
				headers: {
					'Content-type': 'application/json',
					'x-api-key': APIS[kind].key
				},
				json: true
			};
			
			const [ pet ] = await pr(request);
			const attachmentName = `${kind}__${pet.id}__${extname(pet.url)}`;
			return this.sendReply(message, new BotBase.Discord.Attachment(pet.url, attachmentName));
		}

		command__meow(params, message) {
			return this.getPet(message, 'cat');
		}

		command__woof(params, message) {
			return this.getPet(message, 'dog');
		}
		
		async reactionAdded(messageReaction, user) {
			const { message, message: { attachments, author } = {}, emoji } = messageReaction;
			const reactionVal = this.reactionValue(emoji);
			const { kind, id } = this.petAttachmentDetails(attachments);
			
			if(kind && id && author.id === this.bot.user.id && reactionVal !== null && APIS[kind] && APIS[kind].votes) {
				const request = {
					method: 'POST',
					uri: APIS[kind].votes,
					body: {
						image_id: id,
						value: reactionVal,
						sub_id: user.id
					},
					headers: {
						'Content-type': 'application/json',
						'x-api-key': APIS[kind].key
					},
					json: true
				};
				try {
					const response = await pr(request);
					if(response.message === 'SUCCESS' && reactionVal === false) {
						return message.delete();
					}
				} catch(err) {
					return this.sendReply('Oh dear. I tried to register your reaction, but something went wrong. Do try again!');
				}
			}
		}
		
		reactionValue(emoji) {
			const negativeReactions = ['👎','🛑','⛔','🚫','❌','🤬','💢','💀','☠'];
			const positiveReactions = ['👍','👌','✅','❤','🧡','💛','💚','💙','💜','⬆','🤩','😻','💯'];
			
			const emojiValue = (emoji && emoji.name) || emoji;
			if(negativeReactions.includes(emojiValue)) {
				return false;
			} else if(positiveReactions.includes(emojiValue)) {
				return true;
			}
			
			return null;
		}
		
		petAttachmentDetails(attachments) {
			try {
				const [[,attachment] = []] = attachments;
				const details = /([a-z]+)__([a-z0-9]+)__\.(jpg|jpeg|png|gif)/i.exec(attachment.filename);
				if(details && details.length === 4) {
					return {
						kind: details[1],
						id: details[2]
					};
				}
			} catch(err) { }
			return { kind: null, id: null };
		}
		
		async isACat(message) {
			if(message.member && message.member.id !== this.bot.user.id) {
				const settings = await this.getServerSettings(message);
				const prefix = settings.prefix || '?';
				
				// Match command at beginning of message
				const matchCmd = new RegExp(`^${BotBase.Misc.escapeRegex(prefix)}c(a+)t(\s*|$)`);
				const match = matchCmd.exec(message.content);
				
				if(match && match.length && match[1]) {
					return this.command__longcat([match[1].length], message);
				}
			}
		}

		static newImage(w, h, color) {
			return new Promise((resolve, reject) => {
				new Jimp(w, h, color, (err, image) => {
					if(err) {
						return reject(err);
					}
					return resolve(image);
				});
			});
		}
		
		static getImageBuffer(image, mime) {
			return new Promise((resolve, reject) => {
				image.getBuffer(mime, (err, image) => {
					if(err) {
						return reject(err);
					}
					return resolve(image);
				});
			});
		}
	};
