const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const WORD_FILES = {
  countries: "countries.txt",
  capitals: "capitals.txt",
  pokemon: "pokemon.txt"
};

const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1]
];

function normalizeWord(word) {
  return word
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
}

function loadWords(filename) {
  const filePath = path.join(__dirname, filename);
  const raw = fs.readFileSync(filePath, "utf-8");

  const words = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(normalizeWord)
    .filter(word => word.length > 1);

  return [...new Set(words)];
}

function createGrid(size) {
  return Array.from({ length: size }, () => Array(size).fill(""));
}

function createUsageGrid(size) {
  return Array.from({ length: size }, () => Array(size).fill(0));
}

function shuffle(array) {
  const arr = [...array];

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

function canPlace(grid, usageGrid, word, x, y, dx, dy) {
  const size = grid.length;

  let overlapCount = 0;
  let heavyOverlapScore = 0;
  let newCellCount = 0;
  let reusedCellCount = 0;

  for (let i = 0; i < word.length; i++) {
    const nx = x + dx * i;
    const ny = y + dy * i;

    if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
      return null;
    }

    const current = grid[ny][nx];

    if (current !== "" && current !== word[i]) {
      return null;
    }

    if (current === word[i]) {
      overlapCount++;
      reusedCellCount++;

      // すでに複数語で使われているマスをさらに使うほど高得点
      heavyOverlapScore += usageGrid[ny][nx] + 1;
    } else {
      newCellCount++;
    }
  }

  return {
    ok: true,
    overlapCount,
    heavyOverlapScore,
    newCellCount,
    reusedCellCount
  };
}

function getAllPlacements(grid, usageGrid, word) {
  const size = grid.length;
  const placements = [];

  for (const [dx, dy] of DIRECTIONS) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const result = canPlace(grid, usageGrid, word, x, y, dx, dy);

        if (result && result.ok) {
          placements.push({
            x,
            y,
            dx,
            dy,
            overlapCount: result.overlapCount,
            heavyOverlapScore: result.heavyOverlapScore,
            newCellCount: result.newCellCount,
            reusedCellCount: result.reusedCellCount
          });
        }
      }
    }
  }

  return placements;
}

function placementScore(placement, word) {
  /*
    重複を増やすための配置スコア。

    overlapCount:
      その単語が既存文字と重なった文字数

    heavyOverlapScore:
      すでに複数語が通っているマスをさらに使うと高得点

    newCellCount:
      新しく使うマス数。少ないほどよい

    word.length:
      長い単語でも不利になりすぎないよう補助的に加点
  */

  return (
    placement.overlapCount * 1000 +
    placement.heavyOverlapScore * 300 -
    placement.newCellCount * 20 +
    word.length
  );
}

function chooseBestPlacement(placements, word) {
  if (placements.length === 0) return null;

  let bestScore = -Infinity;

  for (const placement of placements) {
    const score = placementScore(placement, word);
    if (score > bestScore) {
      bestScore = score;
    }
  }

  const bestPlacements = placements.filter(
    placement => placementScore(placement, word) === bestScore
  );

  return bestPlacements[Math.floor(Math.random() * bestPlacements.length)];
}

function placeWordAt(grid, usageGrid, word, placement) {
  const { x, y, dx, dy } = placement;

  for (let i = 0; i < word.length; i++) {
    const nx = x + dx * i;
    const ny = y + dy * i;

    grid[ny][nx] = word[i];
    usageGrid[ny][nx]++;
  }
}

function fillGrid(grid) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid.length; x++) {
      if (grid[y][x] === "") {
        grid[y][x] = alphabet[Math.floor(Math.random() * alphabet.length)];
      }
    }
  }
}

function createWordOrder(words) {
  /*
    単語数を増やすためには短い単語優先が有利。
    ただし重複も増やしたいので、毎回少しランダム性を入れる。
  */

  const shuffled = shuffle(words);

  return shuffled.sort((a, b) => {
    if (a.length !== b.length) {
      return a.length - b.length;
    }

    return Math.random() - 0.5;
  });
}

function calculateUsageStats(usageGrid) {
  let usedCellCount = 0;
  let totalUsageCount = 0;
  let overlapCellCount = 0;
  let overlapScore = 0;
  let maxUsage = 0;

  for (const row of usageGrid) {
    for (const count of row) {
      if (count > 0) {
        usedCellCount++;
        totalUsageCount += count;
      }

      if (count >= 2) {
        overlapCellCount++;

        // 2語なら1点、3語なら3点、4語なら6点... のように重複を強めに評価
        overlapScore += (count * (count - 1)) / 2;
      }

      if (count > maxUsage) {
        maxUsage = count;
      }
    }
  }

  return {
    usedCellCount,
    totalUsageCount,
    overlapCellCount,
    overlapScore,
    maxUsage
  };
}

function scoreResult(result) {
  const totalPlacedChars = result.placedWords.reduce(
    (sum, word) => sum + word.length,
    0
  );

  const usageStats = calculateUsageStats(result.usageGrid);

  return {
    placedWordCount: result.placedWords.length,
    totalPlacedChars,
    usedCellCount: usageStats.usedCellCount,
    totalUsageCount: usageStats.totalUsageCount,
    overlapCellCount: usageStats.overlapCellCount,
    overlapScore: usageStats.overlapScore,
    maxUsage: usageStats.maxUsage
  };
}

function isBetterResult(candidate, best) {
  if (!best) return true;

  const a = scoreResult(candidate);
  const b = scoreResult(best);

  // 1. まず使われた単語数を最大化
  if (a.placedWordCount !== b.placedWordCount) {
    return a.placedWordCount > b.placedWordCount;
  }

  // 2. 同じ単語数なら、重複スコアが高い方
  if (a.overlapScore !== b.overlapScore) {
    return a.overlapScore > b.overlapScore;
  }

  // 3. 同じなら、重複しているマスの数が多い方
  if (a.overlapCellCount !== b.overlapCellCount) {
    return a.overlapCellCount > b.overlapCellCount;
  }

  // 4. 同じなら、1マスに集まった最大単語数が多い方
  if (a.maxUsage !== b.maxUsage) {
    return a.maxUsage > b.maxUsage;
  }

  // 5. 同じなら、合計文字数が多い方
  if (a.totalPlacedChars !== b.totalPlacedChars) {
    return a.totalPlacedChars > b.totalPlacedChars;
  }

  // 6. 最後に、少ないマスで多くの単語を表現できている方
  return a.usedCellCount < b.usedCellCount;
}

function runSingleAttempt(words, size) {
  const grid = createGrid(size);
  const usageGrid = createUsageGrid(size);
  const orderedWords = createWordOrder(words);

  const placedWords = [];

  for (const word of orderedWords) {
    if (word.length > size) {
      continue;
    }

    const placements = getAllPlacements(grid, usageGrid, word);

    if (placements.length === 0) {
      continue;
    }

    const bestPlacement = chooseBestPlacement(placements, word);

    placeWordAt(grid, usageGrid, word, bestPlacement);
    placedWords.push(word);
  }

  fillGrid(grid);

  return {
    grid,
    usageGrid,
    placedWords
  };
}

function generateWordSearch(words, size) {
  /*
    重複が多い盤面を探すため、試行回数を増やす。
    サイズが大きいと重くなるので調整。
  */

  let attempts = 150;

  if (size >= 18) attempts = 100;
  if (size >= 22) attempts = 70;
  if (size >= 26) attempts = 45;

  let bestResult = null;

  for (let i = 0; i < attempts; i++) {
    const candidate = runSingleAttempt(words, size);

    if (isBetterResult(candidate, bestResult)) {
      bestResult = candidate;
    }
  }

  const placedWords = bestResult.placedWords.sort((a, b) =>
    a.localeCompare(b)
  );

  const placedWordCount = placedWords.length;
  const totalPlacedChars = placedWords.reduce(
    (sum, word) => sum + word.length,
    0
  );

  const usageStats = calculateUsageStats(bestResult.usageGrid);

  return {
    grid: bestResult.grid,
    usageGrid: bestResult.usageGrid,
    placedWords,
    placedWordCount,
    totalPlacedChars,
    size,

    // 追加統計
    usedCellCount: usageStats.usedCellCount,
    totalUsageCount: usageStats.totalUsageCount,
    overlapCellCount: usageStats.overlapCellCount,
    overlapScore: usageStats.overlapScore,
    maxUsage: usageStats.maxUsage
  };
}

app.post("/api/generate", (req, res) => {
  try {
    const { wordType, size } = req.body;

    if (!WORD_FILES[wordType]) {
      return res.status(400).json({
        error: "無効な単語リストです。"
      });
    }

    const numericSize = Number(size);

    if (!Number.isInteger(numericSize) || numericSize < 5 || numericSize > 30) {
      return res.status(400).json({
        error: "盤面サイズは 5〜30 の整数で指定してください。"
      });
    }

    const words = loadWords(WORD_FILES[wordType]);
    const result = generateWordSearch(words, numericSize);

    res.json(result);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "サーバー内部エラーが発生しました。"
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});