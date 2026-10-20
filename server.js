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
const GENERATION_TIME_LIMIT_MS =
  Number(process.env.GENERATION_TIME_LIMIT_MS) || 50_000;

// 全体時間のうち、最初の「初期配置づくり」に使う割合。残りは局所探索で語数を増やす
const CONSTRUCTION_RATIO = 0.4;

// 局所探索1回あたりに試す未配置単語の最大数
const RECREATE_POOL_SAMPLE = 400;

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
    for (let x = 0; x < grid[y].length; x++) {
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
          placements.push({ x, y, dx, dy, ...result });
        }
      }
    }
  }

  return placements;
}

// 盤面の「変化したマス」を必ず通る配置だけを列挙する（高速）。
// 以前置けなかった単語が新たに置けるようになるのは、
// 空いたマス／新しく埋まったマスを通る配置だけなので、これで十分。
function getPlacementsThroughCells(grid, usageGrid, word, touchedKeys, size) {
  const seen = new Set();
  const placements = [];

  for (const key of touchedKeys) {
    const cy = Math.floor(key / size);
    const cx = key % size;
    const cell = grid[cy][cx];

    for (let d = 0; d < DIRECTIONS.length; d++) {
      const [dx, dy] = DIRECTIONS[d];

      for (let i = 0; i < word.length; i++) {
        if (cell !== "" && cell !== word[i]) {
          continue;
        }

        const x = cx - dx * i;
        const y = cy - dy * i;

        if (x < 0 || y < 0 || x >= size || y >= size) {
          continue;
        }

        const placementKey = (y * size + x) * 8 + d;

        if (seen.has(placementKey)) {
          continue;
        }

        seen.add(placementKey);

        const result = canPlace(grid, usageGrid, word, x, y, dx, dy);

        if (result && result.ok) {
          placements.push({ x, y, dx, dy, ...result });
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

function toPlacementRecord(word, placement) {
  return {
    word,
    x: placement.x,
    y: placement.y,
    dx: placement.dx,
    dy: placement.dy
  };
}

// 配置済みの単語を盤面から取り除く。使用数が0になったマスのキーを touched に追加する
function removePlacementFromState(state, record, touched) {
  const size = state.grid.length;

  for (let i = 0; i < record.word.length; i++) {
    const nx = record.x + record.dx * i;
    const ny = record.y + record.dy * i;

    state.usageGrid[ny][nx]--;

    if (state.usageGrid[ny][nx] <= 0) {
      state.usageGrid[ny][nx] = 0;
      state.grid[ny][nx] = "";
      touched.add(ny * size + nx);
    }
  }
}

function addPlacementCellsToTouched(record, size, touched) {
  for (let i = 0; i < record.word.length; i++) {
    const nx = record.x + record.dx * i;
    const ny = record.y + record.dy * i;
    touched.add(ny * size + nx);
  }
}

function cloneState(state) {
  return {
    grid: state.grid.map(row => [...row]),
    usageGrid: state.usageGrid.map(row => [...row]),
    placements: [...state.placements]
  };
}

function fillGrid(grid) {
  const usedLetters = [...new Set(grid.flat().filter(Boolean))];

  const fallbackLetters =
    "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワンABCDEFGHIJKLMNOPQRSTUVWXYZ";

  const letters = usedLetters.length > 0 ? usedLetters.join("") : fallbackLetters;
  const letterArray = [...letters];

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid.length; x++) {
      if (grid[y][x] === "") {
        grid[y][x] = letterArray[Math.floor(Math.random() * letterArray.length)];
      }
    }
  }
}

function getCenteredPlacement(size, word, dx, dy) {
  const center = Math.floor(size / 2);
  const offset = Math.floor((word.length - 1) / 2);

  return {
    x: center - dx * offset,
    y: center - dy * offset,
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
      placeWordAt(grid, usageGrid, firstWord, base);
      return { word: firstWord, placement: base };
    }
  }

  return null;
}

function createDynamicCandidates(
  remainingWords,
  grid,
  usageGrid,
  size,
  preferShort
) {
  const boardLetterCounts = getBoardLetterCounts(grid);
  const usageLetterCounts = getUsageLetterCounts(grid, usageGrid);

  const hasPlacedLetters = Object.keys(boardLetterCounts).length > 0;
  const limit = getCandidateLimit(size);

  const scored = shuffle(remainingWords).map(word => ({
    word,
    affinity: getWordBoardAffinity(word, boardLetterCounts),
    usageAffinity: getWordBoardAffinity(word, usageLetterCounts),
    potential: getWordOverlapPotential(word),
    // 短い単語ほど少ないマスで置けるので、語数を稼ぎやすい（少しノイズを入れて多様化）
    shortKey: word.length + Math.random() * 3
  }));

  scored.sort((a, b) => {
    if (preferShort && a.shortKey !== b.shortKey) {
      return a.shortKey - b.shortKey;
    }

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
  });

  return scored.slice(0, limit);
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

// 語数最大化向け：新しく消費するマスを最小にし、既存の文字を再利用する配置を優先
function placementScoreCompact(placement, word, context = {}) {
  const { placedCount = 0 } = context;

  let score =
    -placement.newCellCount * 3000 +
    placement.pairOverlapGain * 600 +
    placement.heavyOverlapScore * 300 +
    placement.overlapCellGain * 400 -
    word.length * 150;

  if (placedCount > 0 && placement.overlapCount === 0) {
    score -= 1500;
  }

  // 少しノイズを入れて、局所探索や複数試行で多様な盤面が出るようにする
  score += Math.random() * 400;

  return score;
}

function chooseBestStep(
  grid,
  usageGrid,
  remainingWords,
  size,
  placedCount,
  deadline,
  scoreFn,
  preferShort
) {
  const candidates = createDynamicCandidates(
    remainingWords,
    grid,
    usageGrid,
    size,
    preferShort
  );

  let best = null;
  const dead = [];

  for (const candidate of candidates) {
    if (timeIsUp(deadline)) {
      break;
    }

    const placements = getAllPlacements(grid, usageGrid, candidate.word);

    // 盤面は埋まる一方なので、今置けない単語は今後も置けない → 除外して無駄な探索を減らす
    if (placements.length === 0) {
      dead.push(candidate.word);
      continue;
    }

    for (const placement of placements) {
      const score = scoreFn(placement, candidate.word, {
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

  return { best, dead };
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

  for (const row of usageGrid) {
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
  const totalPlacedChars = result.placements.reduce(
    (sum, p) => sum + p.word.length,
    0
  );

  const usageStats = calculateUsageStats(result.usageGrid);

  return {
    placedWordCount: result.placements.length,
    totalPlacedChars,
    ...usageStats
  };
}

// モードごとの比較順序。先頭の指標ほど優先される（最後に usedCellCount が小さい方を優先）
const COMPARE_KEYS = {
  // 語数重視：配置できた単語数を最優先
  count: [
    "placedWordCount",
    "concentratedOverlapScore",
    "overlapScore",
    "maxUsage",
    "highOverlapCellCount",
    "overlapCellCount",
    "totalPlacedChars"
  ],
  // 重複重視：高重複（1マスに多くの単語が重なる）を最優先
  overlap: [
    "concentratedOverlapScore",
    "overlapScore",
    "maxUsage",
    "highOverlapCellCount",
    "overlapCellCount",
    "placedWordCount",
    "totalPlacedChars"
  ]
};

function compareResults(candidate, best, mode) {
  const a = scoreResult(candidate);
  const b = scoreResult(best);

  for (const key of COMPARE_KEYS[mode]) {
    if (a[key] !== b[key]) {
      return a[key] - b[key];
    }
  }

  return b.usedCellCount - a.usedCellCount;
}

function isBetterResult(candidate, best, mode = "count") {
  if (!best) return true;

  return compareResults(candidate, best, mode) > 0;
}

// 貪欲法による1回分の構築。fillGrid は最後にまとめて行うのでここでは呼ばない
function runGreedyAttempt(words, size, deadline, options) {
  const { centerSeed, scoreFn, preferShort } = options;

  const grid = createGrid(size);
  const usageGrid = createUsageGrid(size);

  let remainingWords = createInitialWordOrder(words).filter(
    word => word.length <= size
  );

  const placements = [];

  if (centerSeed) {
    const first = placeFirstWordAtCenter(grid, usageGrid, remainingWords, size);

    if (first) {
      placements.push(toPlacementRecord(first.word, first.placement));
      remainingWords = remainingWords.filter(word => word !== first.word);
    }
  }

  while (remainingWords.length > 0 && !timeIsUp(deadline)) {
    const { best, dead } = chooseBestStep(
      grid,
      usageGrid,
      remainingWords,
      size,
      placements.length,
      deadline,
      scoreFn,
      preferShort
    );

    if (dead.length > 0) {
      const deadSet = new Set(dead);
      remainingWords = remainingWords.filter(word => !deadSet.has(word));
    }

    if (!best) {
      // 時間切れ以外で best が無いのは「候補が全部置けなかった」場合。
      // dead を除外済みなので次のループで次の候補群を試す。
      if (dead.length === 0) {
        break;
      }
      continue;
    }

    placeWordAt(grid, usageGrid, best.word, best.placement);
    placements.push(toPlacementRecord(best.word, best.placement));
    remainingWords = remainingWords.filter(word => word !== best.word);
  }

  return { grid, usageGrid, placements };
}

function runFastAttempt(words, size, deadline) {
  const grid = createGrid(size);
  const usageGrid = createUsageGrid(size);

  const orderedWords = createInitialWordOrder(words).filter(
    word => word.length <= size
  );

  const placements = [];

  for (const word of orderedWords) {
    if (timeIsUp(deadline)) {
      break;
    }

    const placement = chooseBestPlacementForFixedWord(
      grid,
      usageGrid,
      word,
      size,
      placements.length
    );

    if (!placement) {
      continue;
    }

    placeWordAt(grid, usageGrid, word, placement);
    placements.push(toPlacementRecord(word, placement));
  }

  return { grid, usageGrid, placements };
}

// 未配置の単語を、盤面全体から探して置ける限り詰め込む（短い単語から）
function fillRemainingWords(state, eligibleWords, size, deadline) {
  const placedSet = new Set(state.placements.map(p => p.word));

  const rest = shuffle(eligibleWords.filter(word => !placedSet.has(word))).sort(
    (a, b) => a.length - b.length
  );

  for (const word of rest) {
    if (timeIsUp(deadline)) {
      break;
    }

    const placement = chooseBestPlacementForFixedWord(
      state.grid,
      state.usageGrid,
      word,
      size,
      state.placements.length
    );

    if (!placement) {
      continue;
    }

    placeWordAt(state.grid, state.usageGrid, word, placement);
    state.placements.push(toPlacementRecord(word, placement));
  }
}

// ruin & recreate：数語を盤面から外して空きを作り、
// 未配置の単語をその空きを使って（外した語より多く）詰め直す
function ruinAndRecreate(state, eligibleWords, size, config) {
  const next = cloneState(state);

  if (next.placements.length === 0) {
    return next;
  }

  const removeCount = Math.min(
    next.placements.length,
    1 + Math.floor(Math.random() * 3)
  );

  const removedRecords = shuffle(next.placements).slice(0, removeCount);
  const removedSet = new Set(removedRecords);
  const touched = new Set();

  for (const record of removedRecords) {
    removePlacementFromState(next, record, touched);
  }

  next.placements = next.placements.filter(p => !removedSet.has(p));

  const placedSet = new Set(next.placements.map(p => p.word));
  const removedWords = removedRecords.map(p => p.word);

  const otherUnplaced = shuffle(
    eligibleWords.filter(
      word => !placedSet.has(word) && !removedWords.includes(word)
    )
  ).slice(0, RECREATE_POOL_SAMPLE);

  const pool = [...removedWords, ...otherUnplaced];

  while (true) {
    let best = null;

    for (const word of pool) {
      if (placedSet.has(word)) {
        continue;
      }

      const placements = getPlacementsThroughCells(
        next.grid,
        next.usageGrid,
        word,
        touched,
        size
      );

      for (const placement of placements) {
        const score = config.recreateScore(placement, word, {
          placedCount: next.placements.length,
          size
        });

        if (!best || score > best.score) {
          best = { word, placement, score };
        }
      }
    }

    if (!best) {
      break;
    }

    placeWordAt(next.grid, next.usageGrid, best.word, best.placement);

    const record = toPlacementRecord(best.word, best.placement);
    next.placements.push(record);
    placedSet.add(best.word);
    addPlacementCellsToTouched(record, size, touched);
  }

  return next;
}

function improveByLocalSearch(
  startState,
  eligibleWords,
  size,
  deadline,
  config
) {
  const eligibleCount = eligibleWords.length;

  let current = startState;
  let best = startState;
  let iterations = 0;

  while (!timeIsUp(deadline)) {
    if (config.stopWhenAllPlaced && best.placements.length >= eligibleCount) {
      break;
    }

    const candidate = ruinAndRecreate(current, eligibleWords, size, config);
    iterations++;

    // 同等でも受け入れる（横移動）ことで局所解から抜け出しやすくする
    if (config.accept(candidate, current)) {
      current = candidate;

      if (isBetterResult(candidate, best, config.mode)) {
        best = candidate;
      }
    }
  }

  return { best, iterations };
}

const MODES = ["count", "overlap"];

// モードごとの設定：構築戦略・局所探索の採点と受理条件・時間配分を切り替える
function getModeConfig(mode, words, size) {
  const greedy = (centerSeed, scoreFn, preferShort) => dl =>
    runGreedyAttempt(words, size, dl, { centerSeed, scoreFn, preferShort });

  if (mode === "overlap") {
    return {
      mode,
      // 重複重視は構築の多様性より局所探索の効果が大きいので、探索に多めに時間を割く
      constructionRatio: 0.35,
      // 重複には上限がないので、全単語を置けても終了せず時間いっぱい改善を続ける
      stopWhenAllPlaced: false,
      strategies: [
        { weight: 0.45, run: greedy(true, placementScoreByOverlapRatio, false) },
        { weight: 0.2, run: greedy(false, placementScoreBalanced, false) },
        // 小さい盤面では「たくさん詰める」ほど重複も増えやすいので、詰め込み型も候補に混ぜる
        { weight: 0.15, run: greedy(true, placementScoreCompact, true) },
        { weight: 0.15, run: greedy(false, placementScoreCompact, true) },
        { weight: 0.05, run: dl => runFastAttempt(words, size, dl) }
      ],
      recreateScore: (placement, word, context) =>
        placementScoreByOverlapRatio(placement, word, context) +
        Math.random() * 3000,
      // 重複指標が同等以上なら採用（語数が減っても重複が増えるなら良しとする）
      accept: (candidate, current) =>
        compareResults(candidate, current, "overlap") >= 0
    };
  }

  return {
    mode: "count",
    constructionRatio: 0.4,
    stopWhenAllPlaced: true,
    strategies: [
      { weight: 0.3, run: greedy(false, placementScoreCompact, true) },
      { weight: 0.2, run: greedy(true, placementScoreCompact, true) },
      { weight: 0.2, run: greedy(true, placementScoreByOverlapRatio, false) },
      { weight: 0.15, run: greedy(false, placementScoreBalanced, false) },
      { weight: 0.15, run: dl => runFastAttempt(words, size, dl) }
    ],
    recreateScore: placementScoreCompact,
    // 語数が減らなければ採用
    accept: (candidate, current) =>
      candidate.placements.length >= current.placements.length
  };
}

function generateWordSearch(words, size, mode = "count") {
  const startTime = Date.now();
  const deadline = startTime + GENERATION_TIME_LIMIT_MS;

  const config = getModeConfig(mode, words, size);
  const constructionDeadline =
    startTime + GENERATION_TIME_LIMIT_MS * config.constructionRatio;

  const eligibleWords = words.filter(word => word.length <= size);
  const eligibleCount = eligibleWords.length;

  const strategies = config.strategies;

  function pickStrategy() {
    let r = Math.random();

    for (const strategy of strategies) {
      if (r < strategy.weight) {
        return strategy;
      }
      r -= strategy.weight;
    }

    return strategies[0];
  }

  let bestResult = null;
  let attemptsTried = 0;

  // ---- フェーズ1：複数方式で初期配置を作り、モードの基準で最良のものを採用 ----
  do {
    // 最初の1回は、そのモードで最も狙いに合う方式を必ず試す
    const strategy = attemptsTried === 0 ? strategies[0] : pickStrategy();
    const candidate = strategy.run(constructionDeadline);
    attemptsTried++;

    if (isBetterResult(candidate, bestResult, config.mode)) {
      bestResult = candidate;
    }
  } while (
    !timeIsUp(constructionDeadline) &&
    !(config.stopWhenAllPlaced && bestResult.placements.length >= eligibleCount)
  );

  // ---- フェーズ2：盤面全体を探して置ける単語を詰め込む ----
  fillRemainingWords(bestResult, eligibleWords, size, deadline);

  // ---- フェーズ3：局所探索（ruin & recreate）でモードの指標をさらに改善 ----
  const improved = improveByLocalSearch(
    bestResult,
    eligibleWords,
    size,
    deadline,
    config
  );

  bestResult = improved.best;

  fillGrid(bestResult.grid);

  const placedWords = bestResult.placements
    .map(p => p.word)
    .sort((a, b) => a.localeCompare(b));

  const placedWordCount = placedWords.length;

  const totalPlacedChars = placedWords.reduce(
    (sum, word) => sum + word.length,
    0
  );

  const usageStats = calculateUsageStats(bestResult.usageGrid);
  const generationMs = Date.now() - startTime;

  return {
    mode: config.mode,
    grid: bestResult.grid,
    usageGrid: bestResult.usageGrid,
    placedWords,
    placedWordCount,
    totalPlacedChars,
    size,

    totalWordCount: words.length,
    eligibleWordCount: eligibleCount,
    unplacedWordCount: eligibleCount - placedWordCount,

    usedCellCount: usageStats.usedCellCount,
    totalUsageCount: usageStats.totalUsageCount,
    overlapCellCount: usageStats.overlapCellCount,
    overlapScore: usageStats.overlapScore,
    maxUsage: usageStats.maxUsage,
    concentratedOverlapScore: usageStats.concentratedOverlapScore,
    highOverlapCellCount: usageStats.highOverlapCellCount,

    attemptsTried,
    localSearchIterations: improved.iterations,
    generationMs
  };
}

app.post("/api/generate", (req, res) => {
  try {
    const { wordType, size, mode = "count" } = req.body;

    if (!WORD_FILES[wordType]) {
      return res.status(400).json({
        error: "無効な単語リストです。"
      });
    }

    if (!MODES.includes(mode)) {
      return res.status(400).json({
        error: "無効な生成モードです。"
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

    const result = generateWordSearch(words, numericSize, mode);

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