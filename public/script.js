document.addEventListener("DOMContentLoaded", () => {
  const generateBtn = document.getElementById("generateBtn");
  const wordTypeEl = document.getElementById("wordType");
  const gridSizeEl = document.getElementById("gridSize");
  const statusEl = document.getElementById("status");

  const gridEl = document.getElementById("grid");
  const usageGridEl = document.getElementById("usageGrid");
  const placedWordsEl = document.getElementById("placedWords");

  const placedWordCountEl = document.getElementById("placedWordCount");
  const totalPlacedCharsEl = document.getElementById("totalPlacedChars");
  const boardSizeValueEl = document.getElementById("boardSizeValue");

  const overlapCellCountEl = document.getElementById("overlapCellCount");
  const overlapScoreEl = document.getElementById("overlapScore");
  const maxUsageEl = document.getElementById("maxUsage");
  const usedCellCountEl = document.getElementById("usedCellCount");
  const totalUsageCountEl = document.getElementById("totalUsageCount");

  const requiredElements = [
    { name: "generateBtn", element: generateBtn },
    { name: "wordType", element: wordTypeEl },
    { name: "gridSize", element: gridSizeEl },
    { name: "status", element: statusEl },
    { name: "grid", element: gridEl },
    { name: "usageGrid", element: usageGridEl },
    { name: "placedWords", element: placedWordsEl },
    { name: "placedWordCount", element: placedWordCountEl },
    { name: "totalPlacedChars", element: totalPlacedCharsEl },
    { name: "boardSizeValue", element: boardSizeValueEl },
    { name: "overlapCellCount", element: overlapCellCountEl },
    { name: "overlapScore", element: overlapScoreEl },
    { name: "maxUsage", element: maxUsageEl },
    { name: "usedCellCount", element: usedCellCountEl },
    { name: "totalUsageCount", element: totalUsageCountEl }
  ];

  const missingElements = requiredElements.filter(item => !item.element);

  if (missingElements.length > 0) {
    console.error(
      "index.html に必要な要素が見つかりません:",
      missingElements.map(item => item.name)
    );

    if (statusEl) {
      statusEl.textContent =
        "HTMLの一部が見つかりません。index.html の id 名を確認してください。";
    }

    return;
  }

  generateBtn.addEventListener("click", generatePuzzle);

  async function generatePuzzle() {
    const wordType = wordTypeEl.value;
    const size = Number(gridSizeEl.value);

    if (!Number.isInteger(size) || size < 5 || size > 30) {
      statusEl.textContent = "盤面サイズは 5〜30 の整数で入力してください。";
      return;
    }

    setLoadingState(true);
    resetView(size);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          wordType,
          size
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "生成に失敗しました。");
      }

      renderGrid(data.grid);
      renderUsageGrid(data.usageGrid);
      renderWords(data.placedWords);
      renderStats(data);

      statusEl.textContent =
        `生成完了：${data.placedWordCount ?? 0}語 / ` +
        `合計 ${data.totalPlacedChars ?? 0}文字 / ` +
        `重複マス ${data.overlapCellCount ?? 0}`;
    } catch (error) {
      console.error(error);
      statusEl.textContent = `エラー: ${error.message}`;
    } finally {
      setLoadingState(false);
    }
  }

  function setLoadingState(isLoading) {
    generateBtn.disabled = isLoading;
    generateBtn.textContent = isLoading ? "生成中..." : "生成する";
  }

  function resetView(size) {
    statusEl.textContent = "生成中...";

    gridEl.innerHTML = "";
    usageGridEl.innerHTML = "";
    placedWordsEl.innerHTML = "";

    placedWordCountEl.textContent = "0";
    totalPlacedCharsEl.textContent = "0";
    boardSizeValueEl.textContent = `${size}×${size}`;

    overlapCellCountEl.textContent = "0";
    overlapScoreEl.textContent = "0";
    maxUsageEl.textContent = "0";
    usedCellCountEl.textContent = "0";
    totalUsageCountEl.textContent = "0";
  }

  function renderStats(data) {
    const size = data.size ?? 0;

    placedWordCountEl.textContent = data.placedWordCount ?? 0;
    totalPlacedCharsEl.textContent = data.totalPlacedChars ?? 0;
    boardSizeValueEl.textContent = `${size}×${size}`;

    overlapCellCountEl.textContent = data.overlapCellCount ?? 0;
    overlapScoreEl.textContent = data.overlapScore ?? 0;
    maxUsageEl.textContent = data.maxUsage ?? 0;
    usedCellCountEl.textContent = data.usedCellCount ?? 0;
    totalUsageCountEl.textContent = data.totalUsageCount ?? 0;
  }

  function renderGrid(grid) {
    gridEl.innerHTML = "";

    if (!Array.isArray(grid) || grid.length === 0) {
      gridEl.textContent = "盤面データがありません。";
      return;
    }

    const size = grid.length;
    const cellSize = getCellSize(size);
    const fontSize = getFontSize(cellSize);

    gridEl.style.gridTemplateColumns = `repeat(${size}, ${cellSize}px)`;

    grid.forEach(row => {
      row.forEach(letter => {
        const div = document.createElement("div");

        div.className = "cell";
        div.textContent = letter;
        div.style.width = `${cellSize}px`;
        div.style.height = `${cellSize}px`;
        div.style.fontSize = fontSize;

        gridEl.appendChild(div);
      });
    });
  }

  function renderUsageGrid(usageGrid) {
    usageGridEl.innerHTML = "";

    if (!Array.isArray(usageGrid) || usageGrid.length === 0) {
      usageGridEl.textContent = "使用状況データがありません。";
      return;
    }

    const size = usageGrid.length;
    const cellSize = getCellSize(size);
    const fontSize = getFontSize(cellSize);

    usageGridEl.style.gridTemplateColumns = `repeat(${size}, ${cellSize}px)`;

    usageGrid.forEach(row => {
      row.forEach(count => {
        const div = document.createElement("div");

        div.className = "usage-cell";
        div.textContent = count;
        div.style.width = `${cellSize}px`;
        div.style.height = `${cellSize}px`;
        div.style.fontSize = fontSize;

        if (count === 0) {
          div.classList.add("usage-zero");
        } else if (count === 1) {
          div.classList.add("usage-one");
        } else if (count === 2) {
          div.classList.add("usage-multi");
        } else {
          div.classList.add("usage-high");
        }

        usageGridEl.appendChild(div);
      });
    });
  }

  function renderWords(words) {
    placedWordsEl.innerHTML = "";

    if (!Array.isArray(words) || words.length === 0) {
      placedWordsEl.textContent = "使われた単語はありません。";
      return;
    }

    words.forEach(word => {
      const span = document.createElement("span");

      span.className = "word-chip";
      span.textContent = word;

      placedWordsEl.appendChild(span);
    });
  }

  function getCellSize(size) {
    if (size <= 15) return 32;
    if (size <= 20) return 28;
    if (size <= 25) return 24;
    return 22;
  }

  function getFontSize(cellSize) {
    if (cellSize >= 32) return "16px";
    if (cellSize >= 28) return "14px";
    if (cellSize >= 24) return "12px";
    return "11px";
  }
});