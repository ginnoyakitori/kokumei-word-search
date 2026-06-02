const generateBtn = document.getElementById("generateBtn");
const wordTypeEl = document.getElementById("wordType");
const gridSizeEl = document.getElementById("gridSize");
const statusEl = document.getElementById("status");
const gridEl = document.getElementById("grid");
const placedWordsEl = document.getElementById("placedWords");

const placedWordCountEl = document.getElementById("placedWordCount");
const totalPlacedCharsEl = document.getElementById("totalPlacedChars");
const boardSizeValueEl = document.getElementById("boardSizeValue");
const usageGridEl = document.getElementById("usageGrid");

generateBtn.addEventListener("click", generatePuzzle);

async function generatePuzzle() {
  const wordType = wordTypeEl.value;
  const size = Number(gridSizeEl.value);

  if (!size || size < 5 || size > 30) {
    statusEl.textContent = "盤面サイズは 5〜30 の範囲で入力してください。";
    return;
  }

  statusEl.textContent = "生成中...";
  gridEl.innerHTML = "";
  placedWordsEl.innerHTML = "";
  usageGridEl.innerHTML = "";

  placedWordCountEl.textContent = "0";
  totalPlacedCharsEl.textContent = "0";
  boardSizeValueEl.textContent = `${size}×${size}`;

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ wordType, size })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "生成に失敗しました");
    }

    renderGrid(data.grid);
    renderUsageGrid(data.usageGrid);
    renderWords(placedWordsEl, data.placedWords);

    placedWordCountEl.textContent = data.placedWordCount;
    totalPlacedCharsEl.textContent = data.totalPlacedChars;
    boardSizeValueEl.textContent = `${data.size}×${data.size}`;

    statusEl.textContent =
      `生成完了：${data.placedWordCount}語 / 合計 ${data.totalPlacedChars}文字`;
  } catch (error) {
    console.error(error);
    statusEl.textContent = `エラー: ${error.message}`;
  }
}

function renderGrid(grid) {
  gridEl.innerHTML = "";
  const size = grid.length;
  gridEl.style.gridTemplateColumns = `repeat(${size}, 32px)`;

  grid.forEach(row => {
    row.forEach(cell => {
      const div = document.createElement("div");
      div.className = "cell";
      div.textContent = cell;
      gridEl.appendChild(div);
    });
  });
}

function renderUsageGrid(usageGrid) {
  usageGridEl.innerHTML = "";

  if (!usageGrid || usageGrid.length === 0) {
    usageGridEl.textContent = "使用状況データがありません。";
    return;
  }

  const size = usageGrid.length;
  usageGridEl.style.gridTemplateColumns = `repeat(${size}, 32px)`;

  usageGrid.forEach(row => {
    row.forEach(count => {
      const div = document.createElement("div");
      div.className = "usage-cell";

      if (count === 0) {
        div.classList.add("usage-zero");
      }

      if (count >= 2) {
        div.classList.add("usage-multi");
      }

      div.textContent = count;
      usageGridEl.appendChild(div);
    });
  });
}

function renderWords(container, words) {
  container.innerHTML = "";

  if (!words || words.length === 0) {
    container.textContent = "使われた単語はありません。";
    return;
  }

  words.forEach(word => {
    const span = document.createElement("span");
    span.className = "word-chip";
    span.textContent = word;
    container.appendChild(span);
  });
}
``