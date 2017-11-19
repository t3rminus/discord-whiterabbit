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
		return Bluebird.try(() => {
			const diceResult = DiceMixin.diceRoll(params);
			
			if(!diceResult || !diceResult.dice || !diceResult.dice.length) {
				return this.fail(message);
			}
			
			let resultMessage = '';
			const singleDie = diceResult.dice[0];
			
			// Output the results of the dice roll
			diceResult.dice.forEach((die) => {
				// Base message for each type of die
				resultMessage += `Rolled ${die.count}d${die.max}: ${die.results.join(', ')}`;
				if(die.modifier !== null) {
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
				if(diceResult.modifierTotal !== null) {
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
				if(singleDie.modifier) {
					resultMessage += `\n ${singleDie.total} with ${singleDie.modifierStr} = **${singleDie.finalTotal}**`;
				}
			} else if(diceResult.dice.length === 1 && singleDie.count === 1 && singleDie.total === 1) {
				// One dice, and it was an EPIC FAIL!
				resultMessage = `Rolled 1d${singleDie.max}: **1** …critical failure :confounded:`;
				
				// If we had modifiers, show them
				if(singleDie.modifier) {
					resultMessage += `\n 1 with ${singleDie.modifierStr} = **${singleDie.finalTotal}**`;
				}
			}
			
			// Send the message
			message.channel.send(resultMessage);
		});
	}

	static diceRoll(diceCommand) {
		const results = {
			dice: []
		};
		
		let error = false;
		
		let tmpDice, tmpAdd;
		const dicePattern = /([0-9]+)d([0-9]+)/g;
		const addPattern = /\s?([+-])\s?([0-9]+)/g;
		
		while (tmpDice = dicePattern.exec(diceCommand)) {
			if(tmpDice[1] && tmpDice[2] && parseInt(tmpDice[1]) && parseInt(tmpDice[2])) {
				const die = {
					count: parseInt(tmpDice[1]),
					max: parseInt(tmpDice[2]),
					modifier: null
				};
				
				if(die.count > 1000 || die.max < 0 || die.max > 10000) {
					error = true;
					break;
				}
				
				let modifiers = diceCommand.substr(tmpDice.index + tmpDice[0].length).split(dicePattern);
				if(modifiers[0] && modifiers[0].length) {
					let theAddition = modifiers[0];
					while (tmpAdd = addPattern.exec(theAddition)) {
						if(parseInt(tmpAdd[1] + tmpAdd[2])) {
							if(die.modifier === null) {
								die.modifier = 0;
							}
							die.modifier += parseInt(tmpAdd[1] + tmpAdd[2]);
						}
					}
				}
				results.dice.push(die);
			} else {
				error = true;
				break;
			}
		}
		
		let roll;
		if(!error) {
			results.total = 0;
			results.modifierTotal = null;
			
			results.dice.forEach(function(die) {
				die.results = [];
				die.total = 0;
				for(let i = 0; i < die.count; i++) {
					roll = Math.floor((Math.random() * die.max) + 1);
					die.results.push(roll);
					die.total += roll;
					results.total += roll;
				}
				
				if(die.modifier !== null) {
					if(!results.modifierTotal) {
						results.modifierTotal = 0;
					}
					results.modifierTotal += die.modifier;
				}
				
				die.modifierStr = ((die.modifier > 0) ? '+' : '-') + Math.abs(die.modifier);
				die.finalTotal = Math.max(0, die.total + die.modifier);
			});
			
			results.modifierTotalStr = ((results.modifierTotal > 0) ? '+' : '-') + Math.abs(results.modifierTotal);
			results.finalTotal = Math.max(0, results.total + results.modifierTotal);
			
			return results;
		} else {
			throw new Error('Unable to parse the dice')
		}
	}
};