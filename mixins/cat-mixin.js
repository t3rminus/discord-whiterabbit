'use strict';
const Misc = require('../lib/misc');
const pr = require('request-promise-native');
const { extname } = require('path');
const sharp = require('sharp');
const fs = require('fs-extra');

const butt = sharp('images/cat_butt.png');
const head = sharp('images/cat_head.png');
const fuzz = sharp('images/cat_fuzz.png');

const flickrAttrib = fs.readFile('images/flickrattrib.svg', 'utf8');

const boiHeight = 60;

const foxAlts = [
  'ringdingdingdingdingeringeding',
  'geringdingdingdingdingeringeding',
  'wapapapapapapow',
  'hateehateehateeho',
  'jofftchofftchoffotchoffotchoff',
  'tchofftchofftchoffotchoffotchoff',
  'jachachachachachachow',
  'chachachachachachachow',
  'frakakakakakakakakow',
  'aheeaheehahee',
  'wawawaydo',
  'wubwidbiddumwaydo',
  'baybudabuddumbam',
  'mamadumdaydo',
  'abaybadabumbumbaydo'
];

// These tags are often included with photos that aren't actual photos of animals
// Plus tags for things we don't want to display
const flickrBlockedTags = ['-stuffed','-party','-art','-screenshot',
  '-illustration','-taxidermy','-specimens','-character','-fantasy',
  '-team','-sports','-band','-craft','-protest','-pollution','-skull',
  '-skulls','-bones'];

// These users abuse image tags, and are therefore excluded from results.
const flickrBlockList = ['65237496@N03', '47445767@N05', '29633037@N05', '76771480@N04',
  '22824835@N07', '114976295@N06', '79760361@N08', '69573851@N06', '17868205@N00',
  '17868205@N00', '61021753@N02', '98403995@N08', '126377022@N07', '14915441@N07',
  '12356580@N00', '71213045@N06', '57382496@N04', '146799285@N05', '56087830@N00',
  '35427622@N05', '76676024@N07', '143905885@N06', '71833159@N000','11024337@N03'];

const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];

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
    constructor () {
      super();

      this.commands.longcat = {
        helpText: 'Longcat is how long? Alias: {prefix}cat, {prefix}caat, {prefix}caaat, etc.',
        args: ['#'],
        method: 'command__longcat',
        sort: 140
      };

      this.commands.meow = {
        helpText: 'Need a cat to cheer you up?',
        args: [],
        method: 'command__meow',
        sort: 141
      };

      this.commands.woof = {
        helpText: 'Need a pupper to cheer you up?',
        args: [],
        method: 'command__woof',
        sort: 142
      };

      this.commands.chirp = {
        helpText: 'Need a birb to cheer you up?',
        args: [],
        method: 'command__chirp',
        sort: 143
      };

      this.commands.yip = {
        helpText: 'Need a foxxo to cheer you up?',
        args: [],
        method: 'command__yip',
        sort: 143
      };

      this.commands.dook = {
        helpText: 'Need an otter for your water? A ferret for your merit? A weasel for your... diesel?',
        args: [],
        method: 'command__dook',
        sort: 144
      };

      this.commands.baah = {
        helpText: 'Hey, you! Peep this sheep!',
        args: [],
        method: 'command__baah',
        sort: 145
      };

      this.commands.snek = {
        helpText: 'Allow me to provide you with only the finest danger noodles.',
        args: [],
        method: 'command__snek',
        sort: 146
      };

      this.addHandler(this.isACat);
      this.bot.on('messageReactionAdd', this.reactionAdded.bind(this));
    }

    async command__longcat (params, message) {
      if (!params[0] || isNaN(+params[0])) {
        return this.fail(message);
      }
      const longboi = Math.min(Math.max(+params[0], 1), 30);

      const buttMeta = await butt.metadata();
      const headMeta = await head.metadata();
      const fuzzMeta = await fuzz.metadata();
      const cat = Math.floor(Math.random() * (headMeta.height / boiHeight)) * boiHeight;

      const cropButt = await butt.extract({ top: cat, left: 0, width: buttMeta.width, height: boiHeight }).toBuffer();
      const cropHead = await head.extract({ top: cat, left: 0, width: headMeta.width, height: boiHeight }).toBuffer();
      const cropFuzz = await fuzz.extract({ top: cat, left: 0, width: fuzzMeta.width, height: boiHeight }).toBuffer();

      const compositeOperation = [
        {
          input: cropButt,
          top: 0,
          left: 0
        },
        {
          input: cropHead,
          top: 0,
          left: buttMeta.width + (longboi * fuzzMeta.width)
        }
      ];
      for (let i = 0; i < longboi; i++) {
        compositeOperation.push({
          input: cropFuzz,
          top: 0,
          left: buttMeta.width + (i * fuzzMeta.width)
        });
      }

      const newImage = await sharp({
          create: {
            width: buttMeta.width + headMeta.width + (fuzzMeta.width * longboi),
            height: boiHeight,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0.0 }
          }
        })
        .composite(compositeOperation)
        .png().toBuffer();

      return this.sendReply(message, new BotBase.Discord.Attachment(newImage, `cat_${Misc.unixTimestamp()}.png`));
    }

    async getPet (message, kind) {
      if (!APIS[kind]) {
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

      const [pet] = await pr(request);
      const attachmentName = `${kind}__${pet.id}__${extname(pet.url)}`;
      return this.sendReply(message, new BotBase.Discord.Attachment(pet.url, attachmentName));
    }

    async getFlickr (message, search, requiredTags, maxPage = 200) {
      const page = Math.ceil(Math.random() * maxPage);
      const request = {
        uri: 'https://api.flickr.com/services/rest',
        qs: {
          method: 'flickr.photos.search',
          api_key: process.env.FLICKR_API_KEY,
          tags: requiredTags.concat(flickrBlockedTags).join(','),
          tag_mode: 'all',
          text: search,
          safe_search: '1',
          content_type: '1',
          page: `${page}`,
          format: 'json',
          nojsoncallback: '1',
          sort: 'relevance',
          extras: 'media'
        },
        headers: {
          'Content-type': 'application/json'
        },
        json: true
      };

      const result = await pr(request);
      const { stat, photos: { photo = [], total = 0, pages = 0, page: actualPage } = {} } = result;
      if (stat !== 'ok' || total <= 0 || pages <= 0) {
        throw new Error('Unable to query FLICKR');
      }
      if (page > pages) {
        return this.getFlickr(message, search, requiredTags, pages);
      }
      if (!photo.length) {
        throw new Error('No results were found');
      }

      const filteredPhotos = photo
        .filter(p => !flickrBlockList.includes(p.owner))
        .filter(p => p.media === 'photo');

      if(!filteredPhotos.length) {
        console.log('Ran out of images.');
        return this.getFlickr(message, search, requiredTags, pages);
      }

      const thePhoto = pickOne(filteredPhotos);

      const attachmentName = `flickr__${thePhoto.owner}-${thePhoto.id}__.jpg`;
      const url = `https://farm${thePhoto.farm}.staticflickr.com/${thePhoto.server}/${thePhoto.id}_${thePhoto.secret}_c.jpg`;
      const attribution = `flickr.com/photos/${thePhoto.owner}/${thePhoto.id}`;

      const imgBuffer = await pr({ url, encoding: null });
      const img = sharp(imgBuffer);
      const flickrOverlay = await sharp(Buffer.from((await flickrAttrib).replace('%TEXTHERE%', attribution))).toBuffer();

      img.composite([{
        input: flickrOverlay,
        gravity: 'southwest'
      }]);

      if (process.env.NODE_ENV === 'dev') {
        return this.sendReply(message, `<https://${attribution}>`, { file: new BotBase.Discord.Attachment(await img.jpeg().toBuffer(), attachmentName) });
      } else {
        return this.sendReply(message, { file: new BotBase.Discord.Attachment(await img.jpeg().toBuffer(), attachmentName) });
      }
    }

    command__meow (params, message) {
      return this.getPet(message, 'cat');
    }

    command__woof (params, message) {
      return this.getPet(message, 'dog');
    }

    command__chirp (params, message) {
      return this.getFlickr(message, 'bird', ['animal']);
    }

    command__snek (params, message) {
      return this.getFlickr(message, 'snake', ['animal']);
    }

    command__dook (params, message) {
      return this.getFlickr(message, pickOne(['otter','otter','otter','ferret','ferret','ferret','weasel','weasel','badger']), ['animal']);
    }

    command__baah (params, message) {
      return this.getFlickr(message, pickOne(['sheep','lamb']), ['animal']);
    }

    command__yip (params, message) {
      return this.getFlickr(message, 'fox', ['animal']);
    }

    async reactionAdded (messageReaction, user) {
      const { message, message: { attachments, author } = {}, emoji } = messageReaction;
      const reactionVal = this.reactionValue(emoji);
      const { kind, id } = this.petAttachmentDetails(attachments);

      if (kind && id && author.id === this.bot.user.id && reactionVal !== null) {
        if (APIS[kind] && APIS[kind].votes) {
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
            if (response.message === 'SUCCESS' && reactionVal === false) {
              return message.delete();
            }
          } catch (err) {
            return this.sendReply('Oh dear. I tried to register your reaction, but something went wrong. Do try again!');
          }
        } else if (kind === 'flickr' && reactionVal === false) {
          return message.delete();
        }
      }
    }

    reactionValue (emoji) {
      const negativeReactions = ['👎', '🛑', '⛔', '🚫', '❌', '🤬', '💢', '💀', '☠'];
      const positiveReactions = ['👍', '👌', '✅', '❤', '🧡', '💛', '💚', '💙', '💜', '⬆', '🤩', '😻', '💯'];

      const emojiValue = (emoji && emoji.name) || emoji;
      if (negativeReactions.includes(emojiValue)) {
        return false;
      } else if (positiveReactions.includes(emojiValue)) {
        return true;
      }

      return null;
    }

    petAttachmentDetails (attachments) {
      try {
        const [[, attachment] = []] = attachments;
        const details = /([a-z]+)__([a-z0-9\-]+)__\.(jpg|jpeg|png|gif)/i.exec(attachment.filename);
        if (details && details.length === 4) {
          return {
            kind: details[1],
            id: details[2]
          };
        }
      } catch (err) { }
      return { kind: null, id: null };
    }

    async isACat (message) {
      if (message.member && message.member.id !== this.bot.user.id) {
        const settings = await this.getServerSettings(message);
        let prefix = settings.prefix || this.defaultSettings.prefix;
        if (process.env.NODE_ENV === 'dev') {
          prefix = 'dev' + prefix;
        }

        if(message.content && message.content.indexOf(prefix) === 0) {
          // Match command at beginning of message
          const matchCmd = new RegExp(`^${BotBase.Misc.escapeRegex(prefix)}c(a+)t(\s*|$)`);
          const match = matchCmd.exec(message.content);

          if (match && match.length && match[1]) {
            return this.command__longcat([match[1].length], message);
          }

          const foxCmds = foxAlts.map(f => prefix + f);
          const messageClean = new RegExp(`[^${BotBase.Misc.escapeRegex(prefix)}a-z]+`, 'g');
          const bareText = message.content.toLowerCase().replace(messageClean, '').trim();
          if(foxCmds.includes(bareText)) {
            return this.command__yip(null, message);
          }
        }
      }
    }
  };
