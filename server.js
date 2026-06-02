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
  [1, 0],    // →
  [-1, 0],   // ←
  [0, 1],    // ↓
  [0, -1],   // ↑
  [1, 1],    // ↘
  [-1, -1],  // ↖
  [1, -1],   // ↗
  [-1, 1]    // ↙
];

// 単語の正規化（英字化・大文字化・記号削除）
// 例: "New-Zealand" -> "NEWZEALAND"
function normalizeWord(word) {
  return word
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // アクセント除去
    .replace(/[^A-Za-z]/g, "")       // 英字以外除去
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

  // 重複除去
  return [...new Set(words)];
}

function createGrid(size) {
  return Array.from({ length: size }, () => Array(size).fill(""));
}

function canPlace(grid, word, x, y, dx, dy) {
  const size = grid.length;

  for (let i = 0; i < word.length; i++) {
    const nx = x + dx * i;
    const ny = y + dy * i;

    if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
      return false;
    }

    const current = grid[ny][nx];
    if (current !== "" && current !== word[i]) {
      return false;
    }
  }

  return true;
}

function placeWord(grid, word, maxAttempts = 200) {
  const size = grid.length;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const [dx, dy] = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
    const x = Math.floor(Math.random() * size);
    const y = Math.floor(Math.random() * size);

    if (canPlace(grid, word, x, y, dx, dy)) {
      for (let i = 0; i < word.length; i++) {
        const nx = x + dx * i;
        const ny = y + dy * i;
        grid[ny][nx] = word[i];
      }
      return true;
    }
  }

  return false;
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

function generateWordSearch(words, size) {
  const grid = createGrid(size);

  // 長い単語優先 + 長さが同じならランダム性
  const sortedWords = [...words].sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    return Math.random() - 0.5;
  });

  const placedWords = [];
  const notPlacedWords = [];

  for (const word of sortedWords) {
    if (word.length > size) {
      notPlacedWords.push(word);
      continue;
    }

    const placed = placeWord(grid, word, 300);
    if (placed) {
      placedWords.push(word);
    } else {
      notPlacedWords.push(word);
    }
  }

  fillGrid(grid);

  return {
    grid,
    placedWords,
    notPlacedWords,
    totalWords: sortedWords.length
  };
}

app.post("/api/generate", (req, res) => {
  try {
    const { wordType, size } = req.body;

    if (!WORD_FILES[wordType]) {
      return res.status(400).json({ error: "無効な単語リストです。" });
    }

    const numericSize = Number(size);
    if (!Number.isInteger(numericSize) || numericSize < 5 || numericSize > 30) {
      return res.status(400).json({ error: "盤面サイズは 5〜30 の整数で指定してください。" });
    }

    const words = loadWords(WORD_FILES[wordType]);
    const result = generateWordSearch(words, numericSize);

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "サーバー内部エラーが発生しました。" });
  }
});

// index.html を返す
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});