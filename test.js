import { getSuggestions } from './utils/suggestions.js';

console.log(getSuggestions(400));
console.log(getSuggestions(429));
console.log(getSuggestions(999)); // should return defaultSuggestions
