const generateBtn = document.getElementById("generateBtn");
const wordTypeEl = document.getElementById("wordType");
const gridSizeEl = document.getElementById("gridSize");
const statusEl = document.getElementById("status");
const gridEl = document.getElementById("grid");
const placedWordsEl = document.getElementById("placedWords");
const notPlacedWordsEl = document.getElementById("notPlacedWords");

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
  notPlacedWordsEl.innerHTML = "";

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
    renderWords(placedWordsEl, data.placedWords, false);
    renderWords(notPlacedWordsEl, data.notPlacedWords, true);

    statusEl.textContent =
      `生成完了：${data.placedWords.length}語配置 / ${data.totalWords}語中`;
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

function renderWords(container, words, isNotPlaced) {
  container.innerHTML = "";

  if (!words || words.length === 0) {
    container.textContent = isNotPlaced ? "なし" : "0語";
    return;
  }

  words.forEach(word => {
    const span = document.createElement("span");
    span.className = isNotPlaced ? "word-chip not-placed" : "word-chip";
    span.textContent = word;
    container.appendChild(span);
  });
}
