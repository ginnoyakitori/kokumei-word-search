// =============================
// 国名しりとり検索 Pro - 高速版 server.js
// =============================
const express = require('express');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static('.'));

// ===== ファイル設定 =====
const KOKUMEI_KEY = 'kokumei.txt';
const SHUTOMEI_KEY = 'shutomei.txt';
const KOKUMEI_SHUTOMEI_KEY = 'kokumei_shutomei.txt';
const POKEMON_KEY = 'pokemon.txt';
const COUNTRIES_ONLY_KEY = 'countries-only.txt';
const CAPITALS_ONLY_KEY = 'capitals-only.txt';

// ===== データ格納 =====
const wordLists = {};
const wordMap = {};
const wordsByLength = {};
const wordsByFirstChar = {};
const wordsByFirstCharAndLength = {};
const listIndexes = {};
const firstCharCache = Object.create(null);
const lastCharCache = Object.create(null);
const regexCache = Object.create(null);
const searchResultCache = new Map();
const MAX_SEARCH_CACHE_ENTRIES = 200;

// ===== 起動時しりとり事前生成キャッシュ =====
// key: `${listName}:${wordCount}`
// value: 経路配列 [[word1, word2, ...], ...]
const startupShiritoriPathCache = new Map();

const STARTUP_PRECOMPUTE_WORD_LIMITS = {
  [POKEMON_KEY]: 2,
  [KOKUMEI_SHUTOMEI_KEY]: 3,
  [KOKUMEI_KEY]: 5,
  [SHUTOMEI_KEY]: 5,
  [COUNTRIES_ONLY_KEY]: 5,
  [CAPITALS_ONLY_KEY]: 5
};

function getStartupShiritoriCacheKey(listName, wordCount) {
  return `${listName}:${wordCount}`;
}

function hasStartupPrecomputedShiritori(listName, wordCount) {
  return startupShiritoriPathCache.has(
    getStartupShiritoriCacheKey(listName, wordCount)
  );
}

function getStartupPrecomputedShiritori(listName, wordCount) {
  return startupShiritoriPathCache.get(
    getStartupShiritoriCacheKey(listName, wordCount)
  ) || null;
}

// ===== 文字種 =====
const DAKUTEN_CHARS = new Set('ガギグゲゴザジズゼゾダヂヅデドバビブベボヴがぎぐげござじずぜぞだぢづでどばびぶべぼゔ');
const HANDAKUTEN_CHARS = new Set('パピプペポぱぴぷぺぽ');
const SMALL_KANA_CHARS = new Set('ァィゥェォッャュョヮぁぃぅぇぉっゃゅょゎ');
const collator = new Intl.Collator('ja', { sensitivity: 'base' });

// ===== 基本文字処理 =====
function normalizeWord(word) {
  if (!word) return '';
  return String(word).normalize('NFKC').charAt(0).toUpperCase();
}

function getShiritoriLastChar(word) {
  const normalized = String(word || '').normalize('NFKC');
  if (!normalized) return '';

  let c = normalized.slice(-1);

  if (c === 'ー' && normalized.length > 1) {
    c = normalized.slice(-2, -1);
  }

  if (c === 'ン' || c === 'ん') return 'ン';

  switch (c) {
    case 'ゃ':
    case 'ャ':
      return 'ヤ';
    case 'ゅ':
    case 'ュ':
      return 'ユ';
    case 'ょ':
    case 'ョ':
      return 'ヨ';
    case 'っ':
    case 'ッ':
      return 'ツ';
    case 'ぁ':
    case 'ァ':
      return 'ア';
    case 'ぃ':
    case 'ィ':
      return 'イ';
    case 'ぅ':
    case 'ゥ':
      return 'ウ';
    case 'ぇ':
    case 'ェ':
      return 'エ';
    case 'ぉ':
    case 'ォ':
      return 'オ';
    default:
      return c.toUpperCase();
  }
}

function getFirstChar(word) {
  if (!firstCharCache[word]) {
    firstCharCache[word] = normalizeWord(word);
  }
  return firstCharCache[word];
}

function getLastChar(word) {
  if (!lastCharCache[word]) {
    lastCharCache[word] = getShiritoriLastChar(word);
  }
  return lastCharCache[word];
}

function hasRepeatedChar(word) {
  const seen = new Set();
  for (const c of String(word || '').normalize('NFKC')) {
    if (seen.has(c)) return true;
    seen.add(c);
  }
  return false;
}

// ===== インデックス構築 =====
function buildListIndexes(listName) {
  const words = wordLists[listName] || [];

  const byLength = Object.create(null);
  const byFirstChar = Object.create(null);
  const byFirstCharAndLength = Object.create(null);
  const wordsByLastChar = Object.create(null);
  const normalizedWords = Object.create(null);
  const lastCharsByWord = Object.create(null);
  const wordsWithRepeatedChars = new Set();
  const firstChars = new Set();
  const lastChars = new Set();

  for (const word of words) {
    const first = getFirstChar(word);
    const last = getLastChar(word);
    const len = word.length;

    normalizedWords[word] = first;
    lastCharsByWord[word] = last;
    firstChars.add(first);
    lastChars.add(last);

    if (!byLength[len]) byLength[len] = [];
    byLength[len].push(word);

    if (!byFirstChar[first]) byFirstChar[first] = [];
    byFirstChar[first].push(word);

    if (!byFirstCharAndLength[first]) {
      byFirstCharAndLength[first] = Object.create(null);
    }
    if (!byFirstCharAndLength[first][len]) {
      byFirstCharAndLength[first][len] = [];
    }
    byFirstCharAndLength[first][len].push(word);

    if (!wordsByLastChar[last]) wordsByLastChar[last] = [];
    wordsByLastChar[last].push(word);

    if (hasRepeatedChar(word)) {
      wordsWithRepeatedChars.add(word);
    }
  }

  const noPrecedingWords = new Set(
    words.filter(word => {
      const prev = wordsByLastChar[normalizedWords[word]] || [];
      return !prev.some(prevWord => prevWord !== word);
    })
  );

  const sortedLengths = Object.keys(byLength).map(Number).sort((a, b) => a - b);

  listIndexes[listName] = {
    allWords: words,
    byLength,
    byFirstChar,
    byFirstCharAndLength,
    wordsByLastChar,
    normalizedWords,
    lastCharsByWord,
    wordsWithRepeatedChars,
    noPrecedingWords,
    firstChars: [...firstChars],
    lastChars: [...lastChars],
    sortedLengths,
    minWordLength: sortedLengths[0] || 1,
    maxWordLength: sortedLengths[sortedLengths.length - 1] || 1
  };

  wordsByLength[listName] = byLength;
  wordsByFirstChar[listName] = byFirstChar;
  wordsByFirstCharAndLength[listName] = byFirstCharAndLength;
  wordMap[listName] = byFirstChar;
}

// ===== データロード =====
function loadWordFile(fileName) {
  try {
    return fs.readFileSync(fileName, 'utf8')
      .split('\n')
      .map(w => w.trim())
      .filter(Boolean)
      .sort(collator.compare);
  } catch (e) {
    console.warn(`Warning: Could not load ${fileName}: ${e.message}`);
    return [];
  }
}

function loadWordData() {
  wordLists[KOKUMEI_KEY] = loadWordFile(KOKUMEI_KEY);
  wordLists[SHUTOMEI_KEY] = loadWordFile(SHUTOMEI_KEY);
  wordLists[POKEMON_KEY] = loadWordFile(POKEMON_KEY);
  wordLists[COUNTRIES_ONLY_KEY] = loadWordFile(COUNTRIES_ONLY_KEY);
  wordLists[CAPITALS_ONLY_KEY] = loadWordFile(CAPITALS_ONLY_KEY);

  wordLists[KOKUMEI_SHUTOMEI_KEY] = [
    ...new Set([
      ...(wordLists[KOKUMEI_KEY] || []),
      ...(wordLists[SHUTOMEI_KEY] || [])
    ])
  ].sort(collator.compare);

  for (const listName of Object.keys(wordLists)) {
    buildListIndexes(listName);
  }
}

function getAllWords(listName) {
  return listIndexes[listName]?.allWords || [];
}

// ===== 正規表現 =====

 function patternToRegex(pattern) {
  if (!pattern || !String(pattern).trim()) return null;

  const normalized = String(pattern).normalize('NFKC');

  let regexString = '';

  // 数字ごとに「初回はキャプチャ」「2回目以降は同じ文字への参照」にする
  // 例: ?1?1? => ^.(.).\1.$
  const digitGroupMap = Object.create(null);
  let groupIndex = 1;

  for (const char of normalized) {
    // ? または ？ は「任意の1文字」
    if (char === '?' || char === '？') {
      regexString += '.';
      continue;
    }

    // % または ％ は「0文字以上の任意の文字列」
    if (char === '%' || char === '％') {
      regexString += '.*';
      continue;
    }

    // 0〜9 は「同じ数字なら同じ文字」
    if (/^[0-9]$/.test(char)) {
      if (!digitGroupMap[char]) {
        digitGroupMap[char] = groupIndex;
        regexString += '(.)';
        groupIndex++;
      } else {
        regexString += `\\${digitGroupMap[char]}`;
      }
      continue;
    }

    // 正規表現の特殊文字はエスケープ
    regexString += char.replace(/[.*+^${}()|[\]\\]/g, '\\$&');
  }

  return new RegExp(`^${regexString}$`);
}

function getCachedRegex(pattern) {
  const key = String(pattern || '').normalize('NFKC');
  if (!key.trim()) return null;

  if (!regexCache[key]) {
    regexCache[key] = patternToRegex(key);
  }

  return regexCache[key];
}

function hasMultiWildcard(pattern) {
  return /[%％]/.test(String(pattern || '').normalize('NFKC'));
}

function isDigitPatternChar(char) {
  return /^[0-9]$/.test(String(char || '').normalize('NFKC'));
}

function getWildcardPatternCandidatePool(listName, pattern, allWords) {
  const normalizedPattern = String(pattern || '').normalize('NFKC');

  if (!normalizedPattern.trim()) {
    return allWords;
  }

  // % がある場合は文字数が固定できないため全単語を見る
  if (hasMultiWildcard(normalizedPattern)) {
    return allWords;
  }

  // ? や数字は1文字扱いなので、% がなければ文字数で絞り込める
  return wordsByLength[listName]?.[normalizedPattern.length] || [];
}

/**
 * pattern と word が一致するかを、数字バインドを引き継ぎながら判定する。
 *
 * 例:
 * pattern: ?1?1?
 * word: エリトリア
 * bindings: {}
 * => [{ "1": "リ" }]
 *
 * 複数単語をまたぐ場合:
 * 既に bindings["1"] = "リ" なら、次の単語内の 1 も必ず "リ" になる。
 */
function matchPatternWithGlobalDigitBindings(pattern, word, bindings = {}) {
  const normalizedPattern = String(pattern || '').normalize('NFKC');

  // 空パターンは「任意の単語」として扱う
  if (!normalizedPattern.trim()) {
    return [{ ...bindings }];
  }

  const patternChars = [...normalizedPattern];
  const wordChars = [...String(word || '').normalize('NFKC')];

  const results = [];

  function backtrack(patternIndex, wordIndex, currentBindings) {
    if (patternIndex === patternChars.length) {
      if (wordIndex === wordChars.length) {
        results.push({ ...currentBindings });
      }
      return;
    }

    const token = patternChars[patternIndex];

    // % / ％ は「0文字以上の任意の文字列」
    if (token === '%' || token === '％') {
      for (let nextWordIndex = wordIndex; nextWordIndex <= wordChars.length; nextWordIndex++) {
        backtrack(patternIndex + 1, nextWordIndex, currentBindings);
      }
      return;
    }

    // ここから先は1文字消費が必要
    if (wordIndex >= wordChars.length) {
      return;
    }

    const currentChar = wordChars[wordIndex];

    // ? / ？ は「任意の1文字」
    if (token === '?' || token === '？') {
      backtrack(patternIndex + 1, wordIndex + 1, currentBindings);
      return;
    }

    // 数字は「同じ数字なら同じ文字」
    if (isDigitPatternChar(token)) {
      const digit = token.normalize('NFKC');
      const alreadyBoundChar = currentBindings[digit];

      if (alreadyBoundChar !== undefined) {
        if (alreadyBoundChar === currentChar) {
          backtrack(patternIndex + 1, wordIndex + 1, currentBindings);
        }
      } else {
        const nextBindings = {
          ...currentBindings,
          [digit]: currentChar
        };

        backtrack(patternIndex + 1, wordIndex + 1, nextBindings);
      }

      return;
    }

    // 通常文字は完全一致
    if (token === currentChar) {
      backtrack(patternIndex + 1, wordIndex + 1, currentBindings);
    }
  }

  backtrack(0, 0, { ...bindings });

  return results;
}
// ===== キャッシュ =====
function getSearchCacheKey(name, payload) {
  return `${name}:${JSON.stringify(payload)}`;
}

function getSearchCache(name, payload) {
  return searchResultCache.get(getSearchCacheKey(name, payload));
}

function setSearchCache(name, payload, value) {
  const key = getSearchCacheKey(name, payload);

  if (searchResultCache.has(key)) {
    searchResultCache.delete(key);
  } else if (searchResultCache.size >= MAX_SEARCH_CACHE_ENTRIES) {
    searchResultCache.delete(searchResultCache.keys().next().value);
  }

  searchResultCache.set(key, value);
}

// ===== ページング =====
function normalizePaging(pageValue, perPageValue) {
  return {
    page: Math.max(1, parseInt(pageValue, 10) || 1),
    perPage: Math.min(500, Math.max(1, parseInt(perPageValue, 10) || 100))
  };
}

function paginateSearchResponse(response, paging) {
  if (!response || !Array.isArray(response.results)) {
    return response;
  }

  const totalCount = response.results.length;
  const perPage = paging.perPage;
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const page = Math.min(Math.max(1, paging.page), totalPages);
  const start = (page - 1) * perPage;

  return {
    ...response,
    results: response.results.slice(start, start + perPage),
    page,
    perPage,
    totalCount,
    totalPages
  };
}

function cachedJson(res, name, payload, paging, producer) {
  const cached = getSearchCache(name, payload);
  if (cached) {
    return res.json(paginateSearchResponse(cached, paging));
  }

  const response = producer();
  setSearchCache(name, payload, response);

  return res.json(paginateSearchResponse(response, paging));
}// ===== 条件判定 =====
function checkRequiredChars(path, requiredChars, requiredCharMode = 'atLeast') {
  if (!requiredChars || requiredChars.length === 0) return true;

  const text = path.join('');
  const counts = Object.create(null);

  for (const c of requiredChars.filter(Boolean)) {
    counts[c] = (counts[c] || 0) + 1;
  }

  for (const c of Object.keys(counts)) {
    let actual = 0;
    let pos = -1;

    while ((pos = text.indexOf(c, pos + 1)) !== -1) {
      actual++;
    }

    if (requiredCharMode === 'exactly') {
      if (actual !== counts[c]) return false;
    } else {
      if (actual < counts[c]) return false;
    }
  }

  return true;
}

function checkExcludeChars(path, excludeChars) {
  if (!excludeChars || excludeChars.length === 0) return true;

  const text = path.join('');
  return excludeChars.every(c => !text.includes(c));
}

function containsAnyExcludedChar(word, excludeChars) {
  return Boolean(
    excludeChars &&
    excludeChars.length &&
    excludeChars.some(c => word.includes(c))
  );
}

function filterUniqueWordLengths(results) {
  return results.filter(path => {
    const lengths = path.map(w => w.length);
    return new Set(lengths).size === lengths.length;
  });
}

function filterUniquePairOnly(results) {
  const counts = Object.create(null);

  for (const path of results) {
    const key = `${getFirstChar(path[0])}→${getLastChar(path[path.length - 1])}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  return results.filter(path => {
    const key = `${getFirstChar(path[0])}→${getLastChar(path[path.length - 1])}`;
    return counts[key] === 1;
  });
}

function filterByTotalLength(results, totalLength) {
  if (!totalLength) return results;

  return results.filter(path => {
    const sum = path.reduce((total, word) => total + word.length, 0);
    return sum === Number(totalLength);
  });
}

function matchesNumberRule(actual, rule) {
  if (rule === undefined || rule === null || rule === '') return true;
  if (typeof rule === 'number') return actual === rule;
  if (typeof rule !== 'object') return true;

  const value = Number(rule.value);
  if (Number.isNaN(value)) return true;

  if (rule.mode === 'min') return actual >= value;
  if (rule.mode === 'max') return actual <= value;

  return actual === value;
}

function matchesLengthPattern(path, pattern) {
  if (!pattern) return true;

  const lengths = path.map(w => w.length);
  if (lengths.length <= 1) return true;

  if (pattern === 'increasing') {
    return lengths.every((v, i) => i === 0 || v > lengths[i - 1]);
  }

  if (pattern === 'nondecreasing') {
    return lengths.every((v, i) => i === 0 || v >= lengths[i - 1]);
  }

  if (pattern === 'decreasing') {
    return lengths.every((v, i) => i === 0 || v < lengths[i - 1]);
  }

  if (pattern === 'nonincreasing') {
    return lengths.every((v, i) => i === 0 || v <= lengths[i - 1]);
  }

  if (pattern === 'arithmetic') {
    if (lengths.length <= 2) return true;
    const diff = lengths[1] - lengths[0];
    return lengths.every((v, i) => i < 2 || v - lengths[i - 1] === diff);
  }

  if (pattern === 'geometric') {
    if (lengths.length <= 2) return true;
    if (lengths[0] === 0) return false;

    const ratio = lengths[1] / lengths[0];
    return lengths.every((v, i) => {
      if (i < 2) return true;
      return Math.abs(lengths[i - 1] * ratio - v) < 1e-9;
    });
  }

  return true;
}

function hasPrecedingWord(path, listName) {
  if (!path.length) return false;

  const first = getFirstChar(path[0]);
  return (listIndexes[listName]?.wordsByLastChar?.[first] || [])
    .some(w => w !== path[0]);
}

function hasSucceedingWord(path, listName) {
  if (!path.length) return false;

  const last = path[path.length - 1];
  const lastChar = getLastChar(last);
  const used = new Set(path);

  return (wordsByFirstChar[listName]?.[lastChar] || [])
    .some(w => w !== last && !used.has(w));
}

function filterByAdvancedConditions(results, advanced, listName) {
  if (!advanced || Object.keys(advanced).length === 0) {
    return results;
  }

  const repeatedWords = listIndexes[listName]?.wordsWithRepeatedChars;

  return results.filter(path => {
    const text = path.join('');

    if (
      advanced.dakutenCount !== undefined &&
      !matchesNumberRule(
        [...text].filter(c => DAKUTEN_CHARS.has(c)).length,
        advanced.dakutenCount
      )
    ) {
      return false;
    }

    if (
      advanced.handakutenCount !== undefined &&
      !matchesNumberRule(
        [...text].filter(c => HANDAKUTEN_CHARS.has(c)).length,
        advanced.handakutenCount
      )
    ) {
      return false;
    }

    if (
      advanced.smallKanaCount !== undefined &&
      !matchesNumberRule(
        [...text].filter(c => SMALL_KANA_CHARS.has(c)).length,
        advanced.smallKanaCount
      )
    ) {
      return false;
    }

    if (advanced.repeatedCharWordCount !== undefined) {
      const count = path.reduce((total, word) => {
        if (repeatedWords) {
          return total + (repeatedWords.has(word) ? 1 : 0);
        }
        return total + (hasRepeatedChar(word) ? 1 : 0);
      }, 0);

      if (!matchesNumberRule(count, advanced.repeatedCharWordCount)) {
        return false;
      }
    }

    if (
      advanced.hasPrecedingWord !== undefined &&
      hasPrecedingWord(path, listName) !== advanced.hasPrecedingWord
    ) {
      return false;
    }

    if (
      advanced.hasSucceedingWord !== undefined &&
      hasSucceedingWord(path, listName) !== advanced.hasSucceedingWord
    ) {
      return false;
    }

    if (!matchesLengthPattern(path, advanced.lengthPattern)) {
      return false;
    }

    return true;
  });
}

function finishResults(results, {
  uniqueWordLengths,
  uniquePairOnly,
  totalLength,
  advancedConditions,
  listName
} = {}) {
  let out = results;

  // 1. まず「単語の文字数がすべて異なる経路のみ表示」
  if (uniqueWordLengths) {
    out = filterUniqueWordLengths(out);
  }

  // 2. 次に合計文字数フィルター
  if (totalLength) {
    out = filterByTotalLength(out, Number(totalLength));
  }

  // 3. 次に高度条件フィルター
  out = filterByAdvancedConditions(out, advancedConditions, listName);

  // 4. 最後に、残った経路だけを対象に
  //    「最初と最後の文字の組み合わせが唯一の経路のみ表示」
  if (uniquePairOnly) {
    out = filterUniquePairOnly(out);
  }

  return out;
}

// ===== 優先度付きキュー =====
class PriorityQueue {
  constructor(compare = (a, b) => a[0] < b[0]) {
    this.heap = [];
    this.compare = compare;
  }

  size() {
    return this.heap.length;
  }

  push(value) {
    this.heap.push(value);
    this.up(this.heap.length - 1);
  }

  pop() {
    if (!this.heap.length) return undefined;

    const top = this.heap[0];
    const last = this.heap.pop();

    if (this.heap.length) {
      this.heap[0] = last;
      this.down(0);
    }

    return top;
  }

  up(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);

      if (!this.compare(this.heap[index], this.heap[parent])) {
        break;
      }

      [this.heap[index], this.heap[parent]] =
        [this.heap[parent], this.heap[index]];

      index = parent;
    }
  }

  down(index) {
    while (true) {
      let smallest = index;
      const left = index * 2 + 1;
      const right = left + 1;

      if (
        left < this.heap.length &&
        this.compare(this.heap[left], this.heap[smallest])
      ) {
        smallest = left;
      }

      if (
        right < this.heap.length &&
        this.compare(this.heap[right], this.heap[smallest])
      ) {
        smallest = right;
      }

      if (smallest === index) break;

      [this.heap[index], this.heap[smallest]] =
        [this.heap[smallest], this.heap[index]];

      index = smallest;
    }
  }
}

// ===== 最短しりとり =====
function findShiritoriShortestPath(
  map,
  firstChar,
  lastChar,
  requiredChars,
  excludeChars,
  noPrecedingWord,
  noSucceedingWord,
  requiredCharMode,
  listName,
  advancedConditions
) {
  const allWords = getAllWords(listName);

  // 開始文字が未指定なら全単語から開始する
  let starts = firstChar ? (map[firstChar] || []) : allWords;

  // 「前に続けられる単語なし」条件
  if (noPrecedingWord) {
    starts = starts.filter(word =>
      listIndexes[listName]?.noPrecedingWords?.has(word)
    );
  }

  // 除外文字を含む開始単語は最初から除外
  starts = starts.filter(word => !containsAnyExcludedChar(word, excludeChars));

  const pq = new PriorityQueue();
  const results = [];
  const seenStates = new Set();

  let shortestLength = Infinity;

  // 初期状態を投入
  for (const word of starts) {
    pq.push([
      word.length,
      word,
      [word]
    ]);
  }

  while (pq.size()) {
    const [currentLength, currentWord, path] = pq.pop();

    // すでに高度条件まで満たした最短経路より長いものは不要
    if (currentLength > shortestLength) {
      continue;
    }

    const pathKey = path.join(',');

    if (seenStates.has(pathKey)) {
      continue;
    }

    seenStates.add(pathKey);

    const used = new Set(path);
    const endChar = getLastChar(currentWord);

    // 終了文字が未指定なら、どの文字で終わっても候補になる
    const matchesLastChar =
      lastChar == null ||
      lastChar === '' ||
      endChar === lastChar;

    if (matchesLastChar) {
      let okNoSucceeding = true;

      if (noSucceedingWord) {
        const nextWords = wordsByFirstChar[listName]?.[endChar] || [];

        okNoSucceeding = !nextWords.some(word =>
          word !== currentWord && !used.has(word)
        );
      }

      const okBasicConditions =
        okNoSucceeding &&
        checkRequiredChars(path, requiredChars, requiredCharMode) &&
        checkExcludeChars(path, excludeChars);

      // ここで高度条件も判定する
      const okAdvancedConditions =
        !advancedConditions ||
        Object.keys(advancedConditions).length === 0 ||
        filterByAdvancedConditions([path], advancedConditions, listName).length === 1;

      if (okBasicConditions && okAdvancedConditions) {
        if (currentLength < shortestLength) {
          shortestLength = currentLength;
          results.length = 0;
          results.push([...path]);
        } else if (currentLength === shortestLength) {
          results.push([...path]);
        }

        // この経路からさらに伸ばすと必ず長くなるので不要
        continue;
      }
    }

    const nextWords = wordsByFirstChar[listName]?.[endChar] || [];

    for (const nextWord of nextWords) {
      if (used.has(nextWord)) {
        continue;
      }

      if (containsAnyExcludedChar(nextWord, excludeChars)) {
        continue;
      }

      const nextLength = currentLength + nextWord.length;

      if (nextLength > shortestLength) {
        continue;
      }

      pq.push([
        nextLength,
        nextWord,
        [...path, nextWord]
      ]);
    }
  }

  return results.sort((a, b) => collator.compare(a.join(''), b.join('')));
}
// ===== 固定単語数しりとり =====
function findShiritoriCombinations(
  map,
  firstChar,
  lastChar,
  wordCount,
  requiredChars,
  excludeChars,
  noPrecedingWord,
  noSucceedingWord,
  requiredCharMode,
  listName,
  options = {}
) {
  const allWords = getAllWords(listName);
  const index = listIndexes[listName];

  const targetTotalLength = options.totalLength
    ? Number(options.totalLength)
    : null;

  const uniqueLen = Boolean(options.uniqueWordLengths);
  const results = [];

  if (wordCount == null || wordCount === '') {
    if (!targetTotalLength) return [];

    const maxCount = Math.floor(targetTotalLength / index.minWordLength);
    const merged = [];

    for (let n = 1; n <= maxCount; n++) {
      merged.push(
        ...findShiritoriCombinations(
          map,
          firstChar,
          lastChar,
          n,
          requiredChars,
          excludeChars,
          noPrecedingWord,
          noSucceedingWord,
          requiredCharMode,
          listName,
          options
        )
      );
    }

    const seen = new Set();

    return merged.filter(path => {
      const key = path.join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  wordCount = parseInt(wordCount, 10);

  if (!Number.isFinite(wordCount) || wordCount < 1) {
    return [];
  }

  const canReachLength = (sum, depth) => {
    if (!targetTotalLength) return true;

    const rest = wordCount - depth;

    return (
      sum + rest * index.minWordLength <= targetTotalLength &&
      sum + rest * index.maxWordLength >= targetTotalLength
    );
  };

  function backtrack(path, used, sum, usedLengths) {
    if (!canReachLength(sum, path.length)) {
      return;
    }

    if (path.length === wordCount) {
      if (targetTotalLength && sum !== targetTotalLength) {
        return;
      }

      const endChar = getLastChar(path[path.length - 1]);

      if (lastChar != null && endChar !== lastChar) {
        return;
      }

      if (
        noSucceedingWord &&
        (wordsByFirstChar[listName]?.[endChar] || []).some(w => !used.has(w))
      ) {
        return;
      }

      if (
        checkRequiredChars(path, requiredChars, requiredCharMode) &&
        checkExcludeChars(path, excludeChars)
      ) {
        results.push([...path]);
      }

      return;
    }

    const nextKey = getLastChar(path[path.length - 1]);
    const nextWords = wordsByFirstChar[listName]?.[nextKey] || [];

    for (const next of nextWords) {
      if (used.has(next)) continue;
      if (containsAnyExcludedChar(next, excludeChars)) continue;

      const len = next.length;

      if (uniqueLen && usedLengths.has(len)) continue;
      if (targetTotalLength && sum + len > targetTotalLength) continue;

      used.add(next);
      path.push(next);

      if (uniqueLen) {
        usedLengths.add(len);
      }

      backtrack(path, used, sum + len, usedLengths);

      if (uniqueLen) {
        usedLengths.delete(len);
      }

      path.pop();
      used.delete(next);
    }
  }

  let starts = firstChar ? (map[firstChar] || []) : allWords;

  if (noPrecedingWord) {
    starts = starts.filter(w => index.noPrecedingWords.has(w));
  }

  for (const word of starts) {
    if (containsAnyExcludedChar(word, excludeChars)) continue;

    const len = word.length;

    if (targetTotalLength && len > targetTotalLength) continue;

    backtrack(
      [word],
      new Set([word]),
      len,
      uniqueLen ? new Set([len]) : new Set()
    );
  }

  return results.sort((a, b) => collator.compare(a.join(''), b.join('')));
}

// ===== 単語数パターン検索 =====
function getPermutations(arr) {
  if (arr.length === 0) return [[]];

  const out = [];

  for (let i = 0; i < arr.length; i++) {
    const current = arr[i];
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));

    for (const restPerm of getPermutations(rest)) {
      for (const n of current) {
        out.push([n, ...restPerm]);
      }
    }
  }

  const seen = new Set();

  return out.filter(item => {
    const key = item.join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function generateCartesianProduct(arr) {
  return arr
    .reduce(
      (a, b) => a.flatMap(x => b.map(y => x.concat(y))),
      [[]]
    )
    .filter(a => a.length);
}

function findShiritoriByWordCountPatterns(
  map,
  wordCountPatterns,
  requiredChars,
  allowPermutation,
  requiredCharMode,
  listName
) {
  const sequences = allowPermutation
    ? getPermutations(wordCountPatterns)
    : generateCartesianProduct(wordCountPatterns);

  const results = [];

  for (const sequence of sequences) {
    function backtrack(path, used, index) {
      if (index === sequence.length) {
        if (checkRequiredChars(path, requiredChars, requiredCharMode)) {
          results.push([...path]);
        }
        return;
      }

      const length = sequence[index];

      const pool =
        path.length === 0
          ? (wordsByLength[listName]?.[length] || [])
          : (
              wordsByFirstCharAndLength[listName]
                ?.[getLastChar(path[path.length - 1])]
                ?.[length] || []
            );

      for (const word of pool) {
        if (used.has(word)) continue;

        used.add(word);
        path.push(word);

        backtrack(path, used, index + 1);

        path.pop();
        used.delete(word);
      }
    }

    backtrack([], new Set(), 0);
  }

  const seen = new Set();

  return results
    .filter(path => {
      const key = path.join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => collator.compare(a.join(''), b.join('')));
}

// ===== ワイルドカードしりとり =====
function findWildcardShiritoriCombinations(
  map,
  wordPatterns,
  requiredChars,
  requiredCharMode,
  listName
) {
  const allWords = getAllWords(listName);

  const candidates = wordPatterns.map(pattern => {
    const pool = getWildcardPatternCandidatePool(listName, pattern, allWords);

    // 事前に「単語単体として絶対に一致しないもの」は除外する。
    // ただし数字の最終的な対応文字は経路全体で決まるので、
    // 探索中にも再チェックする。
    return pool.filter(word => {
      return matchPatternWithGlobalDigitBindings(pattern, word, {}).length > 0;
    });
  });

  const results = [];

  function backtrack(index, path, used, bindings) {
    if (index === candidates.length) {
      if (checkRequiredChars(path, requiredChars, requiredCharMode)) {
        results.push([...path]);
      }
      return;
    }

    const pattern = wordPatterns[index];
    const words = candidates[index];

    for (const word of words) {
      if (used.has(word)) {
        continue;
      }

      // しりとり接続チェック
      if (
        index > 0 &&
        getLastChar(path[path.length - 1]) !== getFirstChar(word)
      ) {
        continue;
      }

      // ここで、複数単語をまたいだ数字バインドをチェックする
      const nextBindingCandidates = matchPatternWithGlobalDigitBindings(
        pattern,
        word,
        bindings
      );

      if (nextBindingCandidates.length === 0) {
        continue;
      }

      used.add(word);
      path.push(word);

      for (const nextBindings of nextBindingCandidates) {
        backtrack(index + 1, path, used, nextBindings);
      }

      path.pop();
      used.delete(word);
    }
  }

  backtrack(0, [], new Set(), {});

  const seen = new Set();

  return results
    .filter(path => {
      const key = path.join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => collator.compare(a.join(''), b.join('')));
}

// ===== ループ検索 =====
function findLoopShiritori(map, pattern, listName) {
  const p = String(pattern || '').normalize('NFKC');
  const L = p.length;
  const regex = getCachedRegex(p);
  const results = [];
  const candidates = getAllWords(listName).filter(word => word.length < L);

  function backtrack(path, used, currentText) {
    if (currentText.length === L) {
      if (getLastChar(path[path.length - 1]) !== getFirstChar(path[0])) {
        return;
      }

      for (let i = 0; i < L; i++) {
        const rotated = currentText.slice(i) + currentText.slice(0, i);

        if (regex.test(rotated)) {
          results.push([...path]);
          break;
        }
      }

      return;
    }

    if (currentText.length > L) return;

    const last = getLastChar(path[path.length - 1]);
    const nextWords = wordsByFirstChar[listName]?.[last] || [];

    for (const next of nextWords) {
      if (used.has(next)) continue;
      if (currentText.length + next.length > L) continue;

      used.add(next);
      path.push(next);

      backtrack(path, used, currentText + next);

      path.pop();
      used.delete(next);
    }
  }

  for (const start of candidates) {
    backtrack([start], new Set([start]), start);
  }

  const seen = new Set();

  return results
    .filter(path => {
      const key = [...path].sort().join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => collator.compare(a.join(''), b.join('')));
}

function isDigitPatternChar(char) {
  return /^[0-9]$/.test(String(char || '').normalize('NFKC'));
}

function patternHasMultiWildcard(pattern) {
  return /[%％]/.test(String(pattern || '').normalize('NFKC'));
}

/**
 * チェーン検索用:
 * pattern に対して text が「途中まで一致しているか」を判定する。
 *
 * 数字はチェーン全体で共有される。
 * 例:
 * pattern: ?1?1?
 * text: エリト
 * bindings: {}
 * => 1 = リ として prefix OK
 */
function matchChainPatternPrefixWithBindings(pattern, text, bindings = {}) {
  const patternChars = [...String(pattern || '').normalize('NFKC')];
  const textChars = [...String(text || '').normalize('NFKC')];

  const results = [];

  function backtrack(patternIndex, textIndex, currentBindings) {
    // text を全部読めたら「ここまでは一致」とみなす
    if (textIndex === textChars.length) {
      results.push({ ...currentBindings });
      return;
    }

    // pattern が先に尽きたら不一致
    if (patternIndex === patternChars.length) {
      return;
    }

    const token = patternChars[patternIndex];
    const currentChar = textChars[textIndex];

    // % / ％ は 0文字以上の任意文字列
    if (token === '%' || token === '％') {
      // 0文字消費
      backtrack(patternIndex + 1, textIndex, currentBindings);

      // 1文字以上消費
      for (let nextTextIndex = textIndex + 1; nextTextIndex <= textChars.length; nextTextIndex++) {
        backtrack(patternIndex + 1, nextTextIndex, currentBindings);
      }

      return;
    }

    // ? / ？ は任意の1文字
    if (token === '?' || token === '？') {
      backtrack(patternIndex + 1, textIndex + 1, currentBindings);
      return;
    }

    // 数字は、同じ数字なら同じ文字
    if (isDigitPatternChar(token)) {
      const digit = token.normalize('NFKC');
      const boundChar = currentBindings[digit];

      if (boundChar !== undefined) {
        if (boundChar === currentChar) {
          backtrack(patternIndex + 1, textIndex + 1, currentBindings);
        }
      } else {
        backtrack(
          patternIndex + 1,
          textIndex + 1,
          {
            ...currentBindings,
            [digit]: currentChar
          }
        );
      }

      return;
    }

    // 通常文字は完全一致
    if (token === currentChar) {
      backtrack(patternIndex + 1, textIndex + 1, currentBindings);
    }
  }

  backtrack(0, 0, { ...bindings });

  return results;
}

/**
 * チェーン検索用:
 * pattern と text が最後まで完全一致するかを判定する。
 *
 * 数字はチェーン全体で共有される。
 */
function matchChainPatternFullWithBindings(pattern, text, bindings = {}) {
  const patternChars = [...String(pattern || '').normalize('NFKC')];
  const textChars = [...String(text || '').normalize('NFKC')];

  const results = [];

  function backtrack(patternIndex, textIndex, currentBindings) {
    if (patternIndex === patternChars.length) {
      if (textIndex === textChars.length) {
        results.push({ ...currentBindings });
      }
      return;
    }

    const token = patternChars[patternIndex];

    // % / ％ は 0文字以上の任意文字列
    if (token === '%' || token === '％') {
      for (let nextTextIndex = textIndex; nextTextIndex <= textChars.length; nextTextIndex++) {
        backtrack(patternIndex + 1, nextTextIndex, currentBindings);
      }
      return;
    }

    if (textIndex >= textChars.length) {
      return;
    }

    const currentChar = textChars[textIndex];

    // ? / ？ は任意の1文字
    if (token === '?' || token === '？') {
      backtrack(patternIndex + 1, textIndex + 1, currentBindings);
      return;
    }

    // 数字は、同じ数字なら同じ文字
    if (isDigitPatternChar(token)) {
      const digit = token.normalize('NFKC');
      const boundChar = currentBindings[digit];

      if (boundChar !== undefined) {
        if (boundChar === currentChar) {
          backtrack(patternIndex + 1, textIndex + 1, currentBindings);
        }
      } else {
        backtrack(
          patternIndex + 1,
          textIndex + 1,
          {
            ...currentBindings,
            [digit]: currentChar
          }
        );
      }

      return;
    }

    // 通常文字は完全一致
    if (token === currentChar) {
      backtrack(patternIndex + 1, textIndex + 1, currentBindings);
    }
  }

  backtrack(0, 0, { ...bindings });

  return results;
}

// ===== チェーン検索 =====
function findChainShiritori(
  map,
  pattern,
  requiredChars,
  excludeChars,
  requiredCharMode,
  listName
) {
  const p = String(pattern || '').normalize('NFKC');

  // % が含まれていない場合は、パターン全体の文字数が固定される
  const fixedLengthMode = !patternHasMultiWildcard(p);
  const fixedLength = p.length;

  const results = [];

  function backtrack(path, used, currentText, bindings) {
    // 現在の文字列が、パターンの途中まで一致しているか確認
    // 数字の対応文字も bindings として引き継ぐ
    const prefixBindingCandidates = matchChainPatternPrefixWithBindings(
      p,
      currentText,
      bindings
    );

    if (prefixBindingCandidates.length === 0) {
      return;
    }

    // 現在の文字列がパターンに完全一致しているか確認
    for (const prefixBindings of prefixBindingCandidates) {
      const fullBindingCandidates = matchChainPatternFullWithBindings(
        p,
        currentText,
        prefixBindings
      );

      if (fullBindingCandidates.length > 0) {
        if (
          checkRequiredChars(path, requiredChars, requiredCharMode) &&
          checkExcludeChars(path, excludeChars)
        ) {
          results.push([...path]);
        }

        // % がない固定長パターンなら、完全一致後に伸ばす必要はない
        if (fixedLengthMode) {
          return;
        }
      }
    }

    // % がない場合、パターン長以上ならこれ以上伸ばさない
    if (fixedLengthMode && currentText.length >= fixedLength) {
      return;
    }

    const last = getLastChar(path[path.length - 1]);
    const nextWords = wordsByFirstChar[listName]?.[last] || [];

    for (const next of nextWords) {
      if (used.has(next)) {
        continue;
      }

      if (containsAnyExcludedChar(next, excludeChars)) {
        continue;
      }

      const nextText = currentText + next;

      // % がない場合は固定長を超えたら不可
      if (fixedLengthMode && nextText.length > fixedLength) {
        continue;
      }

      const nextBindingCandidates = matchChainPatternPrefixWithBindings(
        p,
        nextText,
        bindings
      );

      if (nextBindingCandidates.length === 0) {
        continue;
      }

      used.add(next);
      path.push(next);

      for (const nextBindings of nextBindingCandidates) {
        backtrack(path, used, nextText, nextBindings);
      }

      path.pop();
      used.delete(next);
    }
  }

  for (const start of getAllWords(listName)) {
    if (containsAnyExcludedChar(start, excludeChars)) {
      continue;
    }

    if (fixedLengthMode && start.length > fixedLength) {
      continue;
    }

    const bindingCandidates = matchChainPatternPrefixWithBindings(
      p,
      start,
      {}
    );

    if (bindingCandidates.length === 0) {
      continue;
    }

    for (const bindings of bindingCandidates) {
      backtrack(
        [start],
        new Set([start]),
        start,
        bindings
      );
    }
  }

  const seen = new Set();

  return results
    .filter(path => {
      const key = path.join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => collator.compare(a.join(''), b.join('')));
}

// ===== 入力正規化 =====
function normalizeExcludeChars(value) {
  if (!value) return null;

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  const str = String(value).trim();
  return str ? str.split('') : null;
}

function normalizeRequiredChars(value) {
  if (!Array.isArray(value)) return null;
  return value.length ? value.filter(Boolean) : null;
}
``// ===== 起動前ロード =====
console.log('Loading word data...');
loadWordData();
console.log('Word data loaded successfully!');

// ===== 起動時しりとり事前生成 =====
function generateAllShiritoriPathsByCount(listName, wordCount) {
  const allWords = getAllWords(listName);
  const results = [];

  if (!wordCount || wordCount < 1) {
    return results;
  }

  function backtrack(path, used) {
    if (path.length === wordCount) {
      results.push([...path]);
      return;
    }

    const lastChar = getLastChar(path[path.length - 1]);
    const nextWords = wordsByFirstChar[listName]?.[lastChar] || [];

    for (const nextWord of nextWords) {
      if (used.has(nextWord)) {
        continue;
      }

      used.add(nextWord);
      path.push(nextWord);

      backtrack(path, used);

      path.pop();
      used.delete(nextWord);
    }
  }

  for (const startWord of allWords) {
    backtrack([startWord], new Set([startWord]));
  }

  return results.sort((a, b) => collator.compare(a.join(''), b.join('')));
}

function precomputeStartupShiritoriCache() {
  console.log('Precomputing startup shiritori cache...');

  const totalStarted = Date.now();

  for (const [listName, maxWordCount] of Object.entries(STARTUP_PRECOMPUTE_WORD_LIMITS)) {
    if (!wordLists[listName]) {
      continue;
    }

    for (let wordCount = 1; wordCount <= maxWordCount; wordCount++) {
      const started = Date.now();
      const key = getStartupShiritoriCacheKey(listName, wordCount);

      const results = generateAllShiritoriPathsByCount(listName, wordCount);
      startupShiritoriPathCache.set(key, results);

      console.log(
        `Precomputed ${listName} / ${wordCount} words: ${results.length} paths in ${Date.now() - started}ms`
      );
    }
  }

  console.log(
    `Startup shiritori cache ready in ${Date.now() - totalStarted}ms`
  );
}

function filterStartupPrecomputedShiritoriPaths(
  paths,
  {
    listName,
    firstChar,
    lastChar,
    requiredChars,
    excludeChars,
    noPrecedingWord,
    noSucceedingWord,
    requiredCharMode
  }
) {
  if (!paths || paths.length === 0) {
    return [];
  }

  return paths.filter(path => {
    if (firstChar && getFirstChar(path[0]) !== firstChar) {
      return false;
    }

    if (lastChar && getLastChar(path[path.length - 1]) !== lastChar) {
      return false;
    }

    if (
      noPrecedingWord &&
      !listIndexes[listName]?.noPrecedingWords?.has(path[0])
    ) {
      return false;
    }

    if (
      noSucceedingWord &&
      hasSucceedingWord(path, listName)
    ) {
      return false;
    }

    if (!checkRequiredChars(path, requiredChars, requiredCharMode)) {
      return false;
    }

    if (!checkExcludeChars(path, excludeChars)) {
      return false;
    }

    return true;
  });
}

// ===== API: 文字指定しりとり =====
app.post('/api/shiritori', (req, res) => {
  const paging = normalizePaging(req.body.page, req.body.perPage);

  let {
    listName,
    firstChar,
    lastChar,
    wordCount,
    requiredChars,
    excludeChars,
    noPrecedingWord,
    noSucceedingWord,
    outputType,
    requiredCharMode,
    uniqueWordLengths,
    uniquePairOnly,
    totalLength,
    advancedConditions
  } = req.body;

  const words = wordLists[listName];
  const map = wordMap[listName];

  if (!map || !words) {
    return res.status(400).json({ error: '無効な単語リストです。' });
  }

  firstChar = firstChar || null;
  lastChar = lastChar || null;
  requiredChars = normalizeRequiredChars(requiredChars);
  excludeChars = normalizeExcludeChars(excludeChars);

  const mode = requiredCharMode === 'exactly' ? 'exactly' : 'atLeast';

  if (typeof wordCount === 'string' && wordCount !== 'shortest') {
    wordCount = parseInt(wordCount, 10);
  }

  if (
    typeof wordCount === 'number' &&
    (Number.isNaN(wordCount) || wordCount < 1)
  ) {
    return res.status(400).json({
      error: '単語数は1以上の数字である必要があります。'
    });
  }

  const cachePayload = {
    listName,
    firstChar,
    lastChar,
    wordCount,
    requiredChars,
    excludeChars,
    noPrecedingWord,
    noSucceedingWord,
    outputType,
    mode,
    uniqueWordLengths,
    uniquePairOnly,
    totalLength,
    advancedConditions
  };

  return cachedJson(res, 'shiritori', cachePayload, paging, () => {
    const started = Date.now();
    let results;

    if (wordCount === 'shortest') {
      if (outputType !== 'path') {
        return {
          error: '件数カウントは最短モードでは現在サポートされていません。'
        };
      }

      // 最短検索では、必須文字・除外文字・高度条件を
      // 探索中に満たす経路だけを最短候補にする
      results = findShiritoriShortestPath(
        map,
        firstChar,
        lastChar,
        requiredChars,
        excludeChars,
        noPrecedingWord,
        noSucceedingWord,
        mode,
        listName,
        advancedConditions
      );

      // 高度条件は findShiritoriShortestPath() の中で判定済み。
      // ここでは、残った最短経路に対して
      // 文字数一意・合計文字数・唯一ペアなどを後処理する。
      //
      // ※ uniquePairOnly は finishResults() の中で
      //   最後に実行されるようにしておく。
      results = finishResults(results, {
        uniqueWordLengths,
        uniquePairOnly,
        totalLength,
        advancedConditions: null,
        listName
      });
    } else {
      // 通常の固定単語数検索
      // 起動時に事前生成済みの単語数なら、DFSせずキャッシュから絞り込む
      if (
        Number.isInteger(wordCount) &&
        hasStartupPrecomputedShiritori(listName, wordCount)
      ) {
        const precomputedPaths = getStartupPrecomputedShiritori(
          listName,
          wordCount
        );

        results = filterStartupPrecomputedShiritoriPaths(
          precomputedPaths,
          {
            listName,
            firstChar,
            lastChar,
            requiredChars,
            excludeChars,
            noPrecedingWord,
            noSucceedingWord,
            requiredCharMode: mode
          }
        );
      } else {
        results = findShiritoriCombinations(
          map,
          firstChar,
          lastChar,
          wordCount,
          requiredChars,
          excludeChars,
          noPrecedingWord,
          noSucceedingWord,
          mode,
          listName,
          { totalLength, uniqueWordLengths }
        );
      }

      // 通常検索では、探索後に高度条件も含めて絞り込む
      // uniquePairOnly は finishResults() の最後に実行される前提
      results = finishResults(results, {
        uniqueWordLengths,
        uniquePairOnly,
        totalLength,
        advancedConditions,
        listName
      });
    }

    console.log(
      `Shiritori completed in ${Date.now() - started}ms (${results.length} results)`
    );

    if (outputType === 'firstCharCount' || outputType === 'lastCharCount') {
      const counts = Object.create(null);

      for (const path of results) {
        const char =
          outputType === 'firstCharCount'
            ? getFirstChar(path[0])
            : getLastChar(path[path.length - 1]);

        counts[char] = (counts[char] || 0) + 1;
      }

      const sorted = Object.fromEntries(
        Object.entries(counts).sort(([a], [b]) => collator.compare(a, b))
      );

      return outputType === 'firstCharCount'
        ? { firstCharCounts: sorted }
        : { lastCharCounts: sorted };
    }

    return { results };
  });
});

// ===== API: 単語数指定しりとり =====
app.post('/api/word_count_shiritori', (req, res) => {
  const paging = normalizePaging(req.body.page, req.body.perPage);

  let {
    listName,
    wordCountPatterns,
    allowPermutation,
    uniqueWordLengths,
    totalLength,
    advancedConditions
  } = req.body;

  const map = wordMap[listName];

  if (!map) {
    return res.status(400).json({ error: '無効な単語リストです。' });
  }

  const cachePayload = {
    listName,
    wordCountPatterns,
    allowPermutation,
    uniqueWordLengths,
    totalLength,
    advancedConditions
  };

  return cachedJson(res, 'word_count_shiritori', cachePayload, paging, () => {
    let results = [];

    if (
      !wordCountPatterns ||
      !Array.isArray(wordCountPatterns) ||
      wordCountPatterns.length === 0
    ) {
      if (!totalLength || totalLength < 1) {
        return {
          error: '単語数パターンまたは合計文字数を指定してください。'
        };
      }

      results = findShiritoriCombinations(
        map,
        null,
        null,
        null,
        null,
        null,
        false,
        false,
        'atLeast',
        listName,
        { totalLength, uniqueWordLengths }
      );
    } else {
      const ok = wordCountPatterns.every(arr =>
        Array.isArray(arr) &&
        arr.length &&
        arr.every(n => typeof n === 'number' && n > 0)
      );

      if (!ok) {
        return {
          error: '単語数の指定は1以上の数字である必要があります（例: [[2, 3], [4]]）。'
        };
      }

      results = findShiritoriByWordCountPatterns(
        map,
        wordCountPatterns,
        null,
        allowPermutation,
        'atLeast',
        listName
      );
    }

    results = finishResults(results, {
      uniqueWordLengths,
      totalLength,
      advancedConditions,
      listName
    });

    return { results };
  });
});

// ===== API: ワイルドカード単語検索 =====
app.post('/api/wildcard_search', (req, res) => {
  const paging = normalizePaging(req.body.page, req.body.perPage);

  const { listName, searchText } = req.body;
  const words = wordLists[listName];

  if (!words || !searchText) {
    return res.status(400).json({ error: '無効な入力です。' });
  }

  return cachedJson(
    res,
    'wildcard_search',
    { listName, searchText },
    paging,
    () => {
      const regex = getCachedRegex(searchText);
      const normalized = String(searchText).normalize('NFKC');

// % がある場合は文字数が固定できないので全単語から検索する
// % がない場合だけ、従来通り文字数インデックスで高速化する
      const pool =
        normalized.length && !hasMultiWildcard(normalized)
          ? (wordsByLength[listName]?.[normalized.length] || [])
          : words;

      return {
        results: pool.filter(word => regex.test(word))
      };
    }
  );
});

// ===== API: 部分一致検索 =====
app.post('/api/substring_search', (req, res) => {
  const paging = normalizePaging(req.body.page, req.body.perPage);

  const { listName, searchText } = req.body;
  const words = wordLists[listName];

  if (!words || !searchText) {
    return res.status(400).json({ error: '無効な入力です。' });
  }

  return cachedJson(
    res,
    'substring_search',
    { listName, searchText },
    paging,
    () => ({
      results: words.filter(word => word.includes(searchText))
    })
  );
});

// ===== API: ワイルドカードしりとり =====
app.post('/api/wildcard_shiritori', (req, res) => {
  const paging = normalizePaging(req.body.page, req.body.perPage);

  let {
    listName,
    wordPatterns,
    firstWordPattern,
    lastWordPattern,
    wordCount,
    requiredChars,
    requiredCharMode,
    totalLength,
    advancedConditions
  } = req.body;

  const map = wordMap[listName];

  if (!map) {
    return res.status(400).json({ error: '無効なリストです。' });
  }

  if (!wordPatterns) {
    if (Number.isNaN(Number(wordCount)) || Number(wordCount) < 1) {
      return res.status(400).json({ error: '無効な単語数です。' });
    }

    wordPatterns = new Array(Number(wordCount)).fill('');

    if (firstWordPattern) {
      wordPatterns[0] = firstWordPattern;
    }

    if (lastWordPattern) {
      wordPatterns[wordPatterns.length - 1] = lastWordPattern;
    }
  }

  if (!Array.isArray(wordPatterns) || wordPatterns.length < 1) {
    return res.status(400).json({ error: '無効な入力です。' });
  }

  requiredChars = normalizeRequiredChars(requiredChars);
  const mode = requiredCharMode === 'exactly' ? 'exactly' : 'atLeast';

  const cachePayload = {
    listName,
    wordPatterns,
    requiredChars,
    mode,
    totalLength,
    advancedConditions
  };

  return cachedJson(res, 'wildcard_shiritori', cachePayload, paging, () => {
    let results = findWildcardShiritoriCombinations(
      map,
      wordPatterns,
      requiredChars,
      mode,
      listName
    );

    results = finishResults(results, {
      totalLength,
      advancedConditions,
      listName
    });

    return { results };
  });
});

// ===== API: ループしりとり =====
app.post('/api/loop_shiritori', (req, res) => {
  const paging = normalizePaging(req.body.page, req.body.perPage);

  const {
    listName,
    pattern,
    totalLength,
    advancedConditions
  } = req.body;

  const map = wordMap[listName];

  if (!map || !pattern) {
    return res.status(400).json({
      error: 'リスト名またはパターンが指定されていません。'
    });
  }

  const cachePayload = {
    listName,
    pattern,
    totalLength,
    advancedConditions
  };

  return cachedJson(res, 'loop_shiritori', cachePayload, paging, () => {
    let results = findLoopShiritori(map, pattern, listName);

    results = finishResults(results, {
      totalLength,
      advancedConditions,
      listName
    });

    return { results };
  });
});

// ===== API: チェーンしりとり =====
app.post('/api/chain_shiritori', (req, res) => {
  const paging = normalizePaging(req.body.page, req.body.perPage);

  let {
    listName,
    pattern,
    requiredChars,
    excludeChars,
    requiredCharMode,
    advancedConditions
  } = req.body;

  const map = wordMap[listName];

  if (!map) {
    return res.status(400).json({ error: '無効な単語リストです。' });
  }

  if (!pattern || !String(pattern).trim()) {
    return res.status(400).json({ error: 'パターンは必須です。' });
  }

  requiredChars = normalizeRequiredChars(requiredChars);
  excludeChars = normalizeExcludeChars(excludeChars);

  const mode = requiredCharMode === 'exactly' ? 'exactly' : 'atLeast';

  const cachePayload = {
    listName,
    pattern,
    requiredChars,
    excludeChars,
    mode,
    advancedConditions
  };

  return cachedJson(res, 'chain_shiritori', cachePayload, paging, () => {
    let results = findChainShiritori(
      map,
      pattern,
      requiredChars,
      excludeChars,
      mode,
      listName
    );

    results = finishResults(results, {
      advancedConditions,
      listName
    });

    return { results };
  });
});

// ===== API: 自動生成 =====
app.post('/api/auto_generate', (req, res) => {
  const paging = normalizePaging(req.body.page, req.body.perPage);

  let {
    listName,
    minSolutions,
    maxSolutions,
    firstCharMode,
    firstChar,
    lastCharMode,
    lastChar,
    wordCountMode,
    wordCount,
    includeCharsMode,
    includeChars,
    excludeCharsMode,
    excludeChars,
    totalLengthMode,
    totalLength,
    uniqueWordLengths,
    advancedConditions
  } = req.body;

  const map = wordMap[listName];

  if (!map) {
    return res.status(400).json({ error: '無効な単語リストです。' });
  }

  minSolutions = parseInt(minSolutions, 10) || 5;
  maxSolutions = parseInt(maxSolutions, 10) || 20;

  if (minSolutions < 1 || maxSolutions < 1 || minSolutions > maxSolutions) {
    return res.status(400).json({
      error: '解の範囲を正しく指定してください（最小 ≤ 最大）。'
    });
  }

  const fixedWordCount =
    wordCountMode === 'fixed'
      ? parseInt(wordCount, 10)
      : (parseInt(wordCount, 10) || 3);

  if (!fixedWordCount || fixedWordCount < 1) {
    return res.status(400).json({
      error: '単語数は1以上である必要があります。'
    });
  }

  const cachePayload = {
    listName,
    minSolutions,
    maxSolutions,
    firstCharMode,
    firstChar,
    lastCharMode,
    lastChar,
    wordCountMode,
    wordCount: fixedWordCount,
    includeCharsMode,
    includeChars,
    excludeCharsMode,
    excludeChars,
    totalLengthMode,
    totalLength,
    uniqueWordLengths,
    advancedConditions
  };

  return cachedJson(res, 'auto_generate', cachePayload, paging, () => {
    let fixedFirstChar =
      firstCharMode === 'fixed' ? (firstChar || null) : null;

    let fixedLastChar =
      lastCharMode === 'fixed' ? (lastChar || null) : null;

    const fixedIncludeChars =
      includeCharsMode === 'fixed'
        ? normalizeRequiredChars(includeChars)
        : null;

    const fixedExcludeChars =
      excludeCharsMode === 'fixed'
        ? normalizeExcludeChars(excludeChars)
        : null;

    const fixedTotalLength =
      totalLengthMode === 'fixed'
        ? parseInt(totalLength, 10)
        : null;

    const conditions = {};
    let finalResults = [];

    if (firstCharMode === 'auto') {
      for (const char of listIndexes[listName].firstChars) {
        let results = findShiritoriCombinations(
          map,
          char,
          fixedLastChar,
          fixedWordCount,
          fixedIncludeChars,
          fixedExcludeChars,
          false,
          false,
          'atLeast',
          listName,
          {
            totalLength: fixedTotalLength,
            uniqueWordLengths
          }
        );

        results = finishResults(results, {
          uniqueWordLengths,
          totalLength: fixedTotalLength,
          advancedConditions,
          listName
        });

        if (
          results.length >= minSolutions &&
          results.length <= maxSolutions
        ) {
          fixedFirstChar = char;
          finalResults = results;
          break;
        }
      }

      if (!fixedFirstChar) {
        return {
          results: [],
          conditions,
          message: `開始文字を「自動」で設定した場合、${minSolutions}個以上${maxSolutions}個以下の条件が見つかりませんでした。`
        };
      }
    }

    conditions.firstChar = fixedFirstChar || '（指定なし）';

    if (lastCharMode === 'auto') {
      for (const char of listIndexes[listName].lastChars) {
        let results = findShiritoriCombinations(
          map,
          fixedFirstChar,
          char,
          fixedWordCount,
          fixedIncludeChars,
          fixedExcludeChars,
          false,
          false,
          'atLeast',
          listName,
          {
            totalLength: fixedTotalLength,
            uniqueWordLengths
          }
        );

        results = finishResults(results, {
          uniqueWordLengths,
          totalLength: fixedTotalLength,
          advancedConditions,
          listName
        });

        if (
          results.length >= minSolutions &&
          results.length <= maxSolutions
        ) {
          fixedLastChar = char;
          finalResults = results;
          break;
        }
      }

      if (!fixedLastChar) {
        return {
          results: [],
          conditions,
          message: `終了文字を「自動」で設定した場合、${minSolutions}個以上${maxSolutions}個以下の条件が見つかりませんでした。`
        };
      }
    }

    conditions.lastChar = fixedLastChar || '（指定なし）';

    if (finalResults.length === 0) {
      finalResults = findShiritoriCombinations(
        map,
        fixedFirstChar,
        fixedLastChar,
        fixedWordCount,
        fixedIncludeChars,
        fixedExcludeChars,
        false,
        false,
        'atLeast',
        listName,
        {
          totalLength: fixedTotalLength,
          uniqueWordLengths
        }
      );

      finalResults = finishResults(finalResults, {
        uniqueWordLengths,
        totalLength: fixedTotalLength,
        advancedConditions,
        listName
      });
    }

    conditions.wordCount = fixedWordCount;
    conditions.includeChars =
      fixedIncludeChars ? fixedIncludeChars.join(',') : '（指定なし）';
    conditions.excludeChars =
      fixedExcludeChars ? fixedExcludeChars.join(',') : '（指定なし）';
    conditions.totalLength = fixedTotalLength || '（指定なし）';
    conditions.uniqueWordLengths = uniqueWordLengths ? 'ON' : 'OFF';

    if (totalLengthMode === 'auto' && finalResults.length > maxSolutions) {
      const byLength = Object.create(null);

      for (const path of finalResults) {
        const len = path.reduce((sum, word) => sum + word.length, 0);

        if (!byLength[len]) {
          byLength[len] = [];
        }

        byLength[len].push(path);
      }

      for (const len of Object.keys(byLength).map(Number).sort((a, b) => a - b)) {
        if (
          byLength[len].length >= minSolutions &&
          byLength[len].length <= maxSolutions
        ) {
          finalResults = byLength[len];
          conditions.totalLength = len;
          break;
        }
      }
    }

    if (finalResults.length < minSolutions) {
      return {
        results: [],
        conditions,
        message: `解の個数が範囲外です。最小${minSolutions}個必要ですが、${finalResults.length}個しか見つかりませんでした。`
      };
    }

    if (finalResults.length > maxSolutions) {
      finalResults = finalResults.slice(0, maxSolutions);
    }

    return {
      results: finalResults,
      conditions
    };
  });
});

// ===== サーバー起動 =====
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});