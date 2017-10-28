'use strict';

module.exports = function RollLib(diceCommand) {
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
		});
		
		return results;
	} else {
		throw new Error('Unable to parse the dice')
	}
};