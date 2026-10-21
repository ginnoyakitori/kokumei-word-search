// 使い方: node bench.js <wordType> <size> <mode> <engine> <runs> [budgetMs]
const { generate, loadWords, WORD_FILES } = require("./server.js");

const [wordType = "countries", size = "8", mode = "count", engine = "anneal", runs = "3"] =
  process.argv.slice(2);

const words = loadWords(WORD_FILES[wordType]);
const results = [];

for (let i = 0; i < Number(runs); i++) {
  const r = generate(words, Number(size), mode, engine);
  results.push(r);
  console.log(
    `${engine} ${wordType} ${size} ${mode} #${i + 1}: words=${r.placedWordCount} chars=${r.totalPlacedChars} ` +
      `usage=${r.totalUsageCount} overlapCells=${r.overlapCellCount} maxUse=${r.maxUsage} ms=${r.generationMs}`
  );
}

const avg = k => (results.reduce((s, r) => s + r[k], 0) / results.length).toFixed(1);
const max = k => Math.max(...results.map(r => r[k]));

console.log(
  `== ${engine} ${wordType} ${size} ${mode}: avg words ${avg("placedWordCount")} / max ${max("placedWordCount")}` +
    ` | avg usage ${avg("totalUsageCount")} / max ${max("totalUsageCount")}`
);