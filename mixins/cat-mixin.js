'use strict';
const Misc = require('../lib/misc');
const pr = require('request-promise-native');
const { extname } = require('path');
const Jimp = require('jimp');

const buttSRC = Jimp.read('images/cat_butt.png');
const headSRC = Jimp.read('images/cat_head.png');
const fuzzSRC = Jimp.read('images/cat_fuzz.png');

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

      this.commands.snek = {
        helpText: 'Allow me to provide you with only the finest danger noodles.',
        args: [],
        method: 'command__snek',
        sort: 143
      };

      this.addHandler(this.isACat);
      this.bot.on('messageReactionAdd', this.reactionAdded.bind(this));
    }

    async command__longcat (params, message) {
      if (!params[0] || isNaN(+params[0])) {
        return this.fail(message);
      }
      let longboi = +params[0];
      longboi = longboi > 20 ? 20 : longboi;
      longboi = longboi <= 1 ? 1 : longboi;

      const [butt, head, fuzz] = await Promise.all([buttSRC, headSRC, fuzzSRC]);
      const cat = Math.floor(Math.random() * (head.bitmap.height / boiHeight)) * boiHeight;
      const newImage = await CatMixin.newImage(butt.bitmap.width + head.bitmap.width + (fuzz.bitmap.width * longboi), boiHeight, 0x00000000);

      newImage.blit(butt, 0, 0, 0, cat, butt.bitmap.width, boiHeight);
      for (let i = 0; i < longboi; i++) {
        newImage.blit(fuzz, butt.bitmap.width + (fuzz.bitmap.width * i), 0, 0, cat, fuzz.bitmap.width, boiHeight);
      }
      newImage.blit(head, butt.bitmap.width + (fuzz.bitmap.width * longboi), 0, 0, cat, head.bitmap.width, boiHeight);

      const imgBuffer = await CatMixin.getImageBuffer(newImage, Jimp.MIME_PNG);

      return this.sendReply(message, new BotBase.Discord.Attachment(imgBuffer, `cat_${Misc.unixTimestamp()}.png`));
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
          tags: requiredTags.join(','),
          tag_mode: 'all',
          text: search,
          safe_search: '1',
          content_type: '1',
          page: `${page}`,
          format: 'json',
          nojsoncallback: '1',
          sort: 'relevance'
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

      // These users abuse tags, and are therefore excluded from results.
      const blackList = ['65237496@N03', '47445767@N05', '29633037@N05', '76771480@N04',
        '22824835@N07', '114976295@N06', '79760361@N08', '69573851@N06', '17868205@N00',
        '17868205@N00'];
      let idx = Math.floor(Math.random() * photo.length);
      let thePhoto = photo[idx];
      while (blackList.includes(thePhoto.owner)) {
        photo.splice(idx, 1);
        if (!photo.length) {
          console.log('Ran out of images.');
          return this.getFlickr(message, search, requiredTags, pages);
        }

        idx = Math.floor(Math.random() * photo.length);
        thePhoto = photo[idx];
      }

      const attachmentName = `flickr__${thePhoto.owner}-${thePhoto.id}__.jpg`;
      const url = `https://farm${thePhoto.farm}.staticflickr.com/${thePhoto.server}/${thePhoto.id}_${thePhoto.secret}_c.jpg`;
      const attribution = `From Flickr: <https://flickr.com/photos/${thePhoto.owner}/${thePhoto.id}>`;
      return this.sendReply(message, attribution, { file: new BotBase.Discord.Attachment(url, attachmentName) });
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
        const prefix = settings.prefix || '?';

        // Match command at beginning of message
        const matchCmd = new RegExp(`^${BotBase.Misc.escapeRegex(prefix)}c(a+)t(\s*|$)`);
        const match = matchCmd.exec(message.content);

        if (match && match.length && match[1]) {
          return this.command__longcat([match[1].length], message);
        }
      }
    }

    static newImage (w, h, color) {
      return new Promise((resolve, reject) => {
        new Jimp(w, h, color, (err, image) => {
          if (err) {
            return reject(err);
          }
          return resolve(image);
        });
      });
    }

    static getImageBuffer (image, mime) {
      return new Promise((resolve, reject) => {
        image.getBuffer(mime, (err, image) => {
          if (err) {
            return reject(err);
          }
          return resolve(image);
        });
      });
    }
  };
