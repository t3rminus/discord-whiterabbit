'use strict';
const Bluebird = require('bluebird'),
	Misc = require('../lib/misc');

module.exports = (BotBase) =>
class ResponderMixin extends BotBase {
	constructor() {
		super();

		this.commands['response'] = {
			helpText: '',
			args: ['place'],
			method: 'command__response',
			parseParams: false,
			adminOnly: true
		};
	}
	
	command__response(params, message) {
		if(/^\s*$/.test(params)) {
			return this.fail(message);
		}

	}
};