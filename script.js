// DOM Elements
const timerDisplay = document.getElementById('timer');
const winStreakDisplay = document.getElementById('win-streak');
const loadingScreen = document.getElementById('loading-screen');
const loadingMessage = document.getElementById('loading-message');
const difficultySelectionScreen = document.getElementById('difficulty-selection-screen');
const gameScreen = document.getElementById('game-screen');
const resultScreen = document.getElementById('result-screen');

const easyModeButton = document.getElementById('easy-mode');
const normalModeButton = document.getElementById('normal-mode');
const hardModeButton = document.getElementById('hard-mode');
const playAgainButton = document.getElementById('play-again');

const opponentPokemonSprite = document.getElementById('opponent-pokemon-sprite');
const opponentPokemonName = document.getElementById('opponent-pokemon-name');
const opponentPokemonType = document.getElementById('opponent-pokemon-type');
const playerPokemonList = document.getElementById('player-pokemon-list');
const battleMessage = document.getElementById('battle-message');
const compatibilityHint = document.getElementById('compatibility-hint');
const confirmActionButton = document.getElementById('confirm-action');

const resultTitle = document.getElementById('result-title');
const finalTimeDisplay = document.getElementById('final-time');
const finalWinStreakDisplay = document.getElementById('final-win-streak');
const finalDifficultyDisplay = document.getElementById('final-difficulty'); // ← 追加

// 追加: 相手パーティプレビュー用DOM要素
const opponentPartyPreviewList = document.getElementById('opponent-party-preview-list');

// Game State
let currentDifficulty = '';
let playerHand = [];
let opponentParty = []; // 次以降に戦う相手のリスト
let currentOpponentPokemon = null;
let firstDefeatedOpponentInBattle = null;
let winStreak = 0;
let startTime = 0;
let timerInterval = null;
let gameActive = false;
let waitingForConfirm = false;
let typeDamageRelations = {};
const POKEAPI_BASE_URL = 'https://pokeapi.co/api/v2/';
const STARTER_POKEMON_IDS = [4, 7, 1];
const MAX_POKEMON_ID_TO_FETCH = 151;

let initialHandSize = 0;
let pokemonWasDefeatedInThisBattle = false;


// --- PokeAPI & Data Functions ---

async function fetchJson(url, cacheKey = null) {
    if (cacheKey) {
        try {
            const cachedData = sessionStorage.getItem(cacheKey);
            if (cachedData) {
                return JSON.parse(cachedData);
            }
        } catch (e) {
            console.warn(`sessionStorage.getItem Error for ${cacheKey}:`, e);
        }
    }
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status} for ${url}`);
        const data = await response.json();
        if (cacheKey) {
             try {
                sessionStorage.setItem(cacheKey, JSON.stringify(data));
            } catch (e) {
                console.error(`Failed to setItem in sessionStorage for key ${cacheKey}:`, e);
            }
        }
        return data;
    } catch (error) {
        console.error(`Error fetching JSON for ${url}:`, error);
        throw error;
    }
}

async function fetchPokemonData(idOrName) {
    const minimalCacheKey = `pokemon_min_${idOrName}`;
    try {
        const cachedMinimalData = sessionStorage.getItem(minimalCacheKey);
        if (cachedMinimalData) {
            return JSON.parse(cachedMinimalData);
        }
    } catch (e) {
        console.warn(`sessionStorage.getItem Error for ${minimalCacheKey}:`, e);
    }

    const fullData = await fetchJson(`${POKEAPI_BASE_URL}pokemon/${idOrName}`);
    if (!fullData) return null;

    const minimalData = {
        id: fullData.id,
        name: fullData.name,
        types: fullData.types.map(typeInfo => typeInfo.type.name),
        sprite: fullData.sprites.front_default || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    };

    try {
        sessionStorage.setItem(minimalCacheKey, JSON.stringify(minimalData));
    } catch (e) {
        console.error(`Failed to setItem (minimal) in sessionStorage for key ${minimalCacheKey}:`, e);
    }
    return minimalData;
}


async function initializeTypeChart() {
    loadingMessage.textContent = "タイプ相性データを読み込み中...";
    const typesData = await fetchJson(`${POKEAPI_BASE_URL}type?limit=20`, 'all_types_list');
    if (!typesData || !typesData.results) {
        console.error("Failed to fetch type list.");
        battleMessage.textContent = "タイプリストの取得に失敗しました。";
        return false;
    }

    for (const typeInfo of typesData.results) {
        if (typeDamageRelations[typeInfo.name]) continue;
        const typeDetail = await fetchJson(typeInfo.url, `type_${typeInfo.name}`);
        if (typeDetail) {
            typeDamageRelations[typeInfo.name] = typeDetail.damage_relations;
        } else {
            console.error(`Failed to fetch details for type: ${typeInfo.name}`);
            return false;
        }
    }
    loadingMessage.textContent = "タイプ相性データをロード完了！";
    console.log("Type chart initialized.");
    return true;
}

function getEffectiveness(attackingType, defendingTypes) {
    let totalMultiplier = 1;
    if (!typeDamageRelations[attackingType]) {
        console.warn(`Attacking type ${attackingType} not found in type chart.`);
        return 1;
    }
    const relations = typeDamageRelations[attackingType];
    for (const defendingType of defendingTypes) {
        if (relations.double_damage_to.some(t => t.name === defendingType)) totalMultiplier *= 2;
        else if (relations.half_damage_to.some(t => t.name === defendingType)) totalMultiplier *= 0.5;
        else if (relations.no_damage_to.some(t => t.name === defendingType)) totalMultiplier *= 0;
    }
    return totalMultiplier;
}

// --- Game Logic Functions ---
async function startGame(difficulty) {
    currentDifficulty = difficulty;
    winStreak = 0;
    playerHand = [];
    opponentParty = [];
    currentOpponentPokemon = null; // 追加: startGame時にクリア
    gameActive = true;
    firstDefeatedOpponentInBattle = null;

    updateWinStreakDisplay();
    startTimer();
    resetBattleMessage();

    difficultySelectionScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    loadingScreen.classList.remove('hidden');
    loadingMessage.textContent = "初期ポケモンを準備中...";

    await initializePlayerPokemon();
    if (!gameActive) return; // initializePlayerPokemonで失敗した場合

    loadingScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    
    nextBattleSetup();
}

async function initializePlayerPokemon() {
    playerHand = [];
    for (const id of STARTER_POKEMON_IDS) {
        try {
            const pokemonData = await fetchPokemonData(id);
            if (pokemonData) {
                playerHand.push(pokemonData);
            } else {
                throw new Error(`Pokemon data is null for ID: ${id}`);
            }
        } catch (error) {
            console.error(`Failed to load starter Pokemon ID: ${id}`, error);
            battleMessage.textContent = `初期ポケモン ${id} の読み込みに失敗。リロードしてください。`;
            gameActive = false; // ゲーム続行不可能
            return;
        }
    }
}

async function generateOpponentParty() {
    opponentParty = []; // ここでクリア
    let numberOfOpponents;

    if (winStreak < 1) { // 0連勝時 (最初のバトル)
        numberOfOpponents = 1; // 例: 1体
    } else if (winStreak < 2) { // 1連勝時
        numberOfOpponents = 2; // 例: 2体
    } else if (winStreak < 4) { // 2-3連勝時
        numberOfOpponents = 3; // 例: 3体
    } else { // 4連勝以上
        numberOfOpponents = 6; // 通常の6体
    }
    
    loadingMessage.textContent = `相手 (${numberOfOpponents}体) を探しています...`;
    loadingScreen.classList.remove('hidden');

    let fetchedCount = 0;
    let attemptLimit = numberOfOpponents * 3;
    let currentAttempts = 0;
    const fetchedIds = new Set();

    while (fetchedCount < numberOfOpponents && currentAttempts < attemptLimit) {
        currentAttempts++;
        const randomPokemonId = Math.floor(Math.random() * MAX_POKEMON_ID_TO_FETCH) + 1;

        if (fetchedIds.has(randomPokemonId)) {
            continue;
        }
        fetchedIds.add(randomPokemonId);

        try {
            const pokemonData = await fetchPokemonData(randomPokemonId);
            if (pokemonData) {
                if (!opponentParty.some(p => p.id === pokemonData.id)) {
                    opponentParty.push(pokemonData);
                    fetchedCount++;
                }
            } else {
                console.warn(`データ取得失敗 (null返却): Pokemon ID ${randomPokemonId}`);
            }
        } catch (error) {
            console.error(`相手ポケモン取得エラー: ID ${randomPokemonId}`, error);
            if (currentAttempts < attemptLimit) {
                 await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 200));
            }
        }
    }

    if (fetchedCount < numberOfOpponents) {
        console.warn(`必要な数の相手ポケモンを取得できませんでした。取得数: ${fetchedCount}/${numberOfOpponents}`);
        if (fetchedCount === 0 && numberOfOpponents > 0) {
            battleMessage.textContent = "相手ポケモンの取得に深刻なエラーが発生しました。ネットワーク接続を確認し、ページをリロードしてください。";
            gameActive = false;
            loadingScreen.classList.add('hidden');
            return; // opponentPartyは空のまま
        }
        loadingMessage.textContent = `相手を ${fetchedCount}体 しか準備できませんでした。`;
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    firstDefeatedOpponentInBattle = null;
    loadingScreen.classList.add('hidden');
}


async function nextBattleSetup() {
    if (!gameActive) return; // ゲームがアクティブでない場合は何もしない

    if (winStreak >= 10) {
        endGame(true);
        return;
    }
    initialHandSize = playerHand.length;
    pokemonWasDefeatedInThisBattle = false;
    currentOpponentPokemon = null; // 前の戦闘の相手をクリア

    await generateOpponentParty(); // opponentParty がここで設定される

    if (!gameActive) { // generateOpponentParty内でエラーが発生し、gameActiveがfalseになった場合
        updateOpponentPartyPreview(); // エラーでもプレビューは（空で）更新
        return;
    }
    
    if (opponentParty.length > 0) {
        currentOpponentPokemon = opponentParty.shift(); // 最初の相手を取り出す
    } else {
        // generateOpponentPartyが0体の相手しか生成しなかった場合（またはエラーで空になったがgameActiveのままの場合）
        battleMessage.textContent = "エラー: 戦う相手の準備ができませんでした。";
        gameActive = false;
        updateOpponentPokemonDisplay(); // 表示をクリア
        updateOpponentPartyPreview();   // プレビューを更新（空になる）
        return;
    }

    updateOpponentPokemonDisplay();
    updatePlayerPokemonDisplay();
    updateOpponentPartyPreview();   // opponentPartyはshift()された後の残りメンバー
    
    if(currentOpponentPokemon) {
        setBattleMessage(`新しい相手パーティが現れた！ ${currentOpponentPokemon.name} が登場！`);
    } else if (gameActive) { // currentOpponentPokemonがnullなのにアクティブなのは予期せぬ状態
        setBattleMessage("エラー: 戦う相手を特定できませんでした。");
        gameActive = false;
    }

    if (playerHand.length === 0 && gameActive) { 
        endGame(false);
    }
}

function handlePlayerChoice(pokemonIndex) {
    if (!gameActive || pokemonIndex < 0 || pokemonIndex >= playerHand.length) {
        return;
    }
    if (currentDifficulty !== 'easy' && waitingForConfirm) {
        return;
    }

    const chosenPokemon = playerHand[pokemonIndex];
    let isSuperEffective = false;
    if (currentOpponentPokemon) { // currentOpponentPokemon が null でないことを確認
        for (const atkType of chosenPokemon.types) {
            const eff = getEffectiveness(atkType, currentOpponentPokemon.types);
            if (eff >= 2) {
                isSuperEffective = true;
                break;
            }
        }
    } else {
         console.error("相手ポケモンがいません。戦闘処理をスキップします。");
         return;
    }


    if (currentDifficulty === 'easy') {
        waitingForConfirm = true;
        compatibilityHint.textContent = isSuperEffective ? "相性予測: ○ (効果ばつぐんの可能性大！)" : "相性予測: × (効果はいまひとつかも…)";
        compatibilityHint.classList.remove('hidden');
        confirmActionButton.classList.remove('hidden');
        
        confirmActionButton.onclick = () => {
            if (!waitingForConfirm) return; 
            compatibilityHint.classList.add('hidden');
            confirmActionButton.classList.add('hidden');
            waitingForConfirm = false;
            if (currentOpponentPokemon) processBattle(chosenPokemon, currentOpponentPokemon, isSuperEffective);
        };
    } else {
        if (waitingForConfirm) {
             waitingForConfirm = false;
        }
        if (currentOpponentPokemon) processBattle(chosenPokemon, currentOpponentPokemon, isSuperEffective);
    }
}

function processBattle(playerPoke, opponentPoke, isSuperEffective) {
    if (!opponentPoke) { // opponentPokeがnullやundefinedの場合のガード
        console.error("戦闘処理エラー: 相手ポケモンが存在しません。");
        setBattleMessage("エラー: 相手が見つかりません。");
        return;
    }
    const playerPokemonIndexInHand = playerHand.findIndex(p => p.id === playerPoke.id && p.name === playerPoke.name);

    if (isSuperEffective) {
        setBattleMessage(`${playerPoke.name} のこうげき！ ${opponentPoke.name} に こうかは ばつぐんだ！`);
        appendBattleMessage(`${opponentPoke.name} を倒した！`);

        if (!firstDefeatedOpponentInBattle) {
            firstDefeatedOpponentInBattle = { ...opponentPoke };
        }

        if (opponentParty.length > 0) {
            currentOpponentPokemon = opponentParty.shift();
            updateOpponentPokemonDisplay();
            updateOpponentPartyPreview();
            appendBattleMessage(`次の相手は ${currentOpponentPokemon.name}！`);
        } else {
            currentOpponentPokemon = null;
            updateOpponentPokemonDisplay();
            updateOpponentPartyPreview(); // パーティ全滅後なのでプレビューは空になる
            handlePartyWin();
        }
    } else {
        setBattleMessage(`${playerPoke.name} のこうげき… しかし ${opponentPoke.name} には 効果が薄いようだ...`);
        appendBattleMessage(`${playerPoke.name} は倒された！`);
        
        if (playerPokemonIndexInHand !== -1) {
            playerHand.splice(playerPokemonIndexInHand, 1);
            pokemonWasDefeatedInThisBattle = true;
        }
        updatePlayerPokemonDisplay();

        if (playerHand.length === 0) {
            endGame(false);
        } else {
            appendBattleMessage(`次のポケモンを選んで ${opponentPoke.name} に再度挑戦しよう。`);
        }
    }
}

function handlePartyWin() {
    winStreak++;
    updateWinStreakDisplay();
    setBattleMessage(`相手パーティを全て倒した！ これで ${winStreak}連勝！`);

    let newPokemonJoinedMessage = "";
    if (firstDefeatedOpponentInBattle) {
        if (initialHandSize === 6 && !pokemonWasDefeatedInThisBattle) {
            newPokemonJoinedMessage = "手持ちは一杯で、このバトルで誰も倒れなかったので新しい仲間は加わらなかった。";
        } else if (playerHand.length < 6) {
            playerHand.push({ ...firstDefeatedOpponentInBattle });
            newPokemonJoinedMessage = `最初に倒した ${firstDefeatedOpponentInBattle.name} が仲間になった！ (現在の手持ち ${playerHand.length}体)`;
            updatePlayerPokemonDisplay();
        } else if (playerHand.length >= 6 && pokemonWasDefeatedInThisBattle){ // この条件は実質 initialHandSize < 6 で倒された場合に吸収されるか、起こりにくい
             newPokemonJoinedMessage = "手持ちがいっぱいのため、新しい仲間は加わらなかった。";
        }
    }
    if (newPokemonJoinedMessage) appendBattleMessage(newPokemonJoinedMessage);

    if (winStreak >= 10) {
        endGame(true);
    } else {
        const delay = newPokemonJoinedMessage && newPokemonJoinedMessage.includes("仲間になった！") ? 3500 : 2000;
        setTimeout(() => {
            if (gameActive) nextBattleSetup();
        }, delay);
    }
}

function escapeBattle() {
    if (!gameActive) return;
    setBattleMessage("バトルから逃げ出した！ 連勝記録はリセットされます。");
    winStreak = 0;
    updateWinStreakDisplay();
    
    gameActive = false;
    // currentOpponentPokemon = null; // 次のバトルで設定されるので不要かも
    // opponentParty = []; // 次のバトルで設定されるので不要かも

    setTimeout(() => {
        if (document.getElementById('game-screen').classList.contains('hidden')) {
            return;
        }
        gameActive = true;
        nextBattleSetup();
    }, 2500);
}

function endGame(isVictory) {
    if (!gameActive && !isVictory && resultScreen.classList.contains('hidden') === false) {
         // 既に結果画面が表示されている場合、二重にendGameが呼ばれるのを防ぐ
        if (finalWinStreakDisplay.textContent.includes(winStreak.toString())) return;
    }
    gameActive = false;
    stopTimer();
    gameScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');

    if (isVictory) {
        resultTitle.textContent = "🏆 10連勝達成！おめでとう！ 🏆";
    } else {
        resultTitle.textContent = "ゲームオーバー...";
    }
    finalTimeDisplay.textContent = `最終タイム: ${timerDisplay.textContent}`;
    finalWinStreakDisplay.textContent = `最終連勝数: ${winStreak}`;

    let difficultyJapanese = '';
    switch (currentDifficulty) {
        case 'easy':
            difficultyJapanese = 'やさしい';
            break;
        case 'normal':
            difficultyJapanese = 'ふつう';
            break;
        case 'hard':
            difficultyJapanese = 'むずかしい';
            break;
        default:
            difficultyJapanese = '不明';
    }
    if (finalDifficultyDisplay) { // 要素が存在することを確認
        finalDifficultyDisplay.textContent = `プレイ難易度: ${difficultyJapanese}`;
    }
}


// --- UI Update Functions ---
function formatType(type) {
    let displayName = type;
    // 必要ならここで短縮名への変換ロジック
    // const shortNames = { /* ... */ };
    // displayName = shortNames[type.toLowerCase()] || type.substring(0, 3).toUpperCase();
    return `<span class="type-tag type-${type.toLowerCase()}">${displayName}</span>`;
}

function updateOpponentPokemonDisplay() {
    if (currentOpponentPokemon) {
        opponentPokemonSprite.src = currentOpponentPokemon.sprite;
        opponentPokemonSprite.alt = currentOpponentPokemon.name;
        opponentPokemonName.textContent = currentOpponentPokemon.name;
        if (currentDifficulty === 'hard') {
            opponentPokemonType.innerHTML = "タイプ: ???";
        } else {
            opponentPokemonType.innerHTML = `タイプ: ${currentOpponentPokemon.types.map(type => formatType(type)).join(' ')}`;
        }
    } else {
        opponentPokemonSprite.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
        opponentPokemonSprite.alt = "相手なし";
        opponentPokemonName.textContent = "-";
        opponentPokemonType.innerHTML = "タイプ: -";
    }
}

function updatePlayerPokemonDisplay() {
    playerPokemonList.innerHTML = ""; 
    playerHand.forEach((pokemon, index) => {
        const card = document.createElement('div');
        card.classList.add('pokemon-card');
        
        let typeInfoHtml = '';
        if (currentDifficulty !== 'hard') {
            typeInfoHtml = `<p class="pokemon-types">${pokemon.types.map(type => formatType(type)).join(' ')}</p>`;
        }

        card.innerHTML = `
            <img src="${pokemon.sprite}" alt="${pokemon.name}">
            <p class="pokemon-name">${index + 1}. ${pokemon.name}</p>
            ${typeInfoHtml}
        `;
        card.onclick = () => handlePlayerChoice(index);
        playerPokemonList.appendChild(card);
    });
}

// 新しい関数: 相手パーティのプレビューを更新
function updateOpponentPartyPreview() {
    if (!opponentPartyPreviewList) return;
    opponentPartyPreviewList.innerHTML = "";

    const previewTargets = opponentParty; // opponentParty は次に戦う相手 "以降" のポケモンの配列

    if (previewTargets.length === 0) {
        const p = document.createElement('p');
        p.style.fontSize = "0.9em"; // 少し小さめに
        p.style.color = "#777";
        p.textContent = "なし";
        opponentPartyPreviewList.appendChild(p);
        return;
    }

    previewTargets.forEach(pokemon => {
        const previewDiv = document.createElement('div');
        previewDiv.classList.add('opponent-preview-pokemon');
        previewDiv.title = currentDifficulty !== 'hard' ? pokemon.name : "？？？";

        if (currentDifficulty === 'hard') {
            previewDiv.classList.add('silhouette');
            // CSSの::beforeで「？」を表示
        } else {
            const img = document.createElement('img');
            img.src = pokemon.sprite;
            img.alt = pokemon.name.substring(0,3);
            previewDiv.appendChild(img);

            const typeContainer = document.createElement('div');
            typeContainer.classList.add('type-preview');
            pokemon.types.forEach(type => {
                typeContainer.innerHTML += formatType(type); // formatTypeはHTML文字列を返す
            });
            previewDiv.appendChild(typeContainer);
        }
        opponentPartyPreviewList.appendChild(previewDiv);
    });
}


function setBattleMessage(message) {
    battleMessage.innerHTML = message;
}
function appendBattleMessage(message) {
    battleMessage.innerHTML += `<br>${message}`;
}

function resetBattleMessage() {
    setBattleMessage("バトル開始！ ポケモンを選んでください。");
    compatibilityHint.classList.add('hidden');
    confirmActionButton.classList.add('hidden');
}

function updateWinStreakDisplay() {
    winStreakDisplay.textContent = winStreak;
}

// Timer Functions
function startTimer() {
    startTime = Date.now();
    timerDisplay.textContent = "00:00";
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (!gameActive && resultScreen.classList.contains('hidden')) {
            // ゲーム中でなく、結果画面もまだの場合はタイマーを進めない (主に初期化直後やエラー時など)
            // ただし、Escapeによる中断時はタイマーは継続する仕様。
            // この条件だとEscape時も止まってしまう可能性がある。
            // タイマーを止めるのは明確にendGameが呼ばれた時と、playAgainの時。
            // gameActiveがfalseでもタイマーが動くべきケース(escape)があるので、この制御は難しい。
            // 一旦、endGameとplayAgainでstopTimerを呼ぶので、ここでは単純に進める。
        }
         if (document.hidden) return; // タブが非アクティブなら更新しない (ブラウザによるが)

        const elapsedTime = Math.floor((Date.now() - startTime) / 1000);
        const minutes = Math.floor(elapsedTime / 60).toString().padStart(2, '0');
        const seconds = (elapsedTime % 60).toString().padStart(2, '0');
        timerDisplay.textContent = `${minutes}:${seconds}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null; // 解放
}

// --- Event Listeners ---
easyModeButton.addEventListener('click', () => startGame('easy'));
normalModeButton.addEventListener('click', () => startGame('normal'));
hardModeButton.addEventListener('click', () => startGame('hard'));

playAgainButton.addEventListener('click', () => {
    gameActive = false; 
    stopTimer(); 
    winStreak = 0; 
    updateWinStreakDisplay();
    timerDisplay.textContent = "00:00"; 

    playerHand = []; 
    opponentParty = []; 
    currentOpponentPokemon = null; 

    if(opponentPartyPreviewList) opponentPartyPreviewList.innerHTML = "";
    updatePlayerPokemonDisplay(); 
    updateOpponentPokemonDisplay(); 

    resultScreen.classList.add('hidden');
    gameScreen.classList.add('hidden'); 
    difficultySelectionScreen.classList.remove('hidden');
    loadingScreen.classList.add('hidden'); // ローディングも隠す
    resetBattleMessage();
});

document.addEventListener('keydown', (event) => {
    if (gameScreen.classList.contains('hidden') || !gameActive) {
        if (event.key === 'Enter' && !resultScreen.classList.contains('hidden') && playAgainButton) {
             playAgainButton.click(); // 結果画面でEnterなら「もう一度遊ぶ」
        }
        return;
    }

    if (event.key >= '1' && event.key <= '6') {
        if (playerHand.length >= parseInt(event.key)) { // 手持ちの数以内かチェック
            handlePlayerChoice(parseInt(event.key) - 1);
        }
    } else if (event.key === 'Escape') {
        escapeBattle();
    } else if (event.key === 'Enter') {
        if (currentDifficulty === 'easy' && waitingForConfirm && !confirmActionButton.classList.contains('hidden')) {
            confirmActionButton.click();
        }
    }
});


// --- Initialization ---
async function initializeApp() {
    difficultySelectionScreen.classList.add('hidden');
    gameScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    loadingScreen.classList.remove('hidden');
    loadingMessage.textContent = "ゲームを初期化中...";

    const typeChartReady = await initializeTypeChart();
    if (!typeChartReady) {
        loadingMessage.textContent = "タイプデータの読み込みに失敗しました。リフレッシュしてください。";
        // ボタンなどを無効化する処理も検討
        return;
    }

    loadingScreen.classList.add('hidden');
    difficultySelectionScreen.classList.remove('hidden');
}

// Start the application
initializeApp();