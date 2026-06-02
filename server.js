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

// 生成時間の上限。
// 60秒ぴったりだと環境によってタイムアウトしやすいので、少し余裕を見て55秒にしています。
const GENERATION_TIME_LIMIT_MS = 55_000;

// 1回の探索中に、残り単語から何語を候補として詳しく調べるか。
// 大きくすると重複は増えやすいですが、重くなります。
function getCandidateLimit(size) {
  if (size <= 7) return 220;
  if (size <= 10) return 180;
  if (size <= 15) return 130;
  if (size <= 20) return 90;
  if (size <= 25) return 70;
  return 55;
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

  for (const row of grid) {
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

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid.length; x++) {
      const letter = grid[y][x];
      const usage = usageGrid[y][x];

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

      // 新しい単語をこのマスに重ねることで増えるペア数。
      // usage=1 の場所に置くと +1、usage=2 の場所に置くと +2。
      pairOverlapGain += currentUsage;

      // usage 1 -> 2 になるマスは「重複マス数」が新しく1増える。
      if (currentUsage === 1) {
        overlapCellGain++;
      }

      // すでに多くの単語が通っている場所をさらに使うほど強く加点。
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

function placementScore(placement, word, context = {}) {
  const {
    affinity = 0,
    usageAffinity = 0,
    potential = 0,
    placedCount = 0,
    size = 15
  } = context;

  const hasOverlap = placement.overlapCount > 0;

  // 重複優先スコア。
  // pairOverlapGain と heavyOverlapScore をかなり強くして、
  // 既存の重複マスにさらに重ねる配置を選びやすくしています。
  let score =
    placement.pairOverlapGain * 12000 +
    placement.heavyOverlapScore * 3600 +
    placement.overlapCellGain * 5200 +
    placement.overlapCount * 1800 +
    placement.futureMaxUsage * 900 +
    usageAffinity * 260 +
    affinity * 180 +
    potential * 28 -
    placement.newCellCount * 180 +
    word.length * 4;

  // すでに単語が置かれているのに全く重ならない配置は強く減点。
  if (placedCount > 0 && !hasOverlap) {
    score -= size <= 10 ? 2200 : 1400;
  }

  // 小さい盤面ほど新規マスを使いすぎないようにする。
  if (size <= 10) {
    score -= placement.newCellCount * 80;
  }

  // 完全に同点が続くと同じような盤面になりやすいので、少しだけ揺らぎを入れる。
  score += Math.random() * 0.001;

  return score;
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

function chooseBestStep(grid, usageGrid, remainingWords, size, placedCount, deadline) {
  const candidates = createDynamicCandidates(remainingWords, grid, usageGrid, size);

  let best = null;

  for (const candidate of candidates) {
    if (timeIsUp(deadline)) {
      break;
    }

    const placements = getAllPlacements(grid, usageGrid, candidate.word);

    for (const placement of placements) {
      const score = placementScore(placement, candidate.word, {
        affinity: candidate.affinity,
        usageAffinity: candidate.usageAffinity,
        potential: candidate.potential,
        placedCount,
        size
      });

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
  const usageLetterCounts = getUsageLetterCounts(grid);

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
    const score = placementScore(placement, word, context);

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

  for (const row of usageGrid) {
    for (const count of row) {
      if (count > 0) {
        usedCellCount++;
        totalUsageCount += count;
      }

      if (count >= 2) {
        overlapCellCount++;

        // 2語なら1点、3語なら3点、4語なら6点。
        // 1マスに多く重なるほど高評価。
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

  // 1. まず重複スコアを最優先
  if (a.overlapScore !== b.overlapScore) {
    return a.overlapScore > b.overlapScore;
  }

  // 2. 重複しているマス数
  if (a.overlapCellCount !== b.overlapCellCount) {
    return a.overlapCellCount > b.overlapCellCount;
  }

  // 3. 1マスあたりの最大重複数
  if (a.maxUsage !== b.maxUsage) {
    return a.maxUsage > b.maxUsage;
  }

  // 4. 単語数もできるだけ維持
  if (a.placedWordCount !== b.placedWordCount) {
    return a.placedWordCount > b.placedWordCount;
  }

  // 5. 合計文字数
  if (a.totalPlacedChars !== b.totalPlacedChars) {
    return a.totalPlacedChars > b.totalPlacedChars;
  }

  // 6. 同じなら、少ないマスに詰め込めている方
  return a.usedCellCount < b.usedCellCount;
}

function runDynamicOverlapAttempt(words, size, deadline) {
  const grid = createGrid(size);
  const usageGrid = createUsageGrid(size);

  const remainingWords = createInitialWordOrder(words).filter(word => word.length <= size);
  const placedWords = [];

  while (remainingWords.length > 0) {
    if (timeIsUp(deadline)) {
      break;
    }

    const best = chooseBestStep(
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

  const orderedWords = createInitialWordOrder(words).filter(word => word.length <= size);
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

  // 最初の1回は精密探索。
  if (!timeIsUp(deadline)) {
    const candidate = runDynamicOverlapAttempt(words, size, deadline);
    attemptsTried++;

    if (isBetterResult(candidate, bestResult)) {
      bestResult = candidate;
    }
  }

  // 残り時間を使って、精密探索と高速探索を混ぜて多スタート探索。
  while (!timeIsUp(deadline)) {
    const remainingMs = deadline - Date.now();

    let candidate;

    // 残り時間が少ない場合は軽い探索に切り替えます。
    if (remainingMs < 6000) {
      candidate = runFastOverlapAttempt(words, size, deadline);
    } else {
      // 小さい盤面ほど精密探索を多めに、大きい盤面は高速探索も混ぜる。
      const useDynamic =
        size <= 12 ? Math.random() < 0.8 :
        size <= 20 ? Math.random() < 0.55 :
        Math.random() < 0.35;

      candidate = useDynamic
        ? runDynamicOverlapAttempt(words, size, deadline)
        : runFastOverlapAttempt(words, size, deadline);
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

  const placedWords = bestResult.placedWords.sort((a, b) => a.localeCompare(b));
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