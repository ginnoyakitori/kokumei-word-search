document.addEventListener('DOMContentLoaded', () => {
    // --- 共通要素の取得 ---
    const modeSelect = document.getElementById('modeSelect');
    const listNameSelect = document.getElementById('listName'); // 共通リスト
    const resultsDiv = document.getElementById('results');
    const searchButtons = document.querySelectorAll('.search-btn');
    const resultPageInput = document.getElementById('resultPage');
    const resultsPerPageInput = document.getElementById('resultsPerPage');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');

    const modeSections = {
        shiritori: document.getElementById('shiritoriMode'),
        wildcardShiritori: document.getElementById('wildcardShiritoriMode'),
        wordCountShiritori: document.getElementById('wordCountShiritoriMode'),
        loop: document.getElementById('loopMode'),
        chain: document.getElementById('chainMode'),
        autoGenerate: document.getElementById('autoGenerateMode'),
        wildcard: document.getElementById('wildcardMode'),
        substring: document.getElementById('substringMode')
    };

    // ヘルパー関数: 要素が存在すれば値を、なければデフォルト値を返す
    const getVal = (id) => document.getElementById(id)?.value || '';
    const getChecked = (id) => document.getElementById(id)?.checked || false;
    const setVal = (id, value) => {
        const element = document.getElementById(id);
        if (element && value !== undefined && value !== null) {
            element.value = value;
        }
    };
    const setChecked = (id, checked) => {
        const element = document.getElementById(id);
        if (element) {
            element.checked = Boolean(checked);
        }
    };
    const getPagingRequest = () => ({
        page: Math.max(1, parseInt(resultPageInput?.value, 10) || 1),
        perPage: Math.min(500, Math.max(1, parseInt(resultsPerPageInput?.value, 10) || 100))
    });
    const runActiveSearch = () => {
        const activeSection = modeSections[modeSelect.value];
        const button = activeSection?.querySelector('.search-btn');
        if (button) button.click();
    };

    // --- 1. ビュー切り替えロジック ---
    const updateModeView = () => {
        const selectedMode = modeSelect.value;
        Object.keys(modeSections).forEach(mode => {
            if (modeSections[mode]) {
                modeSections[mode].classList.toggle('active', mode === selectedMode);
            }
        });
    };
    modeSelect.addEventListener('change', updateModeView);
    modeSelect.addEventListener('change', () => {
        if (resultPageInput) resultPageInput.value = '1';
    });
    listNameSelect.addEventListener('change', () => {
        if (resultPageInput) resultPageInput.value = '1';
    });
    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', () => {
            const currentPage = Math.max(1, parseInt(resultPageInput?.value, 10) || 1);
            if (currentPage <= 1) return;
            resultPageInput.value = String(currentPage - 1);
            runActiveSearch();
        });
    }
    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', () => {
            const currentPage = Math.max(1, parseInt(resultPageInput?.value, 10) || 1);
            resultPageInput.value = String(currentPage + 1);
            runActiveSearch();
        });
    }
    updateModeView();

    // --- 2. 動的フィールド管理：？文字指定しりとり (wildcardShiritori) ---
    const wordPatternList = document.getElementById('wordPatternList');
    const addPatternBtn = document.getElementById('addPatternBtn');

    if (addPatternBtn && wordPatternList) {
        addPatternBtn.addEventListener('click', () => {
            const currentItems = wordPatternList.querySelectorAll('.pattern-item');
            const newDiv = document.createElement('div');
            newDiv.className = 'pattern-item';
            newDiv.style.marginTop = "8px";
            newDiv.innerHTML = `
                <span class="label">${currentItems.length + 1}番目:</span>
                <input type="text" class="word-pattern-input" placeholder="例: ？？ン">
                <button class="remove-pattern-btn" style="margin-left:5px;">-</button>
            `;
            wordPatternList.appendChild(newDiv);
        });

        wordPatternList.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-pattern-btn')) {
                e.target.closest('.pattern-item').remove();
                // ラベル番号の振り直し
                wordPatternList.querySelectorAll('.pattern-item').forEach((item, index) => {
                    const label = item.querySelector('.label');
                    if (label) label.textContent = `${index + 1}番目:`;
                });
            }
        });
    }

    // --- 3. 動的フィールド管理：単語数指定しりとり (wordCountShiritori) ---
    const wordCountInputsContainer = document.getElementById('wordCountInputs');
    const addWordCountInputButton = document.getElementById('addWordCountInput');

    if (addWordCountInputButton) {
        addWordCountInputButton.addEventListener('click', () => {
            const newGroup = document.createElement('div');
            newGroup.className = 'word-count-input-group';
            newGroup.innerHTML = `
                <input type="text" class="word-count-input" value="3" placeholder="例: 3,4">
                <button class="remove-word-count-input">-</button>
            `;
            wordCountInputsContainer.appendChild(newGroup);
        });

        wordCountInputsContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-word-count-input')) {
                if (wordCountInputsContainer.querySelectorAll('.word-count-input-group').length > 1) {
                    e.target.closest('.word-count-input-group').remove();
                }
            }
        });
    }

    // 文字数入力の表示制御
    const wordCountTypeSelect = document.getElementById('wordCountType');
    const shiritoriTotalLengthInput = document.getElementById('shiritoriTotalLength');

    const updateWordCountNoneOption = () => {
        if (!wordCountTypeSelect) return;
        const noneOption = wordCountTypeSelect.querySelector('option[value="none"]');
        const hasTotalLength = shiritoriTotalLengthInput?.value.trim() !== '';
        if (noneOption) {
            noneOption.disabled = !hasTotalLength;
        }
        if (!hasTotalLength && wordCountTypeSelect.value === 'none') {
            wordCountTypeSelect.value = 'shortest';
        }
        const container = document.getElementById('wordCountInputContainer');
        if (container) container.style.display = (wordCountTypeSelect.value === 'fixed') ? 'block' : 'none';
    };

    if (wordCountTypeSelect) {
        wordCountTypeSelect.addEventListener('change', () => {
            updateWordCountNoneOption();
        });
    }
    if (shiritoriTotalLengthInput) {
        shiritoriTotalLengthInput.addEventListener('input', () => {
            updateWordCountNoneOption();
        });
    }
    updateWordCountNoneOption();

    // --- 3.5 自動生成モード：条件モード切り替え ---
    const conditionModeSelects = document.querySelectorAll('.condition-mode-select');

    const updateAutoConditionRow = (select) => {
        const row = select.closest('.auto-condition-group');
        if (!row) return;
        const container = row.querySelector('.condition-input-container');
        const input = row.querySelector('.auto-condition-input');
        if (!container || !input) return;

        const mode = select.value;
        if (mode === 'fixed') {
            container.style.display = 'block';
            input.disabled = false;
            if (input.dataset.placeholderFixed) {
                input.placeholder = input.dataset.placeholderFixed;
            }
        } else if (mode === 'auto') {
            container.style.display = 'block';
            input.disabled = true;
            if (!input.dataset.placeholderFixed) {
                input.dataset.placeholderFixed = input.placeholder;
            }
            input.placeholder = '自動で決定';
            input.value = '';
        } else {
            container.style.display = 'none';
            input.disabled = true;
            input.value = '';
        }
    };

    conditionModeSelects.forEach(select => {
        updateAutoConditionRow(select);
        select.addEventListener('change', (e) => updateAutoConditionRow(e.target));
    });

    // --- 3.6 条件チャット ---
    const chatInput = document.getElementById('conditionChatInput');
    const chatApplyButton = document.getElementById('conditionChatApply');
    const chatMessages = document.getElementById('chatMessages');
    let chatAdvancedConditions = {};

    const appendChatMessage = (message, type = 'assistant') => {
        if (!chatMessages) return;
        const div = document.createElement('div');
        div.className = `chat-message ${type}`;
        div.textContent = message;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    };

    const normalizeChatText = (text) => text
        .normalize('NFKC')
        .replace(/[，､]/g, ',')
        .replace(/[〜～]/g, '~')
        .trim();

    const parseJapaneseNumber = (value) => {
        if (!value) return null;
        const normalized = value.normalize('NFKC');
        const numeric = parseInt(normalized, 10);
        if (!Number.isNaN(numeric)) return numeric;

        const digits = {
            '零': 0, '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4,
            '五': 5, '六': 6, '七': 7, '八': 8, '九': 9
        };

        if (normalized === '十') return 10;
        const tenIndex = normalized.indexOf('十');
        if (tenIndex !== -1) {
            const before = normalized.slice(0, tenIndex);
            const after = normalized.slice(tenIndex + 1);
            const tens = before ? digits[before] : 1;
            const ones = after ? digits[after] : 0;
            if (tens !== undefined && ones !== undefined) return tens * 10 + ones;
        }

        return digits[normalized] ?? null;
    };

    const toCharList = (value) => {
        if (!value) return [];
        return value
            .replace(/[、\s]+/g, ',')
            .split(',')
            .map(part => part.trim())
            .filter(Boolean);
    };

    const getMatch = (text, patterns, groupIndex = 1) => {
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match?.[groupIndex]) {
                return match[groupIndex].trim();
            }
        }
        return null;
    };

    const parseNumberRule = (text, patterns) => {
        for (const { pattern, mode = 'exact' } of patterns) {
            const match = text.match(pattern);
            if (match?.[1]) {
                const value = parseJapaneseNumber(match[1]);
                if (value !== null) return { mode, value };
            }
        }
        return null;
    };

    const parseAdvancedConditions = (text) => {
        const advanced = {};

        const dakutenCount = parseNumberRule(text, [
            { pattern: /濁音(?:数)?(?:は|を|:|：)?\s*([0-9一二三四五六七八九十]+)\s*(?:個|文字|つ)?以上/, mode: 'min' },
            { pattern: /濁音(?:数)?(?:は|を|:|：)?\s*([0-9一二三四五六七八九十]+)\s*(?:個|文字|つ)?以下/, mode: 'max' },
            { pattern: /濁音(?:数)?(?:は|を|:|：)?\s*([0-9一二三四五六七八九十]+)\s*(?:個|文字|つ)?/ },
            { pattern: /濁点(?:数)?(?:は|を|:|：)?\s*([0-9一二三四五六七八九十]+)\s*(?:個|文字|つ)?/ }
        ]);
        if (dakutenCount) advanced.dakutenCount = dakutenCount;

        const handakutenCount = parseNumberRule(text, [
            { pattern: /半濁音(?:数)?(?:は|を|:|：)?\s*([0-9一二三四五六七八九十]+)\s*(?:個|文字|つ)?以上/, mode: 'min' },
            { pattern: /半濁音(?:数)?(?:は|を|:|：)?\s*([0-9一二三四五六七八九十]+)\s*(?:個|文字|つ)?以下/, mode: 'max' },
            { pattern: /半濁音(?:数)?(?:は|を|:|：)?\s*([0-9一二三四五六七八九十]+)\s*(?:個|文字|つ)?/ },
            { pattern: /半濁点(?:数)?(?:は|を|:|：)?\s*([0-9一二三四五六七八九十]+)\s*(?:個|文字|つ)?/ }
        ]);
        if (handakutenCount) advanced.handakutenCount = handakutenCount;

        const smallKanaCount = parseNumberRule(text, [
            { pattern: /(?:小さい文字|小書き文字|拗音|促音)(?:数)?(?:は|を|:|：)?\s*([0-9一二三四五六七八九十]+)\s*(?:個|文字|つ)?/ },
            { pattern: /[「\"]?[ァィゥェォッャュョヮぁぃぅぇぉっゃゅょゎ][」\"]?などの小さい文字(?:数)?(?:は|を|:|：)?\s*([0-9一二三四五六七八九十]+)\s*(?:個|文字|つ)?/ }
        ]);
        if (smallKanaCount) advanced.smallKanaCount = smallKanaCount;

        const repeatedCharWordCount = parseNumberRule(text, [
            { pattern: /(?:同じ文字|重複文字).*(?:国名|単語)(?:数)?(?:は|を|:|：)?\s*([0-9一二三四五六七八九十]+)\s*(?:個|語|つ)?/ },
            { pattern: /(?:文字を複数回使っている|文字が重複している)(?:国名|単語)(?:数)?(?:は|を|:|：)?\s*([0-9一二三四五六七八九十]+)\s*(?:個|語|つ)?/ }
        ]);
        if (repeatedCharWordCount) advanced.repeatedCharWordCount = repeatedCharWordCount;

        if (/(?:前|前に|最初の(?:国名|単語)の前).*(?:続けられる|つなげられる).*(?:なし|ない|不可|無)/.test(text)) {
            advanced.hasPrecedingWord = false;
        } else if (/(?:前|前に|最初の(?:国名|単語)の前).*(?:続けられる|つなげられる).*(?:あり|ある|可|有)/.test(text)) {
            advanced.hasPrecedingWord = true;
        }

        if (/(?:後|後に|最後の(?:国名|単語)の後).*(?:続けられる|つなげられる).*(?:なし|ない|不可|無)/.test(text)) {
            advanced.hasSucceedingWord = false;
        } else if (/(?:後|後に|最後の(?:国名|単語)の後).*(?:続けられる|つなげられる).*(?:あり|ある|可|有)/.test(text)) {
            advanced.hasSucceedingWord = true;
        }

        if (/単調増加|狭義増加|文字数.*増加/.test(text)) {
            advanced.lengthPattern = 'increasing';
        } else if (/広義増加|非減少/.test(text)) {
            advanced.lengthPattern = 'nondecreasing';
        } else if (/単調減少|狭義減少|文字数.*減少/.test(text)) {
            advanced.lengthPattern = 'decreasing';
        } else if (/広義減少|非増加/.test(text)) {
            advanced.lengthPattern = 'nonincreasing';
        } else if (/等差数列|等差/.test(text)) {
            advanced.lengthPattern = 'arithmetic';
        } else if (/等比数列|等比/.test(text)) {
            advanced.lengthPattern = 'geometric';
        }

        if (/高度条件.*(?:解除|クリア)|条件.*(?:解除|クリア)|リセット/.test(text)) {
            advanced.clear = true;
        }

        return advanced;
    };

    const parseConditionChat = (rawText) => {
        const text = normalizeChatText(rawText);
        const parsed = {};

        const modeKeywords = [
            ['autoGenerate', /自動生成/],
            ['wildcardShiritori', /[?？]文字指定|ワイルドカード.*しりとり/],
            ['wordCountShiritori', /単語数指定/],
            ['loop', /ループ/],
            ['chain', /チェーン/],
            ['wildcard', /単語検索.*[?？]|[?？].*単語検索/],
            ['substring', /部分一致/],
            ['shiritori', /文字指定|しりとり/]
        ];
        const modeKeyword = modeKeywords.find(([, pattern]) => pattern.test(text));
        if (modeKeyword) parsed.mode = modeKeyword[0];

        parsed.firstChar = getMatch(text, [
            /(?:開始|始まり|最初|先頭)(?:文字)?(?:は|を|:|：)?\s*([ァ-ンーぁ-んA-Za-z])/,
            /([ァ-ンーぁ-んA-Za-z])\s*(?:から|で始)/
        ]);

        parsed.lastChar = getMatch(text, [
            /(?:終了|終わり|最後|末尾)(?:文字)?(?:は|を|:|：)?\s*([ァ-ンーぁ-んA-Za-z])/,
            /([ァ-ンーぁ-んA-Za-z])\s*(?:まで|で終)/
        ]);

        const wordCountValue = getMatch(text, [
            /([0-9一二三四五六七八九十]+)\s*(?:語|単語)/,
            /(?:単語数|語数)(?:は|を|:|：)?\s*([0-9一二三四五六七八九十]+)/
        ]);
        parsed.wordCount = parseJapaneseNumber(wordCountValue);

        const totalLengthValue = getMatch(text, [
            /(?:合計|総)(?:文字数)?(?:は|を|:|：)?\s*([0-9一二三四五六七八九十]+)\s*文字?/,
            /([0-9一二三四五六七八九十]+)\s*文字(?:ちょうど|合計|で)?/
        ]);
        parsed.totalLength = parseJapaneseNumber(totalLengthValue);

        const minMaxMatch = text.match(/([0-9一二三四五六七八九十]+)\s*(?:~|-|から)\s*([0-9一二三四五六七八九十]+)\s*(?:個|件|解)?/);
        if (minMaxMatch) {
            parsed.minSolutions = parseJapaneseNumber(minMaxMatch[1]);
            parsed.maxSolutions = parseJapaneseNumber(minMaxMatch[2]);
        } else {
            const maxValue = getMatch(text, [/(?:最大|上限)(?:は|を|:|：)?\s*([0-9一二三四五六七八九十]+)\s*(?:個|件|解)?/]);
            const minValue = getMatch(text, [/(?:最小|下限)(?:は|を|:|：)?\s*([0-9一二三四五六七八九十]+)\s*(?:個|件|解)?/]);
            parsed.maxSolutions = parseJapaneseNumber(maxValue);
            parsed.minSolutions = parseJapaneseNumber(minValue);
        }

        const includeValue = getMatch(text, [
            /(?:含める|必須|入れる)(?:文字)?(?:は|を|:|：)?\s*([ァ-ンーぁ-んA-Za-z,、\s]+)/,
            /([ァ-ンーぁ-んA-Za-z,、\s]+?)\s*(?:を|は)?\s*(?:含める|必須|入れる)/
        ]);
        const excludeValue = getMatch(text, [
            /(?:除外|使わない|抜く|なし)(?:文字)?(?:は|を|:|：)?\s*([ァ-ンーぁ-んA-Za-z,、\s]+)/,
            /([ァ-ンーぁ-んA-Za-z,、\s]+?)\s*(?:を|は)?\s*(?:除外|使わない|抜く|なし)/
        ]);
        parsed.includeChars = toCharList(includeValue);
        parsed.excludeChars = toCharList(excludeValue);

        const patternValue = getMatch(text, [
            /(?:パターン|形)(?:は|を|:|：)?\s*([ァ-ンーぁ-んA-Za-z?？]+)/,
            /([ァ-ンーぁ-んA-Za-z?？]*[?？][ァ-ンーぁ-んA-Za-z?？]*)/
        ]);
        if (patternValue) parsed.pattern = patternValue;

        if (/最短/.test(text)) parsed.wordCountType = 'shortest';
        if (/文字数.*(?:異なる|一意|ばらばら)|異なる文字数/.test(text)) parsed.uniqueWordLengths = true;
        if (/自動.*開始|開始.*自動/.test(text)) parsed.firstCharMode = 'auto';
        if (/自動.*終了|終了.*自動/.test(text)) parsed.lastCharMode = 'auto';
        if (/自動.*単語数|単語数.*自動/.test(text)) parsed.wordCountMode = 'auto';
        if (/自動.*合計|合計.*自動/.test(text)) parsed.totalLengthMode = 'auto';
        parsed.advancedConditions = parseAdvancedConditions(text);

        return parsed;
    };

    const describeNumberRule = (label, rule) => {
        if (!rule) return null;
        const suffix = rule.mode === 'min' ? '以上' : rule.mode === 'max' ? '以下' : '';
        return `${label}: ${rule.value}${suffix}`;
    };

    const lengthPatternLabels = {
        increasing: '単調増加',
        nondecreasing: '広義増加',
        decreasing: '単調減少',
        nonincreasing: '広義減少',
        arithmetic: '等差数列',
        geometric: '等比数列'
    };

    const buildAdvancedSummary = (advanced) => {
        if (!advanced || Object.keys(advanced).length === 0) return [];
        if (advanced.clear) return ['高度条件: 解除'];

        return [
            describeNumberRule('濁音数', advanced.dakutenCount),
            describeNumberRule('半濁音数', advanced.handakutenCount),
            describeNumberRule('小さい文字数', advanced.smallKanaCount),
            describeNumberRule('重複文字あり単語数', advanced.repeatedCharWordCount),
            advanced.hasPrecedingWord === undefined ? null : `前に続けられる単語: ${advanced.hasPrecedingWord ? 'あり' : 'なし'}`,
            advanced.hasSucceedingWord === undefined ? null : `後に続けられる単語: ${advanced.hasSucceedingWord ? 'あり' : 'なし'}`,
            advanced.lengthPattern ? `文字数列: ${lengthPatternLabels[advanced.lengthPattern] || advanced.lengthPattern}` : null
        ].filter(Boolean);
    };

    const buildConditionSummary = (parsed) => {
        const labels = [];
        if (parsed.mode) labels.push(`モード: ${modeSelect.options[modeSelect.selectedIndex]?.text || parsed.mode}`);
        if (parsed.firstChar) labels.push(`開始文字: ${parsed.firstChar}`);
        if (parsed.lastChar) labels.push(`終了文字: ${parsed.lastChar}`);
        if (parsed.wordCount) labels.push(`単語数: ${parsed.wordCount}`);
        if (parsed.wordCountType === 'shortest') labels.push('単語数: 最短');
        if (parsed.wordCountType === 'none') labels.push('単語数: 指定しない');
        if (parsed.totalLength) labels.push(`合計文字数: ${parsed.totalLength}`);
        if (parsed.includeChars?.length) labels.push(`含める文字: ${parsed.includeChars.join(', ')}`);
        if (parsed.excludeChars?.length) labels.push(`除外文字: ${parsed.excludeChars.join(', ')}`);
        if (parsed.minSolutions) labels.push(`最小解数: ${parsed.minSolutions}`);
        if (parsed.maxSolutions) labels.push(`最大解数: ${parsed.maxSolutions}`);
        if (parsed.pattern) labels.push(`パターン: ${parsed.pattern}`);
        if (parsed.uniqueWordLengths) labels.push('文字数一意: ON');
        if (parsed.firstCharMode === 'auto') labels.push('開始文字: 自動');
        if (parsed.lastCharMode === 'auto') labels.push('終了文字: 自動');
        if (parsed.wordCountMode === 'auto') labels.push('単語数: 自動');
        if (parsed.totalLengthMode === 'auto') labels.push('合計文字数: 自動');
        labels.push(...buildAdvancedSummary(parsed.advancedConditions));
        return labels;
    };

    const setAutoCondition = (conditionName, value, mode = 'fixed') => {
        const select = document.querySelector(`.condition-mode-select[data-condition="${conditionName}"]`);
        const input = document.getElementById(`auto${conditionName.charAt(0).toUpperCase()}${conditionName.slice(1)}`);
        if (select) {
            select.value = mode;
            updateAutoConditionRow(select);
        }
        if (input && mode === 'fixed' && value !== undefined && value !== null) {
            input.value = value;
        }
    };

    const applyConditionsToCurrentMode = (parsed) => {
        if (parsed.advancedConditions?.clear) {
            chatAdvancedConditions = {};
            clearAdvancedConditionsFields();
        } else if (parsed.advancedConditions && Object.keys(parsed.advancedConditions).length > 0) {
            chatAdvancedConditions = {
                ...chatAdvancedConditions,
                ...parsed.advancedConditions
            };
            setAdvancedConditionsFields(parsed.advancedConditions);
        }

        if (parsed.mode && modeSections[parsed.mode]) {
            modeSelect.value = parsed.mode;
            updateModeView();
        }

        const currentMode = modeSelect.value;

        if (currentMode === 'autoGenerate') {
            if (parsed.minSolutions) setVal('autoMinSolutions', parsed.minSolutions);
            if (parsed.maxSolutions) setVal('autoMaxSolutions', parsed.maxSolutions);
            if (parsed.firstCharMode === 'auto') setAutoCondition('firstChar', null, 'auto');
            else if (parsed.firstChar) setAutoCondition('firstChar', parsed.firstChar, 'fixed');
            if (parsed.lastCharMode === 'auto') setAutoCondition('lastChar', null, 'auto');
            else if (parsed.lastChar) setAutoCondition('lastChar', parsed.lastChar, 'fixed');
            if (parsed.wordCountMode === 'auto') setAutoCondition('wordCount', null, 'auto');
            else if (parsed.wordCount) setAutoCondition('wordCount', parsed.wordCount, 'fixed');
            if (parsed.totalLengthMode === 'auto') setAutoCondition('totalLength', null, 'auto');
            else if (parsed.totalLength) setAutoCondition('totalLength', parsed.totalLength, 'fixed');
            if (parsed.includeChars?.length) setAutoCondition('includeChars', parsed.includeChars.join(','), 'fixed');
            if (parsed.excludeChars?.length) setAutoCondition('excludeChars', parsed.excludeChars.join(','), 'fixed');
            if (parsed.uniqueWordLengths) setChecked('autoUniqueWordLengths', true);
            return;
        }

        if (currentMode === 'shiritori') {
            if (parsed.firstChar) setVal('firstChar', parsed.firstChar);
            if (parsed.lastChar) setVal('lastChar', parsed.lastChar);
            const container = document.getElementById('wordCountInputContainer');
            if (parsed.wordCountType === 'shortest') {
                setVal('wordCountType', 'shortest');
                if (container) container.style.display = 'none';
            } else if (parsed.wordCountType === 'none') {
                setVal('wordCountType', 'none');
                if (container) container.style.display = 'none';
            } else if (parsed.wordCount) {
                setVal('wordCountType', 'fixed');
                setVal('wordCount', parsed.wordCount);
                if (container) container.style.display = 'block';
            }
            if (parsed.totalLength) setVal('shiritoriTotalLength', parsed.totalLength);
            if (parsed.includeChars?.length) setVal('includeChars', parsed.includeChars.join(','));
            if (parsed.excludeChars?.length) setVal('excludeChars', parsed.excludeChars.join(','));
            if (parsed.uniqueWordLengths) setChecked('uniqueWordLengths', true);
            return;
        }

        if (currentMode === 'chain') {
            if (parsed.pattern) setVal('chainPattern', parsed.pattern);
            if (parsed.includeChars?.length) setVal('chainRequiredChars', parsed.includeChars.join(','));
            if (parsed.excludeChars?.length) setVal('chainExcludeChars', parsed.excludeChars.join(','));
            return;
        }

        if (currentMode === 'loop' && parsed.pattern) {
            setVal('loopPattern', parsed.pattern);
            if (parsed.totalLength) setVal('loopTotalLength', parsed.totalLength);
            return;
        }

        if (currentMode === 'wordCountShiritori' && parsed.totalLength) {
            setVal('wordCountTotalLength', parsed.totalLength);
        }
    };

    const handleConditionChat = () => {
        if (!chatInput) return;
        const text = chatInput.value.trim();
        if (!text) return;

        appendChatMessage(text, 'user');
        const parsed = parseConditionChat(text);

        if (buildConditionSummary(parsed).length === 0) {
            appendChatMessage('読み取れる条件がありませんでした。', 'error');
            return;
        }

        applyConditionsToCurrentMode(parsed);
        const summary = buildConditionSummary(parsed);
        appendChatMessage(`反映しました: ${summary.join(' / ')}`);
        chatInput.value = '';
    };

    if (chatApplyButton) {
        chatApplyButton.addEventListener('click', handleConditionChat);
    }
    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleConditionChat();
            }
        });
    }

    const parseAdvancedConditionRule = (modeId, valueId) => {
        const mode = document.getElementById(modeId)?.value;
        const value = document.getElementById(valueId)?.value;
        const numeric = parseInt(value, 10);
        if (!mode || mode === '' || Number.isNaN(numeric)) {
            return null;
        }
        return { mode, value: numeric };
    };

    const getExplicitAdvancedConditions = () => {
        const advanced = {};
        const dakuten = parseAdvancedConditionRule('dakutenCountMode', 'dakutenCountValue');
        if (dakuten) advanced.dakutenCount = dakuten;

        const handakuten = parseAdvancedConditionRule('handakutenCountMode', 'handakutenCountValue');
        if (handakuten) advanced.handakutenCount = handakuten;

        const smallKana = parseAdvancedConditionRule('smallKanaCountMode', 'smallKanaCountValue');
        if (smallKana) advanced.smallKanaCount = smallKana;

        const repeated = parseAdvancedConditionRule('repeatedCharWordCountMode', 'repeatedCharWordCountValue');
        if (repeated) advanced.repeatedCharWordCount = repeated;

        const preceding = document.getElementById('hasPrecedingWord')?.value;
        if (preceding === 'true') advanced.hasPrecedingWord = true;
        if (preceding === 'false') advanced.hasPrecedingWord = false;

        const succeeding = document.getElementById('hasSucceedingWord')?.value;
        if (succeeding === 'true') advanced.hasSucceedingWord = true;
        if (succeeding === 'false') advanced.hasSucceedingWord = false;

        const pattern = document.getElementById('lengthPattern')?.value;
        if (pattern) advanced.lengthPattern = pattern;

        return advanced;
    };

    const clearAdvancedConditionsFields = () => {
        setVal('dakutenCountMode', '');
        setVal('dakutenCountValue', '');
        setVal('handakutenCountMode', '');
        setVal('handakutenCountValue', '');
        setVal('smallKanaCountMode', '');
        setVal('smallKanaCountValue', '');
        setVal('repeatedCharWordCountMode', '');
        setVal('repeatedCharWordCountValue', '');
        setVal('hasPrecedingWord', '');
        setVal('hasSucceedingWord', '');
        setVal('lengthPattern', '');
    };

    const setAdvancedConditionsFields = (advanced) => {
        if (!advanced) return;
        if (advanced.clear) {
            clearAdvancedConditionsFields();
            return;
        }

        if (advanced.dakutenCount) {
            setVal('dakutenCountMode', advanced.dakutenCount.mode);
            setVal('dakutenCountValue', advanced.dakutenCount.value);
        }
        if (advanced.handakutenCount) {
            setVal('handakutenCountMode', advanced.handakutenCount.mode);
            setVal('handakutenCountValue', advanced.handakutenCount.value);
        }
        if (advanced.smallKanaCount) {
            setVal('smallKanaCountMode', advanced.smallKanaCount.mode);
            setVal('smallKanaCountValue', advanced.smallKanaCount.value);
        }
        if (advanced.repeatedCharWordCount) {
            setVal('repeatedCharWordCountMode', advanced.repeatedCharWordCount.mode);
            setVal('repeatedCharWordCountValue', advanced.repeatedCharWordCount.value);
        }
        if (advanced.hasPrecedingWord !== undefined) {
            setVal('hasPrecedingWord', String(advanced.hasPrecedingWord));
        }
        if (advanced.hasSucceedingWord !== undefined) {
            setVal('hasSucceedingWord', String(advanced.hasSucceedingWord));
        }
        if (advanced.lengthPattern) {
            setVal('lengthPattern', advanced.lengthPattern);
        }
    };

    const getAdvancedConditionsForRequest = () => {
        const explicit = getExplicitAdvancedConditions();
        const explicitKeys = Object.keys(explicit);
        const chatKeys = Object.keys(chatAdvancedConditions || {});

        if (chatKeys.length === 0 && explicitKeys.length === 0) {
            return null;
        }

        if (chatKeys.length === 0) {
            return explicit;
        }

        if (explicitKeys.length === 0) {
            return { ...chatAdvancedConditions };
        }

        return { ...chatAdvancedConditions, ...explicit };
    };

    const handleClearAdvancedConditions = () => {
        chatAdvancedConditions = {};
        clearAdvancedConditionsFields();
    };

    const clearAdvancedButton = document.getElementById('clearAdvancedConditionsBtn');
    if (clearAdvancedButton) {
        clearAdvancedButton.addEventListener('click', handleClearAdvancedConditions);
    }

    // --- 4. 検索実行メインロジック ---
    searchButtons.forEach(button => {
        button.addEventListener('click', async () => {
            resultsDiv.innerHTML = '<p class="loading-message">検索中...</p>';
            const mode = modeSelect.value;
            const commonListName = listNameSelect.value; // 共通リスト名を取得
            
            let apiPath = '';
            let requestBody = {};

            try {
                if (mode === 'shiritori') {
                    apiPath = '/api/shiritori';
                    const includeStr = getVal('includeChars');
                    const totalLengthVal = getVal('shiritoriTotalLength');
                    requestBody = {
                        listName: commonListName,
                        firstChar: getVal('firstChar').trim() || null,
                        lastChar: getVal('lastChar').trim() || null,
                        wordCount: getVal('wordCountType') === 'fixed'
                            ? parseInt(getVal('wordCount'), 10)
                            : getVal('wordCountType') === 'shortest'
                                ? 'shortest'
                                : null,
                        requiredChars: includeStr ? includeStr.split(',').map(c => c.trim()) : null,
                        excludeChars: getVal('excludeChars').trim(),
                        outputType: document.querySelector('input[name="outputType"]:checked')?.value || 'path',
                        requiredCharMode: getChecked('requiredCharExactly') ? 'exactly' : 'atLeast',
                        uniqueWordLengths: getChecked('uniqueWordLengths'),
                        uniquePairOnly: getChecked('uniquePairOnly'),
                        totalLength: totalLengthVal ? parseInt(totalLengthVal, 10) : null,
                        advancedConditions: getAdvancedConditionsForRequest()
                    };
                } else if (mode === 'wildcardShiritori') {
                    apiPath = '/api/wildcard_shiritori';

                    const patterns = Array.from(document.querySelectorAll('.word-pattern-input'))
                        .map(input => input.value.trim())
                        .filter(val => val !== "");

                    const totalLengthVal = getVal('wildcardTotalLength');

                    requestBody = {
                        listName: commonListName,
                        wordPatterns: patterns,
                        requiredChars: null,
                        requiredCharMode: 'atLeast',
                        totalLength: totalLengthVal ? parseInt(totalLengthVal, 10) : null,
                        advancedConditions: getAdvancedConditionsForRequest()
                    };

                } else if (mode === 'wordCountShiritori') {
                    apiPath = '/api/word_count_shiritori';
                    const patterns = Array.from(document.querySelectorAll('.word-count-input'))
                                          .map(input => input.value.trim())
                                          .filter(val => val !== '')
                                          .map(val => val.split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n)));
                    const totalLengthVal = getVal('wordCountTotalLength');
                    requestBody = {
                        listName: commonListName,
                        wordCountPatterns: patterns,
                        allowPermutation: getChecked('allowWordCountPermutation'),
                        uniqueWordLengths: getChecked('uniqueWordLengthsWordCount'),
                        totalLength: totalLengthVal ? parseInt(totalLengthVal, 10) : null,
                        advancedConditions: getAdvancedConditionsForRequest()
                    };

                } else if (mode === 'loop') {
                    apiPath = '/api/loop_shiritori';
                    const totalLengthVal = getVal('loopTotalLength');
                    requestBody = { 
                        listName: commonListName, 
                        pattern: getVal('loopPattern').trim(),
                        totalLength: totalLengthVal ? parseInt(totalLengthVal, 10) : null,
                        advancedConditions: getAdvancedConditionsForRequest()
                    };

                } else if (mode === 'chain') {
                    apiPath = '/api/chain_shiritori';
                    const patternVal = getVal('chainPattern').trim();
                    const requiredStr = getVal('chainRequiredChars');
                    const excludeStr = getVal('chainExcludeChars');

                    if (!patternVal) {
                        resultsDiv.innerHTML = '<p class="error-message">エラー: パターンは必須です。</p>';
                        return;
                    }
                    
                    requestBody = {
                        listName: commonListName,
                        pattern: patternVal,
                        requiredChars: requiredStr ? requiredStr.split(',').map(c => c.trim()) : null,
                        excludeChars: excludeStr ? excludeStr.split(',').map(c => c.trim()) : null,
                        requiredCharMode: getChecked('chainRequiredCharExactly') ? 'exactly' : 'atLeast',
                        advancedConditions: getAdvancedConditionsForRequest()
                    };

                } else if (mode === 'autoGenerate') {
                    apiPath = '/api/auto_generate';
                    
                    // 条件の取得と構築
                    const getConditionMode = (conditionName) => {
                        const select = document.querySelector(`.condition-mode-select[data-condition="${conditionName}"]`);
                        return select ? select.value : 'none';
                    };

                    const getConditionValue = (conditionName) => {
                        const select = document.querySelector(`.condition-mode-select[data-condition="${conditionName}"]`);
                        if (!select || select.value !== 'fixed') {
                            return null;
                        }
                        const input = document.getElementById(`auto${conditionName.charAt(0).toUpperCase()}${conditionName.slice(1)}`);
                        return input ? input.value.trim() || null : null;
                    };

                    const minSolutions = parseInt(getVal('autoMinSolutions'), 10) || 5;
                    const maxSolutions = parseInt(getVal('autoMaxSolutions'), 10) || 20;

                    requestBody = {
                        listName: commonListName,
                        minSolutions: minSolutions,
                        maxSolutions: maxSolutions,
                        
                        firstCharMode: getConditionMode('firstChar'),
                        firstChar: getConditionValue('firstChar'),
                        
                        lastCharMode: getConditionMode('lastChar'),
                        lastChar: getConditionValue('lastChar'),
                        
                        wordCountMode: getConditionMode('wordCount'),
                        wordCount: getConditionValue('wordCount') ? parseInt(getConditionValue('wordCount'), 10) : null,
                        
                        includeCharsMode: getConditionMode('includeChars'),
                        includeChars: getConditionValue('includeChars') ? getConditionValue('includeChars').split(',').map(c => c.trim()).filter(c => c) : null,
                        
                        excludeCharsMode: getConditionMode('excludeChars'),
                        excludeChars: getConditionValue('excludeChars') ? getConditionValue('excludeChars').split(',').map(c => c.trim()).filter(c => c) : null,
                        
                        totalLengthMode: getConditionMode('totalLength'),
                        totalLength: getConditionValue('totalLength') ? parseInt(getConditionValue('totalLength'), 10) : null,
                        
                        uniqueWordLengths: getChecked('autoUniqueWordLengths'),
                        advancedConditions: getAdvancedConditionsForRequest()
                    };

                } else if (mode === 'wildcard') {
                    apiPath = '/api/wildcard_search';
                    requestBody = { listName: commonListName, searchText: getVal('wildcardText').trim() };

                } else if (mode === 'substring') {
                    apiPath = '/api/substring_search';
                    requestBody = { listName: commonListName, searchText: getVal('substringText').trim() };
                }

                // APIリクエスト送信
                if (apiPath) {
                    requestBody = { ...requestBody, ...getPagingRequest() };
                    const response = await fetch(apiPath, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody)
                    });
                    const data = await response.json();
                    displayResults(data, mode);
                }

            } catch (error) {
                console.error("Fetch error:", error);
                resultsDiv.innerHTML = '<p class="error-message">通信に失敗しました。サーバーが起動しているか確認してください。</p>';
            }
        });
    });

    // --- 5. 結果表示ロジック ---
    const getResultSummaryText = (data, count) => {
        if (!data.page || !data.perPage) {
            return `${count} 件の結果を表示します:`;
        }
        const start = count > 0 ? ((data.page - 1) * data.perPage) + 1 : 0;
        const end = ((data.page - 1) * data.perPage) + count;
        return `${start}-${end} 件目 / 全体 ${data.totalCount} 件`;
    };

    const displayResults = (data, mode) => {
        resultsDiv.innerHTML = '';
        if (data.error) {
            resultsDiv.innerHTML = `<p class="error-message">エラー: ${data.error}</p>`;
            return;
        }
        if (prevPageBtn) {
            prevPageBtn.disabled = data.page <= 1;
        }

        if (nextPageBtn) {
            nextPageBtn.disabled = data.page >= data.totalPages;
       }

        // 自動生成モードの結果表示
        if (mode === 'autoGenerate') {
            if (data.warning) {
                const warning = document.createElement('p');
                warning.className = 'error-message';
                warning.textContent = data.warning;
                resultsDiv.appendChild(warning);
            }

            if (data.conditions) {
                const conditionsDiv = document.createElement('div');
                conditionsDiv.style.padding = '15px';
                conditionsDiv.style.backgroundColor = '#e3f2fd';
                conditionsDiv.style.borderRadius = '5px';
                conditionsDiv.style.marginBottom = '20px';
                conditionsDiv.style.border = '1px solid #90caf9';

                const conditionsTitle = document.createElement('p');
                conditionsTitle.style.fontWeight = 'bold';
                conditionsTitle.style.fontSize = '1.1em';
                conditionsTitle.style.marginTop = '0';
                conditionsTitle.textContent = '適用された条件:';
                conditionsDiv.appendChild(conditionsTitle);

                const conditionsList = document.createElement('ul');
                conditionsList.style.margin = '10px 0';
                Object.entries(data.conditions).forEach(([key, value]) => {
                    const li = document.createElement('li');
                    if (key === 'totalLength') {
                        li.textContent = `合計文字数: ${value}`;
                    } else if (key === 'uniqueWordLengths') {
                        li.textContent = `文字数の一意性: ${value}`;
                    } else if (key === 'firstChar') {
                        li.textContent = `開始文字: ${value}`;
                    } else if (key === 'lastChar') {
                        li.textContent = `終了文字: ${value}`;
                    } else if (key === 'wordCount') {
                        li.textContent = `単語数: ${value}`;
                    } else if (key === 'includeChars') {
                        li.textContent = `含める文字: ${value}`;
                    } else if (key === 'excludeChars') {
                        li.textContent = `除外文字: ${value}`;
                    } else {
                        li.textContent = `${key}: ${value}`;
                    }
                    conditionsList.appendChild(li);
                });
                conditionsDiv.appendChild(conditionsList);

                resultsDiv.appendChild(conditionsDiv);
            }

            const results = data.results || [];
            if (results.length === 0) {
                resultsDiv.innerHTML += '<p class="placeholder">条件に合うしりとりは見つかりませんでした。</p>';
                return;
            }

            const summary = document.createElement('p');
            summary.className = 'result-summary';
            summary.textContent = getResultSummaryText(data, results.length);
            resultsDiv.appendChild(summary);

            const ul = document.createElement('ul');
            ul.className = 'result-list';
            results.forEach((item, index) => {
                const li = document.createElement('li');
                li.textContent = Array.isArray(item) ? `${index + 1}. ${item.join(' → ')}` : item;
                ul.appendChild(li);
            });
            resultsDiv.appendChild(ul);
            return;
        }

        // チェーン検索の結果表示
        if (mode === 'chain') {
            const results = data.results || [];
            if (results.length === 0) {
                resultsDiv.innerHTML = '<p class="placeholder">条件に合うしりとりは見つかりませんでした。</p>';
                return;
            }

            const summary = document.createElement('p');
            summary.className = 'result-summary';
            summary.textContent = getResultSummaryText(data, results.length);
            resultsDiv.appendChild(summary);

            const ul = document.createElement('ul');
            ul.className = 'result-list';
            results.forEach((item, index) => {
                const li = document.createElement('li');
                li.textContent = Array.isArray(item) ? `${index + 1}. ${item.join(' → ')}` : item;
                ul.appendChild(li);
            });
            resultsDiv.appendChild(ul);
            return;
        }

        // サーバーからのレスポンス形式を統合
        const results = data.results || [];
        const firstCharCounts = data.firstCharCounts || {};
        const lastCharCounts = data.lastCharCounts || {};

        if (results.length === 0 && Object.keys(firstCharCounts).length === 0 && Object.keys(lastCharCounts).length === 0) {
            resultsDiv.innerHTML = '<p class="placeholder">該当する単語や経路は見つかりませんでした。</p>';
            return;
        }

        // 経路表示モード（すべて表示）
        if (results.length > 0) {
            const summary = document.createElement('p');
            summary.className = 'result-summary';
            summary.textContent = getResultSummaryText(data, results.length);
            resultsDiv.appendChild(summary);

            const ul = document.createElement('ul');
            ul.className = 'result-list';
            results.forEach((item, index) => {
                const li = document.createElement('li');
                li.textContent = Array.isArray(item) ? `${index + 1}. ${item.join(' → ')}` : item;
                ul.appendChild(li);
            });
            resultsDiv.appendChild(ul);
        }

        // 開始文字別集計モード
        if (Object.keys(firstCharCounts).length > 0) {
            const summary = document.createElement('p');
            summary.className = 'result-summary';
            summary.textContent = '開始文字別集計:';
            resultsDiv.appendChild(summary);

            const table = document.createElement('table');
            table.className = 'count-table';
            table.innerHTML = '<tr><th>開始文字</th><th>件数</th></tr>';
            
            Object.entries(firstCharCounts).forEach(([char, count]) => {
                const row = table.insertRow();
                row.innerHTML = `<td>${char}</td><td>${count}</td>`;
            });
            
            resultsDiv.appendChild(table);
        }

        // 終了文字別集計モード
        if (Object.keys(lastCharCounts).length > 0) {
            const summary = document.createElement('p');
            summary.className = 'result-summary';
            summary.textContent = '終了文字別集計:';
            resultsDiv.appendChild(summary);

            const table = document.createElement('table');
            table.className = 'count-table';
            table.innerHTML = '<tr><th>終了文字</th><th>件数</th></tr>';
            
            Object.entries(lastCharCounts).forEach(([char, count]) => {
                const row = table.insertRow();
                row.innerHTML = `<td>${char}</td><td>${count}</td>`;
            });
            
            resultsDiv.appendChild(table);
        }
    };
});
