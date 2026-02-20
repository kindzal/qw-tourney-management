// Node.js test runner for local testing
// Run with: node tests/test-runner.js

const fs = require('fs');
const path = require('path');

// Load helpers.js, api.js and tests.js from src folder
const helpersPath = path.join(__dirname, '..', 'src', 'helpers.js');
const apiPath = path.join(__dirname, '..', 'src', 'api.js');
const discordPath = path.join(__dirname, '..', 'src', 'discord.js');
const testsPath = path.join(__dirname, '..', 'src', 'tests.js');

const helpersCode = fs.readFileSync(helpersPath, 'utf8');
const apiCode = fs.readFileSync(apiPath, 'utf8');
const discordCode = fs.readFileSync(discordPath, 'utf8');
const testsCode = fs.readFileSync(testsPath, 'utf8');

// Execute in current context
eval(helpersCode);
eval(apiCode);
eval(discordCode);
eval(testsCode);

// Test functions to run
const tests = [
  'testLevenshteinDistance',
  'testLevenshteinSimilarity',
  'testFuzzySearch',
  'testFuzzySearchAll',
  'testFuzzySearchGameNicks',
  'testCleanGameNick',
  'testFuzzyMatchPlayer',
  'testBuildPlayerList',
  'testBuildTeamList',
  'testFuzzyMatchTeam',
  'testStripEmojis',
  'testCleanTeamNameForLogo',
  'testBuildTeamLogoUrl'
  , 'testGetRoundLabel'
];

console.log('Running fuzzy search tests...\n');

let passed = 0;
let failed = 0;

for (const testName of tests) {
  try {
    eval(`${testName}()`);
    console.log(`✓ ${testName}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${testName}`);
    console.log(`  ${err.message}\n`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
