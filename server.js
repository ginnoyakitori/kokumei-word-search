const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname)));

const WORD_FILES = {
  countries: ["kokumei.txt", "countries.txt"],
  capitals: ["shutomei.txt", "capitals.txt"],
  pokemon: ["pokemon.txt"]
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

const CENTER_DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1]
];

// Render上で1分ギリギリにすると不安定になりやすいので少し余裕を持たせています
const GENERATION_TIME_LIMIT_MS = 50_000;

function getCandidateLimit(size) {
  if (size <= 7) return 220;
  if (size <= 10) return 180;
  if (size <= 15) return 140;
  if (size <= 20) return 100;
  if (size <= 25) return 75;
  return 60;
}

function normalizeWord(word) {
  return word
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toUpperCase();
}

function isMetadataLine(line) {
  return (
    line.startsWith("<<<<<<<") ||
    line.startsWith("=======") ||
    line.startsWith(">>>>>>>")
  );
}

function resolveWordFile(filenames) {
  for (const filename of filenames) {
    const filePath = path.join(__dirname, filename);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

function loadWords(filenames) {
  const filePath = resolveWordFile(filenames);

  if (!filePath) {
    throw new Error(`単語ファイルが見つかりません: ${filenames.join(", ")}`);
  }

  const raw = fs.readFileSync(filePath, "utf-8");

  const words = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !isMetadataLine(line))
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

function timeIsUp(deadline) {
  return Date.now() >= deadline;
}

function getLetterCounts(text) {
  const counts = {};

  for (const letter of text) {
    counts[letter] = (counts[letter] || 0) + 1;
  }

  return counts;
}

function getWordOverlapPotential(word) {
  const counts = getLetterCounts(word);

  return Object.values(counts).reduce((sum, count) => {
    return sum + count * count;
  }, 0);
}

function getBoardLetterCounts(grid) {
  const counts = {};

  if (!Array.isArray(grid)) {
    return counts;
  }

  for (const row of grid) {
    if (!Array.isArray(row)) {
      continue;
    }

    for (const letter of row) {
      if (letter) {
        counts[letter] = (counts[letter] || 0) + 1;
      }
    }
  }

  return counts;
}

function getUsageLetterCounts(grid, usageGrid) {
  const counts = {};

  if (!Array.isArray(grid) || !Array.isArray(usageGrid)) {
    return counts;
  }

  const height = Math.min(grid.length, usageGrid.length);

  for (let y = 0; y < height; y++) {
    const gridRow = grid[y];
    const usageRow = usageGrid[y];

    if (!Array.isArray(gridRow) || !Array.isArray(usageRow)) {
      continue;
    }

    const width = Math.min(gridRow.length, usageRow.length);

    for (let x = 0; x < width; x++) {
      const letter = gridRow[x];
      const usage = usageRow[x];

      if (letter && usage > 0) {
        counts[letter] = (counts[letter] || 0) + usage;
      }
    }
  }

  return counts;
}

function getWordBoardAffinity(word, boardLetterCounts) {
  const wordLetterCounts = getLetterCounts(word);

  return Object.entries(wordLetterCounts).reduce((sum, [letter, count]) => {
    return sum + Math.min(count, boardLetterCounts[letter] || 0);
  }, 0);
}

function createInitialWordOrder(words) {
  return shuffle(words).sort((a, b) => {
    const aPotential = getWordOverlapPotential(a);
    const bPotential = getWordOverlapPotential(b);

    if (aPotential !== bPotential) {
      return bPotential - aPotential;
    }

    if (a.length !== b.length) {
      return a.length - b.length;
    }

    return Math.random() - 0.5;
  });
}

function canPlace(grid, usageGrid, word, x, y, dx, dy) {
  const size = grid.length;

  let overlapCount = 0;
  let overlapCellGain = 0;
  let pairOverlapGain = 0;
  let heavyOverlapScore = 0;
  let newCellCount = 0;
  let reusedCellCount = 0;
  let futureMaxUsage = 0;

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

    const currentUsage = usageGrid[ny][nx];

    if (current === word[i]) {
      overlapCount++;
      reusedCellCount++;

      pairOverlapGain += currentUsage;

      if (currentUsage === 1) {
        overlapCellGain++;
      }

      heavyOverlapScore += currentUsage * currentUsage;
      futureMaxUsage = Math.max(futureMaxUsage, currentUsage + 1);
    } else {
      newCellCount++;
      futureMaxUsage = Math.max(futureMaxUsage, 1);
    }
  }

  return {
    ok: true,
    overlapCount,
    overlapCellGain,
    pairOverlapGain,
    heavyOverlapScore,
    newCellCount,
    reusedCellCount,
    futureMaxUsage
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
            overlapCellGain: result.overlapCellGain,
            pairOverlapGain: result.pairOverlapGain,
            heavyOverlapScore: result.heavyOverlapScore,
            newCellCount: result.newCellCount,
            reusedCellCount: result.reusedCellCount,
            futureMaxUsage: result.futureMaxUsage
          });
        }
      }
    }
  }

  return placements;
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
  const usedLetters = [...new Set(grid.flat().filter(Boolean))];

  const fallbackLetters =
    "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワンABCDEFGHIJKLMNOPQRSTUVWXYZ";

  const letters = usedLetters.length > 0 ? usedLetters.join("") : fallbackLetters;

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid.length; x++) {
      if (grid[y][x] === "") {
        grid[y][x] = letters[Math.floor(Math.random() * letters.length)];
      }
    }
  }
}

function getCenteredPlacement(size, word, dx, dy) {
  const center = Math.floor(size / 2);
  const offset = Math.floor((word.length - 1) / 2);

  const startX = center - dx * offset;
  const startY = center - dy * offset;

  return {
    x: startX,
    y: startY,
    dx,
    dy
  };
}

function chooseFirstWordForCenter(words, size) {
  const candidates = shuffle(words)
    .filter(word => word.length <= size)
    .sort((a, b) => {
      const aPotential = getWordOverlapPotential(a);
      const bPotential = getWordOverlapPotential(b);

      if (aPotential !== bPotential) {
        return bPotential - aPotential;
      }

      // 長すぎる単語より、中央から派生しやすい中くらいの単語を少し優先
      const idealLength = Math.max(3, Math.floor(size * 0.65));
      const aDistance = Math.abs(a.length - idealLength);
      const bDistance = Math.abs(b.length - idealLength);

      if (aDistance !== bDistance) {
        return aDistance - bDistance;
      }

      return Math.random() - 0.5;
    });

  return candidates[0] || null;
}

function placeFirstWordAtCenter(grid, usageGrid, remainingWords, size) {
  const firstWord = chooseFirstWordForCenter(remainingWords, size);

  if (!firstWord) {
    return null;
  }

  const directions = shuffle(CENTER_DIRECTIONS);

  for (const [dx, dy] of directions) {
    const base = getCenteredPlacement(size, firstWord, dx, dy);

    const check = canPlace(
      grid,
      usageGrid,
      firstWord,
      base.x,
      base.y,
      base.dx,
      base.dy
    );

    if (check && check.ok) {
      const placement = {
        x: base.x,
        y: base.y,
        dx: base.dx,
        dy: base.dy,
        overlapCount: 0,
        overlapCellGain: 0,
        pairOverlapGain: 0,
        heavyOverlapScore: 0,
        newCellCount: firstWord.length,
        reusedCellCount: 0,
        futureMaxUsage: 1
      };

      placeWordAt(grid, usageGrid, firstWord, placement);
      return firstWord;
    }
  }

  return null;
}

function createDynamicCandidates(remainingWords, grid, usageGrid, size) {
  const boardLetterCounts = getBoardLetterCounts(grid);
  const usageLetterCounts = getUsageLetterCounts(grid, usageGrid);

  const hasPlacedLetters = Object.keys(boardLetterCounts).length > 0;
  const limit = getCandidateLimit(size);

  return shuffle(remainingWords)
    .map(word => {
      const affinity = getWordBoardAffinity(word, boardLetterCounts);
      const usageAffinity = getWordBoardAffinity(word, usageLetterCounts);
      const potential = getWordOverlapPotential(word);

      return {
        word,
        affinity,
        usageAffinity,
        potential
      };
    })
    .sort((a, b) => {
      if (hasPlacedLetters && a.usageAffinity !== b.usageAffinity) {
        return b.usageAffinity - a.usageAffinity;
      }

      if (hasPlacedLetters && a.affinity !== b.affinity) {
        return b.affinity - a.affinity;
      }

      if (a.potential !== b.potential) {
        return b.potential - a.potential;
      }

      if (a.word.length !== b.word.length) {
        return a.word.length - b.word.length;
      }

      return Math.random() - 0.5;
    })
    .slice(0, limit);
}

function placementScoreByOverlapRatio(placement, word, context = {}) {
  const {
    affinity = 0,
    usageAffinity = 0,
    potential = 0,
    placedCount = 0,
    size = 15
  } = context;

  const overlapRatio = placement.overlapCount / word.length;
  const hasOverlap = placement.overlapCount > 0;

  let score =
    overlapRatio * 90000 +
    placement.heavyOverlapScore * 22000 +
    placement.pairOverlapGain * 18000 +
    placement.futureMaxUsage * 9000 +
    placement.overlapCount * 6000 +
    placement.overlapCellGain * 1600 +
    usageAffinity * 650 +
    affinity * 260 +
    potential * 35 -
    placement.newCellCount * 1100 +
    word.length * 2;

  if (placedCount > 0 && !hasOverlap) {
    score -= size <= 10 ? 16000 : 10000;
  }

  if (size <= 10) {
    score -= placement.newCellCount * 700;
  } else if (size <= 15) {
    score -= placement.newCellCount * 450;
  } else {
    score -= placement.newCellCount * 260;
  }

  score += Math.random() * 0.001;

  return score;
}

function placementScoreBalanced(placement, word, context = {}) {
  const {
    affinity = 0,
    usageAffinity = 0,
    potential = 0,
    placedCount = 0,
    size = 15
  } = context;

  const hasOverlap = placement.overlapCount > 0;

  let score =
    placement.pairOverlapGain * 12000 +
    placement.heavyOverlapScore * 8500 +
    placement.overlapCellGain * 4600 +
    placement.overlapCount * 2200 +
    placement.futureMaxUsage * 2500 +
    usageAffinity * 380 +
    affinity * 220 +
    potential * 30 -
    placement.newCellCount * 260 +
    word.length * 5;

  if (placedCount > 0 && !hasOverlap) {
    score -= size <= 10 ? 5000 : 3000;
  }

  score += Math.random() * 0.001;

  return score;
}

function chooseBestStepByOverlapRatio(
  grid,
  usageGrid,
  remainingWords,
  size,
  placedCount,
  deadline
) {
  const candidates = createDynamicCandidates(
    remainingWords,
    grid,
    usageGrid,
    size
  );

  let best = null;

  for (const candidate of candidates) {
    if (timeIsUp(deadline)) {
      break;
    }

    const placements = getAllPlacements(grid, usageGrid, candidate.word);

    for (const placement of placements) {
      const score = placementScoreByOverlapRatio(
        placement,
        candidate.word,
        {
          affinity: candidate.affinity,
          usageAffinity: candidate.usageAffinity,
          potential: candidate.potential,
          placedCount,
          size
        }
      );

      if (!best || score > best.score) {
        best = {
          word: candidate.word,
          placement,
          score
        };
      }
    }
  }

  return best;
}

function chooseBestStepBalanced(
  grid,
  usageGrid,
  remainingWords,
  size,
  placedCount,
  deadline
) {
  const candidates = createDynamicCandidates(
    remainingWords,
    grid,
    usageGrid,
    size
  );

  let best = null;

  for (const candidate of candidates) {
    if (timeIsUp(deadline)) {
      break;
    }

    const placements = getAllPlacements(grid, usageGrid, candidate.word);

    for (const placement of placements) {
      const score = placementScoreBalanced(
        placement,
        candidate.word,
        {
          affinity: candidate.affinity,
          usageAffinity: candidate.usageAffinity,
          potential: candidate.potential,
          placedCount,
          size
        }
      );

      if (!best || score > best.score) {
        best = {
          word: candidate.word,
          placement,
          score
        };
      }
    }
  }

  return best;
}

function chooseBestPlacementForFixedWord(grid, usageGrid, word, size, placedCount) {
  const boardLetterCounts = getBoardLetterCounts(grid);
  const usageLetterCounts = getUsageLetterCounts(grid, usageGrid);

  const context = {
    affinity: getWordBoardAffinity(word, boardLetterCounts),
    usageAffinity: getWordBoardAffinity(word, usageLetterCounts),
    potential: getWordOverlapPotential(word),
    placedCount,
    size
  };

  const placements = getAllPlacements(grid, usageGrid, word);

  if (placements.length === 0) {
    return null;
  }

  let bestScore = -Infinity;
  let bestPlacements = [];

  for (const placement of placements) {
    const score = placementScoreBalanced(placement, word, context);

    if (score > bestScore) {
      bestScore = score;
      bestPlacements = [placement];
    } else if (score === bestScore) {
      bestPlacements.push(placement);
    }
  }

  return bestPlacements[Math.floor(Math.random() * bestPlacements.length)];
}

function calculateUsageStats(usageGrid) {
  let usedCellCount = 0;
  let totalUsageCount = 0;
  let overlapCellCount = 0;
  let overlapScore = 0;
  let maxUsage = 0;
  let concentratedOverlapScore = 0;
  let highOverlapCellCount = 0;

  if (!Array.isArray(usageGrid)) {
    return {
      usedCellCount,
      totalUsageCount,
      overlapCellCount,
      overlapScore,
      maxUsage,
      concentratedOverlapScore,
      highOverlapCellCount
    };
  }

  for (const row of usageGrid) {
    if (!Array.isArray(row)) {
      continue;
    }

    for (const count of row) {
      if (count > 0) {
        usedCellCount++;
        totalUsageCount += count;
      }

      if (count >= 2) {
        overlapCellCount++;
        overlapScore += (count * (count - 1)) / 2;
        concentratedOverlapScore += count * count * count;
      }

      if (count >= 3) {
        highOverlapCellCount++;
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
    maxUsage,
    concentratedOverlapScore,
    highOverlapCellCount
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
    maxUsage: usageStats.maxUsage,
    concentratedOverlapScore: usageStats.concentratedOverlapScore,
    highOverlapCellCount: usageStats.highOverlapCellCount
  };
}

function isBetterResult(candidate, best) {
  if (!best) return true;

  const a = scoreResult(candidate);
  const b = scoreResult(best);

  // 1. 高重複を強く評価
  if (a.concentratedOverlapScore !== b.concentratedOverlapScore) {
    return a.concentratedOverlapScore > b.concentratedOverlapScore;
  }

  // 2. 通常の重複スコア
  if (a.overlapScore !== b.overlapScore) {
    return a.overlapScore > b.overlapScore;
  }

  // 3. 1マスに最大何語重なったか
  if (a.maxUsage !== b.maxUsage) {
    return a.maxUsage > b.maxUsage;
  }

  // 4. 3語以上重なっているマス数
  if (a.highOverlapCellCount !== b.highOverlapCellCount) {
    return a.highOverlapCellCount > b.highOverlapCellCount;
  }

  // 5. 重複しているマス数
  if (a.overlapCellCount !== b.overlapCellCount) {
    return a.overlapCellCount > b.overlapCellCount;
  }

  // 6. 単語数もできるだけ多く
  if (a.placedWordCount !== b.placedWordCount) {
    return a.placedWordCount > b.placedWordCount;
  }

  // 7. 合計文字数
  if (a.totalPlacedChars !== b.totalPlacedChars) {
    return a.totalPlacedChars > b.totalPlacedChars;
  }

  // 8. 少ないマスに詰め込めている方
  return a.usedCellCount < b.usedCellCount;
}

function runCenterSeedOverlapAttempt(words, size, deadline) {
  const grid = createGrid(size);
  const usageGrid = createUsageGrid(size);

  const remainingWords = createInitialWordOrder(words).filter(
    word => word.length <= size
  );

  const placedWords = [];

  const firstWord = placeFirstWordAtCenter(
    grid,
    usageGrid,
    remainingWords,
    size
  );

  if (firstWord) {
    placedWords.push(firstWord);

    const index = remainingWords.indexOf(firstWord);
    if (index !== -1) {
      remainingWords.splice(index, 1);
    }
  }

  while (remainingWords.length > 0) {
    if (timeIsUp(deadline)) {
      break;
    }

    const best = chooseBestStepByOverlapRatio(
      grid,
      usageGrid,
      remainingWords,
      size,
      placedWords.length,
      deadline
    );

    if (!best) {
      break;
    }

    placeWordAt(grid, usageGrid, best.word, best.placement);
    placedWords.push(best.word);

    const index = remainingWords.indexOf(best.word);
    if (index !== -1) {
      remainingWords.splice(index, 1);
    }
  }

  fillGrid(grid);

  return {
    grid,
    usageGrid,
    placedWords
  };
}

function runBalancedOverlapAttempt(words, size, deadline) {
  const grid = createGrid(size);
  const usageGrid = createUsageGrid(size);

  const remainingWords = createInitialWordOrder(words).filter(
    word => word.length <= size
  );

  const placedWords = [];

  while (remainingWords.length > 0) {
    if (timeIsUp(deadline)) {
      break;
    }

    const best = chooseBestStepBalanced(
      grid,
      usageGrid,
      remainingWords,
      size,
      placedWords.length,
      deadline
    );

    if (!best) {
      break;
    }

    placeWordAt(grid, usageGrid, best.word, best.placement);
    placedWords.push(best.word);

    const index = remainingWords.indexOf(best.word);
    if (index !== -1) {
      remainingWords.splice(index, 1);
    }
  }

  fillGrid(grid);

  return {
    grid,
    usageGrid,
    placedWords
  };
}

function runFastOverlapAttempt(words, size, deadline) {
  const grid = createGrid(size);
  const usageGrid = createUsageGrid(size);

  const orderedWords = createInitialWordOrder(words).filter(
    word => word.length <= size
  );

  const placedWords = [];

  for (const word of orderedWords) {
    if (timeIsUp(deadline)) {
      break;
    }

    const placement = chooseBestPlacementForFixedWord(
      grid,
      usageGrid,
      word,
      size,
      placedWords.length
    );

    if (!placement) {
      continue;
    }

    placeWordAt(grid, usageGrid, word, placement);
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
  const startTime = Date.now();
  const deadline = startTime + GENERATION_TIME_LIMIT_MS;

  let bestResult = null;
  let attemptsTried = 0;

  // 最初は中央配置方式を必ず試す
  if (!timeIsUp(deadline)) {
    const candidate = runCenterSeedOverlapAttempt(words, size, deadline);
    attemptsTried++;

    if (isBetterResult(candidate, bestResult)) {
      bestResult = candidate;
    }
  }

  // 残り時間で複数方式を試す
  while (!timeIsUp(deadline)) {
    const remainingMs = deadline - Date.now();

    let candidate;

    if (remainingMs < 5000) {
      candidate = runFastOverlapAttempt(words, size, deadline);
    } else {
      const r = Math.random();

      if (r < 0.65) {
        // 中央スタート + 重複割合重視
        candidate = runCenterSeedOverlapAttempt(words, size, deadline);
      } else if (r < 0.9) {
        // 通常の重複バランス型
        candidate = runBalancedOverlapAttempt(words, size, deadline);
      } else {
        // 高速型
        candidate = runFastOverlapAttempt(words, size, deadline);
      }
    }

    attemptsTried++;

    if (isBetterResult(candidate, bestResult)) {
      bestResult = candidate;
    }
  }

  if (!bestResult) {
    bestResult = runFastOverlapAttempt(words, size, Date.now() + 1000);
    attemptsTried++;
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
  const generationMs = Date.now() - startTime;

  return {
    grid: bestResult.grid,
    usageGrid: bestResult.usageGrid,
    placedWords,
    placedWordCount,
    totalPlacedChars,
    size,

    usedCellCount: usageStats.usedCellCount,
    totalUsageCount: usageStats.totalUsageCount,
    overlapCellCount: usageStats.overlapCellCount,
    overlapScore: usageStats.overlapScore,
    maxUsage: usageStats.maxUsage,
    concentratedOverlapScore: usageStats.concentratedOverlapScore,
    highOverlapCellCount: usageStats.highOverlapCellCount,

    attemptsTried,
    generationMs
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

    if (words.length === 0) {
      return res.status(400).json({
        error: "単語リストが空です。"
      });
    }

    const result = generateWordSearch(words, numericSize);

    res.json(result);
  } catch (error) {
    console.error("API /api/generate error:", error);

    res.status(500).json({
      error: "サーバー内部エラーが発生しました。",
      detail: error.message,
      stack: process.env.NODE_ENV === "production" ? undefined : error.stack
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});