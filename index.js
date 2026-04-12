 // --- Supabase 接続設定 ---
    const SUPABASE_URL = "https://taxhylofokuplyoulilt.supabase.co";
    const SUPABASE_KEY = "sb_publishable_dHqWc7A5EYWHvqnt7fxkQg_GwscaBXO"; 

    // 接続クライアントの作成
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // データをクラウドに飛ばす関数（運び屋）
    async function sendActionLog(playerNo, type, sub, extra = {}) {
        if (!currentMatchId) return;

        const { error } = await supabaseClient
            .from('game_logs')
            .insert([{
                match_id: currentMatchId,
                set_num: currentSetNum,
                player_no: String(playerNo),
                action_type: type,
                action_sub: sub,
                is_back: extra.isBack || false
            }]);
        
        if (error) console.error("Error saving log:", error);
    }
// --------------------------
    let playerMaster = [], allSetsData = [], currentSetNum = 1, setWinOurs = 0, setWinOpp = 0;
    let currentSetStats = [], courtMembers = [-1,-1,-1,-1,-1,-1,-1];
    let ourScore = 0, oppScore = 0, currentServerIdx = 5, hasServeRight = true, spikeMode = 'normal', isTwoStepMode = false;
    let oppServeMissCount = 0, actionHistory = [];

    const serveOrder = [2, 1, 0, 3, 4, 5], posNames = ["4", "3", "2", "1", "6", "5", "リベロ"];

    // 選手名簿初期化
    const regDiv = document.getElementById('member-registry');
    for(let i=0; i<15; i++) regDiv.innerHTML += `<div><input type="number" class="reg-no" style="width:50px;"><input type="text" class="reg-name" style="width:150px;"></div>`;
    const courtDiv = document.getElementById('court-selection');
    for(let i=0; i<7; i++) courtDiv.innerHTML += `<div><small>${posNames[i]}</small><br><input type="number" class="court-no" style="width:100px;"></div>`;

    function showSetSetup() {
        document.getElementById('screen-game-setup').classList.remove('active');
        document.getElementById('screen-set-setup').classList.add('active');
        document.getElementById('set-setup-title').innerText = `第${currentSetNum}セット 開始準備`;
    }
    
    let currentMatchId = "";

    // 選手名簿をテーブルに保存
    async function saveCurrentPlayers() {
        const playerElements = document.querySelectorAll('.reg-name'); // 名前の入力欄
        const currentPlayers = Array.from(playerElements)
            .map(el => el.value)
            .filter(name => name !== ""); // 空の名前を除外

        const { error } = await supabaseClient // ここを supabaseClient に修正
            .from('match_info')
            .upsert([{ 
                id: currentMatchId, // 小文字に統一
                players: currentPlayers
            }]);

        if (error) console.error("選手名の保存失敗:", error);
    }
    // 見せたい画面を見せる
    function showScreen(screenId) {
        const screens = document.querySelectorAll('.screen');
        screens.forEach(s => s.classList.remove('active'));

        const target = document.getElementById(screenId);
        if (target) {
            target.classList.add('active');
        } else {
            console.error(`Error: ID '${screenId}' が見つかりません。`);
        }
    }
    
    // 効果率など集計
    async function restorePlayerButtons(players) {
        
        const actionButtons = document.querySelectorAll('.player-button'); 

        players.forEach((name, i) => {
            if (actionButtons[i]) {
                actionButtons[i].innerText = name;
            }
        });
    }

    // 試合開始のやつ
    async function initMatch(isNew) {
        const idInput = document.getElementById('match-id-input').value.trim();
        if (!idInput) {
            alert("試合IDを入力してください");
            return;
        }
        currentMatchId = idInput;

        if (isNew) {
            showScreen('screen-set-setup');
        } else {
            // --- 修正ポイント：先に画面を切り替える ---
            showScreen('screen-set-setup'); 

            // 画面が切り替わり、HTML要素が準備できるのを待ってから読み込む
            setTimeout(async () => {
                await loadMatchFromSupabase();
            }, 100); 
        }
    }

    // 復元
    async function loadMatchFromSupabase() {
        // 1. まず match_info テーブルから選手名（players配列）を取得
        const { data: info, error: infoError } = await supabaseClient
            .from('match_info')
            .select('players')
            .eq('id', currentMatchId)
            .single();

        if (infoError) {
            console.warn("選手情報の取得に失敗またはデータなし:", infoError.message);
        }

        // 2. 試合ログを取得
        const { data, error } = await supabaseClient
            .from('game_logs')
            .select('*')
            .eq('match_id', currentMatchId)
            .order('created_at', { ascending: true });

        if (error) {
            alert("読み込みエラー: " + error.message);
            return;
        }

        if (!data || data.length === 0) {
            alert(`試合ID: ${currentMatchId} のデータは見つかりませんでした。`);
            return;
        }

        // 3. 画面表示の切り替え（DOMを先に出現させることで、後のinnerHTML操作でのエラーを防ぐ）
        document.getElementById('screen-start').classList.remove('active');
        document.getElementById('record-area').style.display = 'block';
        document.getElementById('scoreboard').style.display = 'flex';
        showScreen('screen-serve'); 

        // 4. 選手名の復元とボタンへの反映
        if (info && info.players) {
            // 保存されていた選手リストをマスターに反映
            playerMaster = info.players.map((name, index) => ({ no: index + 1, name: name }));
            
            // メイン画面のボタン（.player-button）のテキストを保存された名前に書き換える
            const playerButtons = document.querySelectorAll('.player-button');
            info.players.forEach((name, i) => {
                if (playerButtons[i]) {
                    playerButtons[i].innerText = name;
                }
            });
        } else {
            // 名簿データがない場合のみ、ログから背番号を抽出（予備の処理）
            if (playerMaster.length === 0) {
                const uniqueNos = [...new Set(data.map(log => log.player_no))].filter(n => n && n !== "null");
                playerMaster = uniqueNos.map(no => ({ no: no, name: `No.${no}` }));
            }
        }

        // --- 状態リセット & ログ集計 ---
        currentSetStats = createEmptyStats();
        ourScore = 0; 
        oppScore = 0; 
        oppServeMissCount = 0;

        data.forEach(log => {
            if (log.set_num) currentSetNum = log.set_num;
            const pIdx = playerMaster.findIndex(p => String(p.no) === String(log.player_no));
            const type = log.action_type;
            const sub = log.action_sub;

            if (type === 'opp_serve_miss') {
                oppServeMissCount++; ourScore++; return;
            }
            
            if (pIdx === -1) return;

            if (type === 'serve') {
                currentSetStats[pIdx].serve.total++;
                if (sub === 'ace') { currentSetStats[pIdx].serve.ace++; ourScore++; }
                else if (sub === 'miss') { currentSetStats[pIdx].serve.miss++; oppScore++; }
                else if (sub === 'effect') { currentSetStats[pIdx].serve.effect++; }
            } else if (type === 'receive') {
                currentSetStats[pIdx].receive.total++;
                if (sub === 'A') currentSetStats[pIdx].receive.A++;
                else if (sub === 'B') currentSetStats[pIdx].receive.B++;
                else if (sub === 'C') currentSetStats[pIdx].receive.C++;
                else if (sub === 'fail') { currentSetStats[pIdx].receive.fail++; oppScore++; }
            } else if (type === 'spike') {
                currentSetStats[pIdx].spike.total++;
                if (sub === 'win') { currentSetStats[pIdx].spike.win++; ourScore++; }
                else if (sub === 'fail') { currentSetStats[pIdx].spike.fail++; oppScore++; }
                if (log.is_back) currentSetStats[pIdx].spike.backCount++;
            } else if (type === 'dig') {
                if (sub === 'success') currentSetStats[pIdx].dig.success++;
                else if (sub === 'fail') { currentSetStats[pIdx].dig.fail++; oppScore++; }
            } else if (type === 'block') {
                if (sub === 'win') { currentSetStats[pIdx].block.win++; ourScore++; }
            }
        });

        updateUI();

        // 読み込んだセット用の器を作成
        const statsSection = document.getElementById('stats-section');
        const tableId = `table-timeline-set-${currentSetNum}`;
        statsSection.innerHTML = `<h3>第${currentSetNum}セット (復元)</h3><div id="${tableId}" class="table-wrapper"></div>`;
        
        // DOMの描画完了を待ってから表を表示
        setTimeout(() => {
            renderTable(tableId, currentSetStats, oppServeMissCount);
            alert(`試合ID: ${currentMatchId} の選手名とデータを復元しました。`);
        }, 300);
    }

    // 
    

    function createEmptyStats() {
        return playerMaster.map(p => ({
            no: p.no, name: p.name,
            serve:{total:0, ace:0, effect:0, miss:0},
            receive:{total:0, A:0, B:0, C:0, fail:0},
            spike:{win:0, fail:0, total:0, backCount:0},
            twoStep:{win:0, fail:0, total:0},
            dig:{success:0, fail:0},
            block:{win:0}
        }));
    }

    // ディグ画面を表示し、ボタンを生成する
    // ディグ画面の表示を修正
    function showDigScreen() {
        const grid = document.getElementById('dig-grid');
        grid.innerHTML = "";
        
        courtMembers.forEach((idx, i) => {
            if(idx === -1) return;
            
            // ボタンのHTML
            grid.innerHTML += `
                <button class="char-btn" 
                    id="dig-btn-${i}"
                    onmousedown="startDigTimer(${i})" 
                    onmouseup="clearDigTimer(${i})" 
                    ontouchstart="startDigTimer(${i})" 
                    ontouchend="clearDigTimer(${i})"
                    style="user-select: none;">
                    ${playerMaster[idx].name}
                </button>`;
        });
        showScreen('screen-dig');
    }

    let digTimers = {}; // 各ボタンのタイマーを管理

    function startDigTimer(posIdx) {
        // 念のため既存のタイマーをクリア
        clearDigTimer(posIdx);

        // ボタンの色を少し変えて「長押し中」を視覚的に見せる（任意）
        document.getElementById(`dig-btn-${posIdx}`).style.background = "#ffeb3b";

        digTimers[posIdx] = setTimeout(() => {
            // --- 3秒経過：ミスとして記録 ---
            recordDig(posIdx, 'fail');
            delete digTimers[posIdx];
        }, 3000); // ここで秒数を調整できます（例: 1000なら1秒）
    }

    function clearDigTimer(posIdx) {
        if (digTimers[posIdx]) {
            clearTimeout(digTimers[posIdx]);
            delete digTimers[posIdx];
            
            // 3秒経たずに離した場合：成功として記録
            recordDig(posIdx, 'success');
        }
        // 色を元に戻す
        const btn = document.getElementById(`dig-btn-${posIdx}`);
        if(btn) btn.style.background = "white";
    }

    // 記録とSupabase送信
    async function recordDig(posIdx, type) {
    saveState();
    const playerIdx = courtMembers[posIdx];
    if (playerIdx === undefined) return;

    // 手元のデータを更新
    currentSetStats[playerIdx].dig[type]++;

    // Supabaseへ送信
    await sendActionLog(playerMaster[playerIdx].no, 'dig', type);

    // 画面遷移
    if (type === 'fail') {
        score(false);
        showScreen('screen-catch');
    } else {
        showScreen('screen-spike');
    }

    renderTable(`table-timeline-set-${currentSetNum}`, currentSetStats, oppServeMissCount);
}

    async function startSet(mode) {
        if(allSetsData.length === 0) {
            playerMaster = [];
            document.querySelectorAll('.reg-no').forEach((el, i) => {
                const no = el.value, name = document.querySelectorAll('.reg-name')[i].value || `No.${no}`;
                if(no) playerMaster.push({ no, name });
            });
            await saveCurrentPlayers();
        }
        // 重要：新しいセットが始まるたびにスタッツをゼロリセット
        currentSetStats = createEmptyStats();
        oppServeMissCount = 0;
        actionHistory = [];

        document.querySelectorAll('.court-no').forEach((el, i) => { 
            courtMembers[i] = playerMaster.findIndex(p => p.no == el.value); 
        });

        ourScore = 0; oppScore = 0; hasServeRight = (mode === 'serve'); currentServerIdx = 5;
        document.getElementById('screen-set-setup').classList.remove('active');
        document.getElementById('record-area').style.display = 'block';
        document.getElementById('scoreboard').style.display = 'flex';
        document.getElementById('pdf-btn').style.display = 'block';

        const tlId = `timeline-set-${currentSetNum}`;
        document.getElementById('set-results-container').innerHTML += `
            <div id="container-${tlId}" style="page-break-after: always;">
                <h3 style="margin-top:30px; border-left:5px solid #333; padding-left:10px;">第${currentSetNum}セット</h3>
                <div class="score-timeline">
                    <div class="timeline-row" id="ours-${tlId}"><div class="row-label">自チーム</div></div>
                    <div class="timeline-row" id="opp-${tlId}"><div class="row-label">相手</div></div>
                </div>
                <div id="table-${tlId}" class="table-wrapper"></div>
            </div>`;
        updateUI(); refreshInterface(); renderTable(`table-${tlId}`, currentSetStats, oppServeMissCount);
        showScreen(hasServeRight ? 'screen-serve' : 'screen-catch');
    }

    function finishSet() {
        if(ourScore > oppScore) setWinOurs++; else setWinOpp++;
        allSetsData.push({ 
            setNum: currentSetNum, 
            score: {ours: ourScore, opp: oppScore}, 
            stats: JSON.parse(JSON.stringify(currentSetStats)), 
            oppMiss: oppServeMissCount 
        });

        if(setWinOurs === 3 || setWinOpp === 3 || currentSetNum === 5) {
            finalizeGame();
        } else {
            currentSetNum++;
            document.getElementById('record-area').style.display = 'none';
            showSetSetup();
        }
    }

    function finalizeGame() {
        document.getElementById('record-area').style.display = 'none';
        document.getElementById('scoreboard').style.display = 'none';
        
        const date = document.getElementById('game-date').value, tOurs = document.getElementById('team-ours').value, tOpp = document.getElementById('team-opp').value;
        document.getElementById('game-summary').innerHTML = `<h2>${date} 試合結果</h2><p style="font-size:1.5rem; font-weight:bold;">${tOurs} ${setWinOurs} - ${setWinOpp} ${tOpp}</p>`;

        // 試合総計の算出
        const totalStats = createEmptyStats();
        let totalOppMiss = 0;
        allSetsData.forEach(setData => {
            totalOppMiss += setData.oppMiss;
            setData.stats.forEach((s, i) => {
                ['serve','receive','spike','twoStep','block'].forEach(key => {
                    for(let sub in s[key]) totalStats[i][key][sub] += s[key][sub];
                });
            });
        });

        document.getElementById('total-results-container').innerHTML = `
            <h2 style="margin-top:50px; border-bottom:3px solid #333;">試合総計 (TOTAL)</h2>
            <div id="table-total" class="table-wrapper"></div>`;
        renderTable("table-total", totalStats, totalOppMiss, true);
    }

    function renderTable(containerId, statsData, oppMiss, isTotal = false) {
        let html = `<table><thead>
            <tr><th rowspan="2">名前</th><th colspan="5">サーブ</th><th colspan="5">レシーブ</th><th colspan="6">スパイク</th><th colspan="2">ディグ</th><th>B</th></tr>
            <tr style="font-size:0.5rem;">
                <td>計</td><td>A</td><td>効</td><td>失</td><td>効果率</td>
                <td>A</td><td>B</td><td>C</td><td>失</td><td>成功率</td>
                <td>決</td><td>失</td><td>計</td><td>バック</td><td>2段</td><td>効果率</td><td>成功</td><td>ミス</td><td>得点</td>
            </tr>
            </thead><tbody>`;
        
        statsData.forEach((p, i) => {
            const svEff = p.serve.total ? ((p.serve.ace * 100 + p.serve.effect * 25 - p.serve.miss * 25) / p.serve.total).toFixed(1) : '0.0';
            const rcRate = p.receive.total ? ((p.receive.A * 100 + p.receive.B * 50) / p.receive.total).toFixed(1) : '0.0';
            const spEff = p.spike.total ? (((p.spike.win - p.spike.fail) / p.spike.total) * 100).toFixed(1) : '0.0';

            html += `<tr><td>${p.name}</td>
                ${isTotal ? td(p.serve.total) : c(i,'serve','total')}${isTotal ? td(p.serve.ace) : c(i,'serve','ace')}${isTotal ? td(p.serve.effect) : c(i,'serve','effect')}${isTotal ? td(p.serve.miss) : c(i,'serve','miss')}<td class="calc-cell">${svEff}%</td>
                ${isTotal ? td(p.receive.A) : c(i,'receive','A')}${isTotal ? td(p.receive.B) : c(i,'receive','B')}${isTotal ? td(p.receive.C) : c(i,'receive','C')}${isTotal ? td(p.receive.fail) : c(i,'receive','fail')}<td class="calc-cell">${rcRate}%</td>
                ${isTotal ? td(p.spike.win) : c(i,'spike','win')}${isTotal ? td(p.spike.fail) : c(i,'spike','fail')}${isTotal ? td(p.spike.total) : c(i,'spike','total')}${isTotal ? td(p.spike.backCount) : c(i,'spike','backCount')}${isTotal ? td(p.twoStep.total) : c(i,'twoStep','total')}<td class="calc-cell">${spEff}%</td>
                ${isTotal ? td(p.dig.success) : c(i,'dig','success')}${isTotal ? td(p.dig.fail) : c(i,'dig','fail')}
                ${isTotal ? td(p.block.win) : c(i,'block','win')}</tr>`;
        });
        html += `<tr style="background:#f9f9f9; font-weight:bold;"><td colspan="5">相手サーブミス</td><td class="${isTotal?'':'edit-cell'}" onclick="${isTotal?'':'openOppMissModal()'}">${oppMiss}</td><td colspan="11"></td></tr></tbody></table>`;
        document.getElementById(containerId).innerHTML = html;
    }

    function c(idx, key, sub) { return `<td class="edit-cell" onclick="openModal(${idx},'${key}','${sub}')">${currentSetStats[idx][key][sub]}</td>`; }
    function td(val) { return `<td>${val}</td>`; }

    // --- 以降の全記録・操作ロジックは前のバージョンから完全継承 ---
    function saveState() { actionHistory.push(JSON.stringify({ stats: currentSetStats, courtMembers, ourScore, oppScore, hasServeRight, currentServerIdx, oppServeMissCount })); if(actionHistory.length > 30) actionHistory.shift(); }
    function undo() { if(actionHistory.length === 0) return; const last = JSON.parse(actionHistory.pop()); currentSetStats = last.stats; courtMembers = last.courtMembers; ourScore = last.ourScore; oppScore = last.oppScore; hasServeRight = last.hasServeRight; currentServerIdx = last.currentServerIdx; oppServeMissCount = last.oppServeMissCount; const tlId = `timeline-set-${currentSetNum}`; const ours = document.getElementById(`ours-${tlId}`), opp = document.getElementById(`opp-${tlId}`); if(ours.lastChild && ours.lastChild.className !== "row-label") { ours.removeChild(ours.lastChild); opp.removeChild(opp.lastChild); } updateUI(); refreshInterface(); renderTable(`table-timeline-set-${currentSetNum}`, currentSetStats, oppServeMissCount); }
    function score(ours) { saveState(); if(ours) { ourScore++; if(!hasServeRight) { currentServerIdx = (currentServerIdx + 1) % 6; hasServeRight = true; } } else { oppScore++; hasServeRight = false; } updateUI(); updateTimeline(ours); checkSetEnd(); refreshInterface(); renderTable(`table-timeline-set-${currentSetNum}`, currentSetStats, oppServeMissCount); }
    function updateTimeline(ours) { const tlId = `timeline-set-${currentSetNum}`; const dot = `<div class="point-dot ${ours ? 'dot-ours' : 'dot-opp'}">${ours ? ourScore : oppScore}</div>`; document.getElementById(`ours-${tlId}`).innerHTML += ours ? dot : '<div class="spacer"></div>'; document.getElementById(`opp-${tlId}`).innerHTML += ours ? '<div class="spacer"></div>' : dot; }
    async function recordServe(type) { saveState(); const sIdx = courtMembers[serveOrder[currentServerIdx]];const player = playerMaster[sIdx]; currentSetStats[sIdx].serve.total++;await sendActionLog(player.no, 'serve', type); if(type === 'ace') { currentSetStats[sIdx].serve.ace++; score(true); showScreen('screen-serve'); } else if(type === 'effect') { currentSetStats[sIdx].serve.effect++; showScreen('screen-spike'); } else if(type === 'miss') { currentSetStats[sIdx].serve.miss++; score(false); showScreen('screen-catch'); } else showScreen('screen-spike'); renderTable(`table-timeline-set-${currentSetNum}`, currentSetStats, oppServeMissCount); }
    function recordOppServeMiss() { saveState(); oppServeMissCount++; score(true); showScreen('screen-serve'); renderTable(`table-timeline-set-${currentSetNum}`, currentSetStats, oppServeMissCount); }
    function recordOppAce() { saveState(); oppScore++; updateUI(); updateTimeline(false); checkSetEnd(); refreshInterface(); renderTable(`table-timeline-set-${currentSetNum}`, currentSetStats, oppServeMissCount); }
    async function completeReceive() {
        saveState();
        // Promise.all を使って全員分を並列で送ると効率的です
        const promises = [];

        courtMembers.forEach((idx, i) => {
            const btn = document.getElementById(`cbtn-${i}`);
            if(!btn) return;
            const val = btn.innerText;
            
            // 名前以外の値（A, B, C, 失）になっていれば送信
            if(val !== playerMaster[idx].name) {
                currentSetStats[idx].receive.total++;
                let type = '';
                if(val === 'A') { currentSetStats[idx].receive.A++; type = 'A'; }
                else if(val === 'B') { currentSetStats[idx].receive.B++; type = 'B'; }
                else if(val === 'C') { currentSetStats[idx].receive.C++; type = 'C'; }
                else if(val === '失') { currentSetStats[idx].receive.fail++; type = 'fail'; }
                
                // --- 同期処理を予約 ---
                promises.push(sendActionLog(playerMaster[idx].no, 'receive', type));

                if(type === 'fail') {
                    score(false);
                    showScreen('screen-catch');
                }
            }
        });
        
        await Promise.all(promises); // 全員の送信が終わるまで待機
        showScreen('screen-spike');
        renderTable(`table-timeline-set-${currentSetNum}`, currentSetStats, oppServeMissCount);
    }
    async function hitSpike(pos, isBack) {
        saveState();
        const sIdx = courtMembers[pos];
        const player = playerMaster[sIdx];
        
        currentSetStats[sIdx].spike.total++;
        if(isBack) currentSetStats[sIdx].spike.backCount++;

        let actionSub = spikeMode; // 'win', 'fail', 'normal'
        if(isTwoStepMode) {
            currentSetStats[sIdx].twoStep.total++;
            if(spikeMode === 'win') currentSetStats[sIdx].twoStep.win++;
            else if(spikeMode === 'fail') currentSetStats[sIdx].twoStep.fail++;
            actionSub = `2step-${spikeMode}`; // 2段トスの場合の区別
        }

        // --- 同期処理を追加 ---
        await sendActionLog(player.no, 'spike', actionSub, { isBack: isBack });

        if(spikeMode === 'win') {
            currentSetStats[sIdx].spike.win++;
            score(true);
            showScreen('screen-serve');
        } else if(spikeMode === 'fail') {
            currentSetStats[sIdx].spike.fail++;
            score(false);
            showScreen('screen-catch');
        }
        
        spikeMode = 'normal';
        isTwoStepMode = false;
        updateSpikeModeUI();
        renderTable(`table-timeline-set-${currentSetNum}`, currentSetStats, oppServeMissCount);
    }
    async function hitBlockPoint(pos) {
        saveState();
        const sIdx = courtMembers[pos];
        const player = playerMaster[sIdx];

        currentSetStats[sIdx].block.win++;

        // --- 同期処理を追加 ---
        await sendActionLog(player.no, 'block', 'win');

        score(true);
        showScreen('screen-serve');
    }
    function showSubScreen() { subOutPos = -1; document.getElementById('sub-in-section').style.display = 'none'; const outGrid = document.getElementById('sub-out-grid'); outGrid.innerHTML = ""; courtMembers.forEach((idx, i) => { if(idx !== -1) outGrid.innerHTML += `<button class="char-btn" onclick="selectSubOut(${i})">${posNames[i]}<br>${playerMaster[idx].name}</button>`; }); showScreen('screen-sub'); }
    function selectSubOut(pos) { subOutPos = pos; document.getElementById('sub-in-section').style.display = 'block'; const inGrid = document.getElementById('sub-in-grid'); inGrid.innerHTML = ""; playerMaster.forEach((s, idx) => { if(!courtMembers.includes(idx)) inGrid.innerHTML += `<button class="char-btn" onclick="executeSub(${idx})">No.${s.no}<br>${s.name}</button>`; }); }
    function executeSub(newIdx) { saveState(); courtMembers[subOutPos] = newIdx; refreshInterface(); renderTable(`table-timeline-set-${currentSetNum}`, currentSetStats, oppServeMissCount); showScreen('screen-spike'); }
    function refreshInterface() { const sd = document.getElementById('spike-grid'), cd = document.getElementById('catch-players'), bd = document.getElementById('block-grid'); sd.innerHTML = ""; cd.innerHTML = ""; bd.innerHTML = ""; const fIdxs = [(currentServerIdx + 1) % 6, (currentServerIdx + 2) % 6, (currentServerIdx + 3) % 6]; const fPos = fIdxs.map(idx => serveOrder[idx]); courtMembers.forEach((idx, i) => { if(idx === -1) return; const isBack = (i === 6) || !fPos.includes(i); sd.innerHTML += `<button class="char-btn" onclick="hitSpike(${i}, ${isBack})">${playerMaster[idx].name}${isBack ? '<br><small>(Back)</small>' : ''}</button>`; cd.innerHTML += `<button class="char-btn" id="cbtn-${i}" onclick="toggleRec(${i})">${playerMaster[idx].name}</button>`; if(!isBack) bd.innerHTML += `<button class="char-btn" onclick="hitBlockPoint(${i})">${playerMaster[idx].name}</button>`; }); document.getElementById('serve-title').innerText = `サーバー: ${playerMaster[courtMembers[serveOrder[currentServerIdx]]].name}`; }
    function toggleRec(pos) { const btn = document.getElementById(`cbtn-${pos}`), name = playerMaster[courtMembers[pos]].name; const opts = [name, 'A', 'B', 'C', '失']; btn.innerText = opts[(opts.indexOf(btn.innerText) + 1) % opts.length]; }
    
    function updateUI() { document.getElementById('our-score').innerText = ourScore; document.getElementById('opp-score').innerText = oppScore; document.getElementById('set-counts').innerText = `${setWinOurs} - ${setWinOpp}`; }
    function setSpikeMode(m) { spikeMode = (spikeMode === m) ? 'normal' : m; updateSpikeModeUI(); }
    function toggleTwoStep() { isTwoStepMode = !isTwoStepMode; updateSpikeModeUI(); }
    function updateSpikeModeUI() { document.getElementById('mode-win').style.border = spikeMode === 'win' ? '4px solid black' : ''; document.getElementById('mode-fail').style.border = spikeMode === 'fail' ? '4px solid black' : ''; document.getElementById('mode-two-step').style.border = isTwoStepMode ? '4px solid black' : ''; }
    function checkSetEnd() { const target = (currentSetNum === 5) ? 15 : 25; const isEnd = (ourScore >= target || oppScore >= target) && Math.abs(ourScore - oppScore) >= 2; document.getElementById('next-set-btn').style.display = isEnd ? 'block' : 'none'; }
    function openModal(i,k,s){ editPlayerIdx=i; editKey=k; editSubKey=s; document.getElementById('m-player-name').innerText=playerMaster[i].name; document.getElementById('m-item-name').innerText=`${k}(${s})`; document.getElementById('m-current-val').innerText=currentSetStats[i][k][s]; document.getElementById('edit-modal').style.display='flex'; }
    function openOppMissModal(){ editKey='oppMiss'; document.getElementById('m-player-name').innerText="対戦相手"; document.getElementById('m-item-name').innerText="サーブミス"; document.getElementById('m-current-val').innerText=oppServeMissCount; document.getElementById('edit-modal').style.display='flex'; }
    function adjustVal(v){ if(editKey==='oppMiss') oppServeMissCount=Math.max(0,oppServeMissCount+v); else currentSetStats[editPlayerIdx][editKey][editSubKey]=Math.max(0,currentSetStats[editPlayerIdx][editKey][editSubKey]+v); renderTable(`table-timeline-set-${currentSetNum}`, currentSetStats, oppServeMissCount); document.getElementById('m-current-val').innerText = (editKey==='oppMiss') ? oppServeMissCount : currentSetStats[editPlayerIdx][editKey][editSubKey]; }
    function closeModal(){ document.getElementById('edit-modal').style.display='none'; }

    // Supabaseのリアルタイム更新を監視する


    // 届いた1件のデータを今のスタッツに反映させる
    function applySingleLog(log) {
        const pIdx = playerMaster.findIndex(p => String(p.no) === String(log.player_no));
        if (pIdx === -1) return;

        const type = log.action_type;
        const sub = log.action_sub;

        // スタッツ加算（自分自身の入力も届くので、重複に注意が必要ですが、まずはシンプルに）
        // 実際には、自分の入力以外を反映させる処理が理想的です
        if (type === 'serve') {
            currentSetStats[pIdx].serve.total++;
            if (sub === 'ace') { currentSetStats[pIdx].serve.ace++; ourScore++; }
            if (sub === 'miss') { currentSetStats[pIdx].serve.miss++; oppScore++; }
        }
        // ...他のアクションも同様に記述

        updateUI();
        renderTable(`table-timeline-set-${currentSetNum}`, currentSetStats, oppServeMissCount);
    }
    // スクリプトの冒頭か loadMatchFromSupabase の上あたりに追加
    let isRealtimeSubscribed = false; 

    // リアルタイム同期の二重登録防止
    function enableRealtimeSync() {
        // 試合IDがない、または既に購読済みなら何もしない
        if (!currentMatchID || isRealtimeSubscribed) return;

        // もし古い接続が残っていたら一旦消す（エラー対策）
        supabaseClient.removeChannel(supabaseClient.channel('game_logs_sync'));

        const channel = supabaseClient.channel('game_logs_sync')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'game_logs',
                filter: `match_id=eq.${currentMatchID}`
            }, (payload) => {
                console.log('新規データ受信:', payload.new);
                // データを画面に反映させる関数（もしあれば）をここで呼ぶ
                if (window.applySingleLog) applySingleLog(payload.new);
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    isRealtimeSubscribed = true;
                    console.log('リアルタイム同期が開始されました');
                }
            });
    }
    function importFromPaste() {
        const text = document.getElementById('paste-area').value.trim();
        if (!text) return;
        
        const lines = text.split('\n');
        const regNos = document.querySelectorAll('.reg-no');
        const regNames = document.querySelectorAll('.reg-name');
        
        lines.forEach((line, i) => {
            if (i >= 15) return;
            // 「背番号 名前」の形式を想定（スペース区切り）
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2) {
                regNos[i].value = parts[0];
                regNames[i].value = parts[1];
            } else if (parts.length === 1) {
                regNos[i].value = parts[0];
            }
        });
    }
    async function finalizeSetup() {
        // 画面から現在の選手名を取得
        const playerInputs = document.querySelectorAll('.reg-name'); 
        const playerNames = Array.from(playerInputs)
            .map(input => input.value)
            .filter(v => v !== "");

        // match_infoに保存
        await supabaseClient // supabaseClient に修正
            .from('match_info')
            .upsert([{ id: currentMatchId, players: playerNames }]); // currentMatchId に修正

        // メイン画面のボタンにも即座に反映
        restorePlayerButtons(playerNames);

        showScreen('screen-game-main');
    }
