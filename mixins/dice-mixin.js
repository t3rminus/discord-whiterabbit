'use strict';

const Bluebird = require('bluebird');

module.exports = (BotBase) =>
class DiceMixin extends BotBase {
	constructor() {
		super();
		
		this.commands['roll'] = {
			helpText: 'Roll dice. You can roll several dice at once',
			args: ['#d# + #','(…#d# + #)'],
			method: 'command__roll',
			parseParams: false
		};
	}

	command__roll(params, message) {
		params = params.trim();
		return this.diceRoll(params, message).then((diceResult) => {
			if(!diceResult || !diceResult.dice || !diceResult.dice.length) {
				return this.fail(message);
			}
			
			let resultMessage = '';
			const singleDie = diceResult.dice[0];
			
			// Output the results of the dice roll
			diceResult.dice.forEach((die) => {
				// Base message for each type of die
				resultMessage += `Rolled ${die.count}d${die.max}: ${die.results.join(', ')}`;
				if(die.modifierTotal) {
					// Result with modifier
					resultMessage += ` (with ${die.modifierStr}) = ** ${die.finalTotal}**`;
				} else if(die.count > 1) {
					// Result without modifier
					resultMessage += ' = **' + die.total + '**';
				}
				
				// Newline for clarity
				resultMessage += '\n';
			});
			
			// Special cases
			if(diceResult.dice.length > 1) {
				// Sum up all rolls for a final total
				if(diceResult.modifierTotal) {
					// If there were modifiers, show result with and without
					resultMessage += `Final total: ** ${diceResult.finalTotal}** (**${diceResult.total}** without modifiers)`;
				} else {
					// Otherwise show final result
					resultMessage += `Final total: **${diceResult.total}**`;
				}
			} else if(diceResult.dice.length === 1 && singleDie.count === 1 && singleDie.total === singleDie.max) {
				// One dice, and it was a CRIT!
				resultMessage = `Rolled 1d${singleDie.max}: **${singleDie.total}**! CRITICAL HIT! :tada: :confetti_ball:`;
				
				// Did we have modifiers
				if(singleDie.modifierTotal) {
					resultMessage += `\n ${singleDie.total} with ${singleDie.modifierStr} = **${singleDie.finalTotal}**`;
				}
			} else if(diceResult.dice.length === 1 && singleDie.count === 1 && singleDie.total === 1) {
				// One dice, and it was an EPIC FAIL!
				resultMessage = `Rolled 1d${singleDie.max}: **1** …critical failure :confounded:`;
				
				// If we had modifiers, show them
				if(singleDie.modifierTotal) {
					resultMessage += `\n 1 with ${singleDie.modifierStr} = **${singleDie.finalTotal}**`;
				}
			}
			
			// Send the message
			message.channel.send(resultMessage);
		});
	}

	diceRoll(diceCommand, message) {
		let error = false;
		
		let tmpDice, tmpAdd;
		const dicePattern = /([0-9]+)d([0-9]+)/g;
		const addPattern = /\s?([+-])\s?(\S+)/g;
		
		const dice = [];
		
		while (tmpDice = dicePattern.exec(diceCommand)) {
			if(tmpDice[1] && tmpDice[2] && parseInt(tmpDice[1]) && parseInt(tmpDice[2])) {
				const die = {
					count: parseInt(tmpDice[1]),
					max: parseInt(tmpDice[2]),
					modifiers: []
				};
				
				if(die.count > 200 || die.max < 0 || die.max > 10000) {
					error = true;
					break;
				}
				
				let modifiers = diceCommand.substr(tmpDice.index + tmpDice[0].length).split(dicePattern);
				if(modifiers[0] && modifiers[0].length) {
					let theAddition = modifiers[0];
					while (tmpAdd = addPattern.exec(theAddition)) {
						die.modifiers.push({sign: tmpAdd[1], value: tmpAdd[2]});
					}
				}
				dice.push(die);
			} else {
				error = true;
				break;
			}
		}
		
		if(!error) {
			return Bluebird.map(dice, (die) => {
				die.results = [];
				die.total = 0;
				
				for(let i = 0; i < die.count; i++) {
					const roll = Math.floor((Math.random() * die.max) + 1);
					die.results.push(roll);
					die.total += roll;
				}
				
				let result = Bluebird.resolve(die);
				if(die.modifiers.length) {
					result = result.then((die) => {
						return Bluebird.map(die.modifiers, modifier => {
							const intMod = parseInt('' + modifier.sign + modifier.value);
							if(Number.isNaN(intMod) && this.roll__getStat) {
								return this.roll__getStat(modifier.value, message)
								.then(val => {
									if (!val) {
										return 0;
									}
									
									return modifier.sign === '-' ? val * -1 : val;
								});
							} else if(Number.isNaN(intMod)) {
								return 0;
							} else {
								return intMod;
							}
						})
						.then(modifiers => {
							die.modifiers = modifiers;
							return die;
						});
					});
				}
				return result.then((die) => {
					// Sum modifiers
					if(die.modifiers && die.modifiers.length) {
						die.modifierTotal = die.modifiers.reduce((t,m) => (m ? t + m : t), 0);
						die.modifierStr = ((die.modifierTotal > 0) ? '+' : '-') + Math.abs(die.modifierTotal);
						die.finalTotal = Math.max(0, die.total + die.modifierTotal);
					} else {
						die.modifierTotal = 0;
						die.modifierStr = '';
						die.finalTotal = Math.max(0, die.total);
					}
					
					return die;
				});
			})
			.then((dice) => {
				const result = {
					dice,
					total: dice.reduce((t,d) => t + d.total, 0),
					modifierTotal: dice.reduce((t,d) => t + d.modifierTotal, 0)
				};
				
				result.modifierTotalStr = ((result.modifierTotal > 0) ? '+' : '-') + Math.abs(result.modifierTotal);
				result.finalTotal = Math.max(0, result.total + result.modifierTotal);

				return result;
			});
		} else {
			return Bluebird.reject(new Error('Unable to parse the dice'));
		}
	}
};