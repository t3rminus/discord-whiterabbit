'use strict';

const Random = require("random-js");

module.exports = (BotBase) =>
class DiceMixin extends BotBase {
	constructor() {
		super();
		
		this.commands['roll'] = {
			helpText: 'Roll dice. You can roll several dice at once',
			args: ['#d# + #','(…#d# + #)'],
			method: 'command__roll',
			parseParams: false,
			sort: 130
		};
	}
	
	async command__roll(params, message) {
		params = params.trim();
		const diceResult = await this.diceRoll(params, message);

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
		} else if(diceResult.dice.length === 1 && singleDie.count === 1 && singleDie.total === singleDie.max && singleDie.max > 2) {
			// One dice, and it was a CRIT!
			resultMessage = `Rolled 1d${singleDie.max}: **${singleDie.total}**! CRITICAL HIT! :tada: :confetti_ball:`;
			
			// Did we have modifiers
			if(singleDie.modifierTotal) {
				resultMessage += `\n ${singleDie.total} with ${singleDie.modifierStr} = **${singleDie.finalTotal}**`;
			}
		} else if(diceResult.dice.length === 1 && singleDie.count === 1 && singleDie.total === 1 && singleDie.max > 2) {
			// One dice, and it was an EPIC FAIL!
			resultMessage = `Rolled 1d${singleDie.max}: **1** …critical failure :confounded:`;
			
			// If we had modifiers, show them
			if(singleDie.modifierTotal) {
				resultMessage += `\n 1 with ${singleDie.modifierStr} = **${singleDie.finalTotal}**`;
			}
		}
		
		// Send the message
		this.sendReply(message, resultMessage);
	}
	
	async diceRoll(diceCommand, message) {
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
		
		if(error) {
			throw new BotBase.BadCommandError('Unable to parse the dice');
		}
		
		const random = new Random(Random.engines.browserCrypto);
		for(const die of dice) {
			die.results = [];
			die.total = 0;
			
			for(let i = 0; i < die.count; i++) {
				const roll = random.die(die.max);
				die.results.push(roll);
				die.total += roll;
			}
			
			if(die.modifiers.length) {
				die.modifiers = await Promise.all(die.modifiers.map(async (modifier) => {
					const intMod = parseInt('' + modifier.sign + modifier.value);
					
					if(Number.isNaN(intMod) && this.roll__getStat) {
						const statVal = await this.roll__getStat(modifier.value, message);
						if(!statVal) {
							return 0;
						}
						return modifier.sign === '-' ? statVal * -1 : statVal;
					} else if(Number.isNaN(intMod)) {
						return 0;
					} else {
						return intMod;
					}
				}));
			}
			
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
		}
		
		const result = {
			dice,
			total: dice.reduce((t,d) => t + d.total, 0),
			modifierTotal: dice.reduce((t,d) => t + d.modifierTotal, 0)
		};
		
		result.modifierTotalStr = ((result.modifierTotal > 0) ? '+' : '-') + Math.abs(result.modifierTotal);
		result.finalTotal = Math.max(0, result.total + result.modifierTotal);
		
		return result;
	}
};