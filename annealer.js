"use strict";

// ============================================================
// 焼きなまし法（Simulated Annealing）によるシークワーズ生成
//
// 「単語を置く」のではなく「盤面の文字そのもの」を直接最適化する。
//   - 語数重視  : 盤面から見つかる辞書単語の種類数を最大化
//   - 重複重視  : 見つかる単語の合計文字数
//                 ＝「各座標の文字が何個の単語に使われているか」の合計 を最大化
// 同じ単語が盤面に複数回現れても、1単語として数える。
//
// 1手ごとの再評価は「変更したマスを通る8方向のライン」だけなので非常に速い。
// ============================================================

const DX = [1, -1, 0, 0, 1, -1, 1, -1];
const DY = [0, 0, 1, -1, 1, -1, -1, 1];

function makeRng(seed) {
  let s = (seed >>> 0) || 2463534242;

  return function next() {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

// ------------------------------------------------------------
// サイズ別のパラメータ
// ------------------------------------------------------------
function getAnnealConfig(size, mode, limitMs) {
  const cells = size * size;

  // 小さい盤面ほど収束が早いので、必要以上に時間を使わない
  const budgetMs = Math.min(limitMs, Math.round(Math.max(4000, 2500 + cells * 55)));

  // 小さい盤面は「複数回やり直して最良を採用」、大きい盤面は「1回をじっくり」
  let runs;
  if (size <= 8) runs = 3;
  else if (size <= 12) runs = 3;
  else if (size <= 16) runs = 2;
  else runs = 1;

  // ベンチマークで調整した値（8×8）。大きい盤面は手の質が重要なので試行数を増やす
  return {
    budgetMs,
    runs,
    // 開始温度・終了温度は「単語1つの重み」に対する倍率
    t0Ratio: 0.3,
    t1Ratio: 0.03,
    plantProb: 0.4,
    plantTries: size <= 10 ? 60 : size <= 16 ? 80 : 100
  };
}

// ------------------------------------------------------------
// モデル作成：アルファベット・トライ木・重み
// ------------------------------------------------------------
function createModel(words, size, mode) {
  const eligible = [];

  for (const word of words) {
    const chars = Array.from(word);

    if (chars.length >= 2 && chars.length <= size) {
      eligible.push({ word, chars });
    }
  }

  const alphabetMap = new Map();

  for (const { chars } of eligible) {
    for (const ch of chars) {
      if (!alphabetMap.has(ch)) {
        alphabetMap.set(ch, alphabetMap.size);
      }
    }
  }

  const alphabet = [...alphabetMap.keys()];
  const A = Math.max(1, alphabet.length);

  let nodeCount = 1;
  for (const { chars } of eligible) nodeCount += chars.length;

  const child = new Int32Array(nodeCount * A); // 0 = 子なし（根は誰の子にもならない）
  const term = new Int32Array(nodeCount); // wordId + 1、0 = 終端でない
  let nextNode = 1;

  eligible.forEach(({ chars }, wordId) => {
    let node = 0;

    for (const ch of chars) {
      const letter = alphabetMap.get(ch);
      let nxt = child[node * A + letter];

      if (nxt === 0) {
        nxt = nextNode++;
        child[node * A + letter] = nxt;
      }

      node = nxt;
    }

    term[node] = wordId + 1;
  });

  // 重み：語数重視は「1語 = 1000点 + 文字数（同点時のタイブレーク）」、
  //       重複重視は「文字数」（= 使用数の合計）
  const weight = new Int32Array(eligible.length);
  let weightSum = 0;

  eligible.forEach(({ chars }, i) => {
    weight[i] = mode === "overlap" ? chars.length : 1000 + chars.length;
    weightSum += weight[i];
  });

  const meanWeight = eligible.length > 0 ? weightSum / eligible.length : 1;

  // 文字の出現頻度に比例して選ぶためのプール
  const poolArr = [];
  for (const { chars } of eligible) {
    for (const ch of chars) poolArr.push(alphabetMap.get(ch));
  }

  const maxLen = eligible.reduce((m, e) => Math.max(m, e.chars.length), 0);

  return {
    size,
    eligible,
    alphabet,
    A,
    child,
    term,
    weight,
    meanWeight,
    pool: Uint16Array.from(poolArr),
    maxLen,
    wordLetters: eligible.map(e => Int16Array.from(e.chars.map(ch => alphabetMap.get(ch))))
  };
}

// ------------------------------------------------------------
// 探索エンジン
// ------------------------------------------------------------
function createEngine(model, rng) {
  const { size, A, child, term, weight, pool, maxLen, wordLetters, eligible } = model;
  const cellCount = size * size;
  const nWords = eligible.length;

  const cells = new Int16Array(cellCount);
  const occ = new Int32Array(nWords);

  // 複数マスを同時に変える手で、同じ出現を二重に数えないための印
  const seen = new Int32Array(cellCount * 8 * (maxLen + 1));
  let stamp = 0;
  let dedupe = false;

  let score = 0;

  const rand01 = () => rng() / 4294967296;
  const randInt = n => rng() % n;

  function applyWord(w, sign) {
    if (sign < 0) {
      if (--occ[w] === 0) score -= weight[w];
    } else if (occ[w]++ === 0) {
      score += weight[w];
    }
  }

  // マス c を通る全出現（8方向）について、occ とスコアを sign(+1/-1)で更新する
  function visitCell(c, sign) {
    const cx = c % size;
    const cy = (c / size) | 0;

    for (let d = 0; d < 8; d++) {
      const dx = DX[d];
      const dy = DY[d];

      for (let i = 0; i < maxLen; i++) {
        const sx = cx - dx * i;
        const sy = cy - dy * i;

        if (sx < 0 || sy < 0 || sx >= size || sy >= size) break;

        let node = 0;
        let x = sx;
        let y = sy;

        for (let k = 0; k < maxLen; k++) {
          if (x < 0 || y < 0 || x >= size || y >= size) break;

          node = child[node * A + cells[y * size + x]];
          if (node === 0) break;

          if (k >= i) {
            const t = term[node];

            if (t !== 0) {
              if (dedupe) {
                const key = ((sy * size + sx) * 8 + d) * (maxLen + 1) + k + 1;

                if (seen[key] === stamp) {
                  x += dx;
                  y += dy;
                  continue;
                }

                seen[key] = stamp;
              }

              applyWord(t - 1, sign);
            }
          }

          x += dx;
          y += dy;
        }
      }
    }
  }

  // 盤面全体を走査して出現を列挙する
  function scanAll(onFound) {
    for (let sy = 0; sy < size; sy++) {
      for (let sx = 0; sx < size; sx++) {
        for (let d = 0; d < 8; d++) {
          const dx = DX[d];
          const dy = DY[d];

          let node = 0;
          let x = sx;
          let y = sy;

          for (let k = 0; k < maxLen; k++) {
            if (x < 0 || y < 0 || x >= size || y >= size) break;

            node = child[node * A + cells[y * size + x]];
            if (node === 0) break;

            if (term[node] !== 0) {
              onFound(term[node] - 1, sx, sy, d, k + 1);
            }

            x += dx;
            y += dy;
          }
        }
      }
    }
  }

  function recompute() {
    occ.fill(0);
    score = 0;

    scanAll(wid => applyWord(wid, 1));
  }

  function randomizeCells() {
    for (let i = 0; i < cellCount; i++) {
      cells[i] = pool[randInt(pool.length)];
    }
  }

  // 複数マスの変更をまとめて評価・適用する。changed は [cell, newLetter, ...]
  const changedCells = [];
  const oldLetters = [];
  const newLetters = [];

  function applyMultiChange(sign) {
    dedupe = true;
    stamp++;

    for (let i = 0; i < changedCells.length; i++) {
      visitCell(changedCells[i], sign);
    }

    dedupe = false;
  }

  function tryPlantMove(T, plantTries) {
    const w = randInt(nWords);
    const letters = wordLetters[w];
    const len = letters.length;

    let bestMatches = -1;
    let bestSx = 0;
    let bestSy = 0;
    let bestD = 0;

    // ランダムな配置を数通り試し、既に文字が一致しているマスが多いものを選ぶ
    for (let t = 0; t < plantTries; t++) {
      const d = randInt(8);
      const dx = DX[d];
      const dy = DY[d];

      const sxMin = dx === 1 ? 0 : dx === -1 ? len - 1 : 0;
      const sxMax = dx === 1 ? size - len : dx === -1 ? size - 1 : size - 1;
      const syMin = dy === 1 ? 0 : dy === -1 ? len - 1 : 0;
      const syMax = dy === 1 ? size - len : dy === -1 ? size - 1 : size - 1;

      if (sxMax < sxMin || syMax < syMin) continue;

      const sx = sxMin + randInt(sxMax - sxMin + 1);
      const sy = syMin + randInt(syMax - syMin + 1);

      let matches = 0;

      for (let i = 0; i < len; i++) {
        if (cells[(sy + dy * i) * size + sx + dx * i] === letters[i]) matches++;
      }

      if (matches > bestMatches) {
        bestMatches = matches;
        bestSx = sx;
        bestSy = sy;
        bestD = d;
      }
    }

    if (bestMatches < 0 || bestMatches === len) return false;

    changedCells.length = 0;
    oldLetters.length = 0;
    newLetters.length = 0;

    for (let i = 0; i < len; i++) {
      const c = (bestSy + DY[bestD] * i) * size + bestSx + DX[bestD] * i;

      if (cells[c] !== letters[i]) {
        changedCells.push(c);
        oldLetters.push(cells[c]);
        newLetters.push(letters[i]);
      }
    }

    const before = score;

    applyMultiChange(-1);
    for (let i = 0; i < changedCells.length; i++) cells[changedCells[i]] = newLetters[i];
    applyMultiChange(1);

    const delta = score - before;

    if (delta >= 0 || rand01() < Math.exp(delta / T)) {
      return true;
    }

    applyMultiChange(-1);
    for (let i = 0; i < changedCells.length; i++) cells[changedCells[i]] = oldLetters[i];
    applyMultiChange(1);

    return false;
  }

  function trySingleMove(T) {
    const c = randInt(cellCount);
    const oldLetter = cells[c];
    const newLetter = pool[randInt(pool.length)];

    if (newLetter === oldLetter) return false;

    const before = score;

    visitCell(c, -1);
    cells[c] = newLetter;
    visitCell(c, 1);

    const delta = score - before;

    if (delta >= 0 || rand01() < Math.exp(delta / T)) {
      return true;
    }

    visitCell(c, -1);
    cells[c] = oldLetter;
    visitCell(c, 1);

    return false;
  }

  // 1回の焼きなまし。最良盤面を bestCells に書き込み、そのスコアを返す
  function anneal(durationMs, T0, T1, plantProb, plantTries, bestCells) {
    randomizeCells();
    recompute();

    let bestScore = score;
    bestCells.set(cells);

    const start = Date.now();
    let T = T0;
    let iterations = 0;

    for (;;) {
      if ((iterations & 255) === 0) {
        const elapsed = Date.now() - start;

        if (elapsed >= durationMs) break;

        T = T0 * Math.pow(T1 / T0, elapsed / durationMs);
      }

      iterations++;

      if (rand01() < plantProb) {
        tryPlantMove(T, plantTries);
      } else {
        trySingleMove(T);
      }

      if (score > bestScore) {
        bestScore = score;
        bestCells.set(cells);
      }
    }

    return { bestScore, iterations };
  }

  return {
    cells,
    anneal,
    recompute,
    scanAll,
    getScore: () => score
  };
}

// ------------------------------------------------------------
// 結果の組み立て
// ------------------------------------------------------------
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

      if (count >= 3) highOverlapCellCount++;
      if (count > maxUsage) maxUsage = count;
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

// 盤面に複数回現れる単語は、他の単語と重なる出現を優先して1つだけ選ぶ（表示用）
function buildUsageGrid(model, occurrencesByWord, rng) {
  const { size } = model;

  const usageGrid = Array.from({ length: size }, () => Array(size).fill(0));
  const chosen = new Map();

  const wordIds = [...occurrencesByWord.keys()];

  function cellsOf(occ, len) {
    const result = [];

    for (let i = 0; i < len; i++) {
      result.push((occ.sy + DY[occ.d] * i) * size + occ.sx + DX[occ.d] * i);
    }

    return result;
  }

  function addUsage(cellList, delta) {
    for (const c of cellList) {
      usageGrid[(c / size) | 0][c % size] += delta;
    }
  }

  function pickBest(wid) {
    const len = model.eligible[wid].chars.length;
    const occs = occurrencesByWord.get(wid);

    let bestCells = null;
    let bestValue = -1;

    for (const occ of occs) {
      const cellList = cellsOf(occ, len);
      let value = 0;

      for (const c of cellList) {
        const u = usageGrid[(c / size) | 0][c % size];
        value += u * u + u;
      }

      value += (rng() % 1000) / 1000;

      if (value > bestValue) {
        bestValue = value;
        bestCells = cellList;
      }
    }

    return bestCells;
  }

  for (const wid of wordIds) {
    const picked = pickBest(wid);
    chosen.set(wid, picked);
    addUsage(picked, 1);
  }

  // 他の単語との関係が変わるので、数回見直す
  for (let pass = 0; pass < 3; pass++) {
    for (const wid of wordIds) {
      if (occurrencesByWord.get(wid).length <= 1) continue;

      addUsage(chosen.get(wid), -1);

      const picked = pickBest(wid);
      chosen.set(wid, picked);
      addUsage(picked, 1);
    }
  }

  return usageGrid;
}

// ------------------------------------------------------------
// 公開API
// ------------------------------------------------------------
function solveByAnnealing(words, size, mode = "count", options = {}) {
  const startTime = Date.now();
  const limitMs = options.timeLimitMs || 50_000;
  const rng = makeRng(options.seed);

  const config = getAnnealConfig(size, mode, limitMs);
  const budgetMs = options.budgetMs || config.budgetMs;
  const runs = options.runs || config.runs;
  const plantProb = options.plantProb ?? config.plantProb;
  const plantTries = options.plantTries ?? config.plantTries;
  const t0Ratio = options.t0Ratio ?? config.t0Ratio;
  const t1Ratio = options.t1Ratio ?? config.t1Ratio;

  const model = createModel(words, size, mode);
  const eligibleCount = model.eligible.length;

  const engine = createEngine(model, rng);
  const cellCount = size * size;

  const bestCells = new Int16Array(cellCount);
  const runBest = new Int16Array(cellCount);

  let bestScore = -Infinity;
  let totalIterations = 0;

  if (eligibleCount > 0) {
    const T0 = model.meanWeight * t0Ratio;
    const T1 = model.meanWeight * t1Ratio;
    const perRunMs = Math.max(200, Math.floor(budgetMs / runs));

    for (let r = 0; r < runs; r++) {
      const { bestScore: s, iterations } = engine.anneal(
        perRunMs,
        T0,
        T1,
        plantProb,
        plantTries,
        runBest
      );

      totalIterations += iterations;

      if (s > bestScore) {
        bestScore = s;
        bestCells.set(runBest);
      }
    }

    engine.cells.set(bestCells);
  } else {
    for (let i = 0; i < cellCount; i++) engine.cells[i] = 0;
  }

  // ---- 結果の組み立て ----
  const occurrencesByWord = new Map();

  if (eligibleCount > 0) {
    engine.scanAll((wid, sx, sy, d) => {
      if (!occurrencesByWord.has(wid)) occurrencesByWord.set(wid, []);
      occurrencesByWord.get(wid).push({ sx, sy, d });
    });
  }

  const grid = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) =>
      eligibleCount > 0 ? model.alphabet[engine.cells[y * size + x]] : ""
    )
  );

  const usageGrid = buildUsageGrid(model, occurrencesByWord, rng);

  const placedWords = [...occurrencesByWord.keys()]
    .map(wid => model.eligible[wid].word)
    .sort((a, b) => a.localeCompare(b));

  const placedWordCount = placedWords.length;
  const totalPlacedChars = placedWords.reduce((sum, w) => sum + Array.from(w).length, 0);
  const usageStats = calculateUsageStats(usageGrid);

  return {
    mode,
    engine: "anneal",
    grid,
    usageGrid,
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

    attemptsTried: runs,
    localSearchIterations: totalIterations,
    generationMs: Date.now() - startTime
  };
}

module.exports = { solveByAnnealing, getAnnealConfig };