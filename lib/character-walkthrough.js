const CharacterTemplates = require('./character-templates');
const NAME_DISTANCE = 0.8;

const isSkip = (m, s) =>
	((m && m.content || `${m}`)).toLowerCase()
		.trim()
		.replace(/(^[^a-z]+|[^a-z]$)/gi, '') === (s || 'skip');

module.exports = [
	{
		// 0
		step: 'template',
		open: () => {
			return `What kind of character did you want to create? I know about ` +
				`\`${Object.keys(CharacterTemplates).join('`, `')}\`. If you ` +
				`don’t want to use a template, just say \`none\`.`;
		},
		process: async (track, message) => {
			if (CharacterTemplates[message.content]) {
				track.character.template = message.content;
				track.stats = Object.keys(CharacterTemplates[message.content].stats);
				await message.author.send(`Got it! I’ll keep track of their ${CharacterTemplates[message.content].game} stats.`);
				return true;
			} else if (isSkip(message) || isSkip(message, 'none')) {
				await message.author.send(`Got it! I’ll keep track of their free form stats.`);
				return true;
			} else {
				throw new Error(`Hmm... I’m not quite sure what you mean.`);
			}
		}
	},
	{
		// 1
		step: 'name',
		open: () => {
			return `What is your character’s name?`;
		},
		process: async (track, message, bot) => {
			if (isSkip(message) && !track.skipCount) {
				track.skipCount = true;
				throw new Error(`Sorry, this is the one thing I can’t skip. If you actually want to name your character "${message}", just type it one more time.`);
			}
			const name = bot.sanitize(message.content, track.server);
			const character = await bot.findCharacter(name, { member: track.member }, NAME_DISTANCE);
			if (character) {
				throw new Error(`That’s very similar to someone else’s character "${character.name}"… Try something else to avoid confusion.`);
			}

			track.character.name = name;
			await message.author.send(`Okay! Their name is ${name}!`);
			return true;
		},
		repeat: () => {
			return `Got any other ideas for a name for your character?`;
		}
	},
	{
		// 2
		step: 'description',
		open: (track) => {
			return `Tell me about ${track.character.name}. What do they like? How do they dress? Where are they from? ` +
				`Give me all the details of their life, so I know exactly who they are.`;
		},
		process: async (track, message, bot) => {
			if (isSkip(message) || isSkip(message, 'no')) {
				await message.author.send(`Moving right along!`);
				return true;
			} else {
				track.character.description = bot.sanitize(message.content, track.server);
				await message.author.send(`Wonderful!`);
				return true;
			}
		}
	},
	{
		// 3
		step: 'pic',
		open: () => {
			return `Do you have a picture of your character you’d like to use? If you do, please send it to me!`;
		},
		process: async (track, message) => {
			if (isSkip(message) || isSkip(message, 'no')) {
				await message.author.send(`No picture? That’s too bad, but you can always add it later.`);
				return true;
			} else {
				let image;
				if (message.attachments && message.attachments.size) {
					image = message.attachments.first();
				} else {
					throw new Error('Whoops! There didn’t seem to be an picture with that message.');
				}

				track.character.image = image.url;
				await message.author.send(`Wow! Now I know what ${track.character.name} looks like.`);
				return true;
			}
		}
	},
	{
		// 4
		step: 'info',
		open: () => {
			return `Now let’s work on some details. What information would you like to add? For instance,` +
				` you can say something like \`job\`, \`class\`, or \`race\`. If you want to do this later, say \`skip\`.`;
		},
		repeat: () => {
			return `Is there any other information you want to add? You can say \`job\`, \`class\`, or \`race\`, or ` +
				`really anything at all! If you’ve entered everything you want, say \`done\`.`;
		},
		process: async (track, message, bot) => {
			if (isSkip(message)) {
				await message.author.send(`Okay! Skipping this for now.`);
				return 'stat';
			} else if (isSkip(message, 'done')) {
				await message.author.send(`Alright, done with info.`);
				return 'stat';
			} else {
				track.nextInfo = bot.sanitize(message.content, track.server);
				return true;
			}
		}
	},
	{
		// 5
		step: 'info_value',
		open: (track) => {
			return `Okay! What should I put down for ${track.nextInfo}?`;
		},
		process: async (track, message, bot) => {
			const info = track.nextInfo;
			delete track.nextInfo;

			if (isSkip(message)) {
				await message.author.send(`Got it! Next!`);
				return 'stat';
			}

			track.character[info] = bot.sanitize(message.content, track.server);
			await message.author.send(`Good! Noted.`);
			return 'info';
		}
	},
	{
		// 6
		step: 'stat',
		open: (track) => {
			track.curStat = track.stats[0];
			const game = CharacterTemplates[track.character.template];
			const statName = (game.stats[track.curStat].calc ? '**base** ' : '')
				+ game.stats[track.curStat].name.toLowerCase();
			return `Ok! Since we’re setting up a ${game.game}` +
				` character, I need some stats! What is their ${statName}?`;
		},
		repeat: (track) => {
			track.curStat = track.stats[0];
			const game = CharacterTemplates[track.character.template];
			const statName = (game.stats[track.curStat].calc ? '**base** ' : '')
				+ game.stats[track.curStat].name.toLowerCase();
			return `Okay, and what is their ${statName}?`;
		},
		process: async (track, message, bot) => {
			if (isSkip(message)) {
				track.stats.shift();
				await message.author.send(`Okay. You can set that later.`);
				return 'stat';
			}

			const game = CharacterTemplates[track.character.template];
			if (!track.character.stats) {
				track.character.stats = {};
			}

			const stat = bot.sanitize(message.content, track.server);
			track.character.stats[track.curStat] = stat;

			if (game.stats[track.curStat].calc) {
				let calcVal = game.stats[track.curStat].calc(stat);
				if (calcVal > 0) {
					calcVal = `+${calcVal}`;
				}
				await message.author.send(`Okay. ${game.stats[track.curStat].name} is ${stat} which is ${calcVal}`);
			} else {
				await message.author.send(`Okay. ${game.stats[track.curStat].name} is ${stat}`);
			}

			track.stats.shift();
			if (track.stats.length) {
				return 'stat';
			} else {
				return 99; // End
			}
		}
	},
	{
		// 7
		step: 'emergency_name',
		open: () => {
			return `Got any other ideas for a name for your character?`;
		},
		process: async (track, message, bot) => {
			if (isSkip(message)) {
				throw new Error('Sorry, this is the one thing I can’t skip.');
			}
			const name = bot.sanitize(message.content, track.server);
			const character = await bot.findCharacter(name, { member: track.member }, NAME_DISTANCE)
			if (character) {
				throw new Error(`That’s very similar to someone else’s character "${character.name}"… Try something else to avoid confusion.`);
			}

			track.character.name = name;
			await message.author.send(`Nice to meet you, ${name}!`);
			return 99;
		}
	}
];