import {createGame, parseMoney, money, placeBid, maxBid, outcome, purchase, nextRound, skipCharacter, rpsWinner, isComplete, restoreGame} from "./game.js";
import {POWER_STATS, powerScore, preparePowerData, teamPower, compareTeamPower} from "./power.js?v=1";

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
const symbols = {
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  diagonal: '<path d="M5 19 19 5M5 5h14v14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3a4 4 0 0 1 0 8"/><circle cx="9" cy="7" r="4"/>',
  shuffle: '<path d="m17 3 4 4-4 4m0 2 4 4-4 4M3 7h3c4 0 8 10 12 10h3M3 17h3c1.5 0 3-1.5 4.5-3.5M14 9.5C15.5 8 17 7 18 7h3"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M15 8H10a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H9m3-10v12"/>',
  trophy: '<path d="M8 3h8v7a4 4 0 0 1-8 0zm8 2h4v3a4 4 0 0 1-4 4M8 5H4v3a4 4 0 0 0 4 4m4 2v6m-4 1h8"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7z"/>',
  sound: '<path d="m11 5-6 4H2v6h3l6 4zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="m11 5-6 4H2v6h3l6 4zm5 4 5 6m0-6-5 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  back: '<path d="M20 12H5m6-6-6 6 6 6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'
};
const icon = (name, cls = "") => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbols[name] || symbols.arrow}</svg>`;
const logo = `<span class="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="m6 7 8 2 12 16-8-2zm20 0-8 2L6 25l8-2z" fill="currentColor"/></svg></span><span>DRAFT<span class="brand-light">ARENA</span><span class="brand-dot">®</span></span>`;
const KEY = "draft-arena-game-v1";
let topics = [];
let powerData = null;
let selected = "demon";
let filter = "all";
let screen = "setup";
let game = null;
let form = {names: ["Игрок 1", "Игрок 2"], budget: "100", size: 5};
let sound = false;
let storageAvailable = true;
let modal = null;
let returnFocus = null;
let rps = {choices: [], revealed: false};
let toastTimer;
let audioContext;

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 4200);
}
function beep(success = false) {
  if (!sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.frequency.setValueAtTime(success ? 660 : 440, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(success ? 990 : 550, audioContext.currentTime + .12);
    gain.gain.setValueAtTime(.06, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .18);
    oscillator.start(); oscillator.stop(audioContext.currentTime + .2);
  } catch { /* Sound is optional on devices that prohibit audio. */ }
}
function persist() {
  try {
    if (game) localStorage.setItem(KEY, JSON.stringify(game));
    else localStorage.removeItem(KEY);
  } catch {
    if (storageAvailable) toast("Браузер не разрешает сохранение. Игра продолжится, пока открыта страница.");
    storageAvailable = false;
  }
}
const currentTopic = () => topics.find(t => t.id === (screen === "setup" ? selected : game.topicId));
const character = (id) => topics.flatMap(t => t.characters).find(c => c.id === id);
const ratingFor = (id) => powerData?.characters[id];
const scoreFor = (id) => powerScore(ratingFor(id));
function powerBadge(id) {
  const score = scoreFor(id);
  return `<span class="power-badge" aria-label="${score === null ? "Оценка силы недоступна" : `Игровая сила ${score} из 100`}">${icon("bolt")} ${score ?? "—"}<small>/100</small></span>`;
}
async function loadPowerData() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("./power.json?v=1", {signal: controller.signal});
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
  finally { clearTimeout(timeout); }
}

function header() {
  return `<header class="header"><div class="header-inner">
    <button class="brand" data-action="home" aria-label="Draft Arena — главное меню">${logo}</button>
    <nav aria-label="Основная навигация">
      <button class="${screen === "setup" ? "nav-active" : ""}" data-action="home">Создать игру</button>
      <button data-action="catalog">Персонажи <span class="nav-count">144</span></button>
      <button data-action="rules">Как играть ${icon("diagonal")}</button>
    </nav>
    <div class="header-right"><span class="local-status"><i></i> ЛОКАЛЬНАЯ ИГРА</span><button class="icon-button" data-action="sound" aria-label="${sound ? "Выключить" : "Включить"} звук" aria-pressed="${sound}">${icon(sound ? "sound" : "mute")}</button></div>
  </div></header>`;
}
function footer() {
  return `<footer class="footer"><span>© 2026 DRAFT ARENA <b>•</b> СОБЕРИ СВОИХ ЛЕГЕНД</span><span>2 игрока <b>/</b> 6 вселенных <b>/</b> бесконечно много тактик</span><button data-action="credits">Фан-проект ${icon("diagonal")}</button></footer>`;
}
function topicCard(topic) {
  const active = selected === topic.id;
  return `<button class="topic-card ${active ? "selected" : ""}" data-action="select-topic" data-id="${topic.id}" aria-pressed="${active}" aria-label="${esc(topic.title)}, 24 персонажа">
    <img src="${topic.cover}" alt="" style="--topic-color:${topic.color}" />
    <span class="card-shade"></span><span class="topic-type">${topic.type}</span>
    <span class="selection-dot">${active ? icon("check") : ""}</span>
    <span class="topic-text"><span class="topic-english">${topic.english}</span><strong>${topic.title}</strong><span class="topic-meta"><span>24 персонажа</span><span>${active ? "ВЫБРАНО" : "ВЫБРАТЬ"} ${icon("arrow")}</span></span></span>
  </button>`;
}
function setup() {
  const topic = currentTopic();
  return `<main class="main setup-main">
    <section class="hero"><div><div class="eyebrow"><span class="tiny-star">✦</span> АУКЦИОН ПЕРСОНАЖЕЙ</div><h1>Твоя команда.<br>Твои <span>легенды.</span></h1><p>За каждого героя стоит побороться.<br class="mobile-only"> Кого заберёшь ты?</p></div>
    <div class="hero-art" aria-hidden="true"><div class="hero-glow"></div><div class="hero-portraits">${topic.characters.slice(0,3).map((c,i) => `<div class="hero-portrait portrait-${i}"><img src="${c.image}" alt="" /><span>${esc(c.name)}</span></div>`).join("")}</div><div class="hero-chip"><span>✦</span> Твоя история начинается здесь</div></div></section>
    ${game && game.phase !== "finished" ? `<div class="resume-banner"><span>${icon("trophy")} У тебя есть незавершённая партия: ${esc(topics.find(t => t.id === game.topicId).title)}</span><button data-action="resume">Продолжить ${icon("arrow")}</button></div>` : ""}
    <div class="setup-layout"><section class="topics-section">
      <div class="section-head"><h2><span>01</span> Выбери вселенную</h2><div class="filters" aria-label="Фильтр тем">${[["all","Все"],["Аниме","Аниме"],["Сериал","Сериалы"]].map(([id,label]) => `<button data-action="filter" data-id="${id}" aria-pressed="${filter === id}" class="${filter === id ? "active" : ""}">${label}</button>`).join("")}</div></div>
      <div class="topics-grid">${topics.filter(t => filter === "all" || t.type === filter).map(topicCard).join("")}</div>
      <div class="quick-rules"><div>${icon("shuffle")}<span><strong>Случайный герой</strong><small>Каждый раунд — сюрприз</small></span></div><div>${icon("coin")}<span><strong>Твоя ставка</strong><small>Решай, сколько он стоит</small></span></div><div>${icon("trophy")}<span><strong>Сила команды</strong><small>Сравним в финале</small></span></div></div>
    </section>
    <aside class="settings"><div class="settings-title"><h2><span>02</span> Настрой игру</h2>${icon("users")}</div>
      <form id="setup-form" novalidate>
        <label class="field-label">ИГРОКИ <span>Лицом к лицу</span></label>
        <div class="player-names">${form.names.map((name,i) => `<label class="name-field p${i}"><span>P${i+1}</span><input name="name${i}" aria-label="Имя игрока ${i+1}" maxlength="24" value="${esc(name)}" placeholder="Игрок ${i+1}" autocomplete="off" enterkeyhint="next" /></label>`).join("")}</div>
        <label class="field-label" for="budget">БЮДЖЕТ НА ИГРОКА <span>Одинаковый для обоих</span></label>
        <div class="number-control"><button type="button" data-action="budget-step" data-value="-10" aria-label="Уменьшить бюджет">−</button><div><input id="budget" name="budget" inputmode="decimal" enterkeyhint="done" value="${esc(form.budget)}" aria-describedby="budget-note" /><span>$</span></div><button type="button" data-action="budget-step" data-value="10" aria-label="Увеличить бюджет">+</button></div>
        <div class="field-note" id="budget-note">Игровые доллары. Минимальная ставка — 0,01 $.</div>
        <button type="button" class="power-explainer" data-action="power-rules">${icon("bolt")} В финале — сравнение силы команд ${icon("info")}</button>
        <label class="field-label team-label" for="team-size">ПЕРСОНАЖЕЙ В КОМАНДЕ <span>От 1 до 12</span></label>
        <div class="size-options">${[3,5,7,10].map(n => `<button type="button" data-action="size" data-value="${n}" class="${form.size === n ? "active" : ""}" aria-pressed="${form.size === n}">${n}</button>`).join("")}<input id="team-size" name="size" type="number" inputmode="numeric" enterkeyhint="done" min="1" max="12" step="1" value="${form.size}" aria-label="Свой размер команды" /></div>
        <div class="selected-summary"><span class="summary-icon">${icon("grid")}</span><div><strong>${topic.title}</strong><span><b id="total-slots">${form.size * 2}</b> из 24 героев попадут в команды</span></div></div>
        <button class="primary start-button" type="submit">Начать аукцион ${icon("arrow")}</button>
        <div class="settings-foot">${icon("users")} Два игрока на одном устройстве</div>
      </form>
    </aside></div>
  </main>`;
}

function teamSlots(p, compact = false) {
  return `<div class="team-slots ${compact ? "compact" : ""}">${Array.from({length: game.size}, (_,i) => {
    const sale = p.team[i];
    if (!sale) return `<div class="empty-slot"><span>+</span><small>Место ${String(i+1).padStart(2,"0")}</small></div>`;
    const c = character(sale.id);
    return `<button class="team-slot" data-action="character" data-id="${c.id}" aria-label="${esc(c.name)}, сила ${scoreFor(c.id) ?? "неизвестна"}, куплен за ${money(sale.price)}"><img src="${c.image}" alt="${esc(c.name)}" /><b class="slot-power">${icon("bolt")} ${scoreFor(c.id) ?? "—"}</b><span>${esc(c.name)}<small>${money(sale.price)}</small></span></button>`;
  }).join("")}</div>`;
}
function playerPanel(p, i) {
  const full = p.team.length === game.size;
  const active = !full && game.phase === "auction";
  const leading = game.bids[i] > game.bids[1-i] && game.phase === "auction";
  const equal = game.bids[i] && game.bids[i] === game.bids[1-i] && game.phase === "auction";
  const suggested = Math.min(maxBid(game,i), Math.max(...game.bids) + 1);
  return `<section class="player-panel p${i} ${leading ? "leading" : ""}"><div class="player-heading"><span class="player-avatar">P${i+1}</span><div><small>ИГРОК ${i+1}</small><h2>${esc(p.name)}</h2></div><span class="player-state">${full ? icon("check") : leading ? "ЛИДИРУЕТ" : equal ? "РАВНО" : ""}</span></div>
    <div class="balance"><span>Остаток бюджета</span><strong>${money(p.balance)}</strong><div class="budget-track"><span style="width:${p.balance / game.budget * 100}%"></span></div></div>
    <div class="bid-status"><span>Текущая ставка</span><strong>${game.bids[i] ? money(game.bids[i]) : "—"}</strong></div>
    <form class="bid-form" data-player="${i}" novalidate><label for="bid-${i}" class="sr-only">Ставка игрока ${i+1} в долларах</label><div class="bid-input-wrap"><input id="bid-${i}" inputmode="decimal" enterkeyhint="done" autocomplete="off" value="${(suggested / 100).toFixed(2)}" ${!active ? "disabled" : ""} /><span>$</span></div>
    <div class="bid-quick">${[1,100,500].map(amount => `<button type="button" data-action="bid-add" data-player="${i}" data-value="${amount}" ${!active ? "disabled" : ""}>+${amount === 1 ? "0,01" : amount/100} $</button>`).join("")}<button type="button" data-action="bid-max" data-player="${i}" ${!active ? "disabled" : ""}>Макс.</button></div>
    <button class="bid-button" type="submit" ${!active ? "disabled" : ""}>${full ? "Команда собрана" : "Сделать ставку"} ${icon(full ? "check" : "arrow")}</button></form>
    <div class="team-head"><h3>Твоя команда</h3><span>${p.team.length} <b>/ ${game.size}</b></span></div><div class="team-power-caption">${icon("bolt")} Сила команды <strong>${teamPower(p.team, powerData?.characters).total ?? "—"}</strong></div>${teamSlots(p)}
  </section>`;
}
function auction() {
  const topic = currentTopic();
  const c = character(game.current);
  const sold = game.phase === "sold";
  const total = game.players.reduce((sum,p) => sum+p.team.length, 0);
  return `<main class="main game-main"><div class="game-top"><button class="text-button" data-action="home">${icon("back")} В меню</button><span class="game-universe">${topic.title}</span><span class="game-round"><i></i> ЛОТ ${String(game.round).padStart(2,"0")}</span></div>
    <div class="game-title"><div class="eyebrow">АРЕНА ОТКРЫТА</div><h1>За кого <span>поборемся?</span></h1><p>У каждого героя своя цена. Последнее слово — за вами.</p></div>
    <div class="auction-layout">${playerPanel(game.players[0],0)}
      <section class="lot-center"><div class="character-card ${sold ? "is-sold" : ""}"><img src="${c.image}" alt="${esc(c.name)}" /><div class="character-shade"></div><span class="lot-badge">${sold ? "В КОМАНДЕ" : "НА АУКЦИОНЕ"} <i></i></span><button class="character-info icon-button" data-action="character" data-id="${c.id}" aria-label="Подробнее о персонаже">${icon("info")}</button><div class="lot-character-name"><span>${topic.english}</span><h2>${esc(c.name)}</h2><p>${esc(c.originalName)}</p></div>${sold ? `<div class="sold-ribbon">${icon("check")} КУПЛЕНО</div>` : ""}</div>
      <button class="lot-power" data-action="character" data-id="${c.id}">${powerBadge(c.id)}<span>Сила героя <small>Оценка Draft Arena</small></span>${icon("info")}</button>
      <div class="lot-price"><span>${sold ? `Забирает ${esc(game.players[game.lastSale.player].name)}` : "Лучшая ставка"}</span><strong>${money(sold ? game.lastSale.price : Math.max(...game.bids))}</strong></div>
      ${sold ? `<button class="primary buy-button" data-action="next">${isComplete(game) ? "Посмотреть команды" : "Следующий персонаж"} ${icon("arrow")}</button>` : `<button class="primary buy-button" data-action="buy" ${game.bids.some(Boolean) ? "" : "disabled"}>Купить персонажа ${icon("check")}</button><button class="skip-button" data-action="skip" ${game.bids.some(Boolean) || !game.deck.length ? "disabled" : ""}>${icon("shuffle")} Другой персонаж</button>`}
      <p class="lot-hint">${sold ? "Герой занял своё место. Продолжим?" : game.bids[0] && game.bids[0] === game.bids[1] ? "Ставки равны — покупку решит суефа" : "Равная ставка? Решите спор в суефа."}</p></section>
      ${playerPanel(game.players[1],1)}</div>
    <div class="match-progress"><span>СОБИРАЕМ КОМАНДЫ</span><div><span style="width:${total/(game.size*2)*100}%"></span></div><strong>${total} / ${game.size*2}</strong><small>${storageAvailable ? "Прогресс сохраняется автоматически" : "Сохранение недоступно"}</small></div>
    <div class="auction-dock" aria-label="Покупка персонажа"><div><span>${sold ? "Куплено за" : "Лучшая ставка"}</span><strong>${money(sold ? game.lastSale.price : Math.max(...game.bids))}</strong></div><button class="primary" data-action="${sold ? "next" : "buy"}" ${!sold && !game.bids.some(Boolean) ? "disabled" : ""}>${sold ? (isComplete(game) ? "Команды" : "Следующий") : "Купить"} ${icon(sold ? "arrow" : "check")}</button></div>
  </main>`;
}
function results() {
  const word = game.size === 1 ? "персонаж" : game.size < 5 ? "персонажа" : "персонажей";
  const comparison = compareTeamPower(game.players, powerData?.characters, game.size);
  const {winner, difference} = comparison;
  const title = winner === null ? "Составы готовы" : winner === "tie" ? "Равная сила!" : `${esc(game.players[winner].name)} — сильнее по баллам`;
  return `<main class="main results-main"><div class="result-icon">${icon("trophy")}</div><div class="eyebrow">АУКЦИОН ЗАВЕРШЁН</div><h1>Легенды <span>в сборе.</span></h1><p>${esc(currentTopic().title)} · В каждой команде: ${game.size} ${word}</p>
    <section class="power-verdict ${Number.isInteger(winner) ? `p${winner}` : ""}" aria-labelledby="verdict-title"><span class="eyebrow">СРАВНЕНИЕ СИЛЫ</span><h2 id="verdict-title">${title}</h2><p>${winner === null ? "Не все оценки загрузились. Команды сохранены — можно повторить загрузку." : winner === "tie" ? "Суммы совпали. Победа по силе достаётся обоим игрокам." : `Преимущество: ${difference} балл${difference % 10 === 1 && difference % 100 !== 11 ? "" : difference % 10 >= 2 && difference % 10 <= 4 && !(difference % 100 >= 12 && difference % 100 <= 14) ? "а" : "ов"}. Каждый герой добавил свои очки в общий счёт.`}</p>
    <div class="scoreboard">${game.players.map((p,i) => `<div class="scoreboard-player p${i}"><span>${esc(p.name)}</span><strong>${comparison.teams[i].total ?? "—"}</strong><small>баллов силы</small><div class="power-track"><span style="width:${(comparison.teams[i].total ?? 0)/(game.size*100)*100}%"></span></div></div>`).join('<span class="score-divider" aria-hidden="true">:</span>')}</div>
    <p class="power-disclaimer">Оценка Draft Arena · сумма характеристик, без симуляции боя.</p><button class="text-button" data-action="${winner === null ? "retry-power" : "power-rules"}">${icon("info")} ${winner === null ? "Загрузить оценки снова" : "Как считается сила"}</button></section>
    <div class="results-grid">${game.players.map((p,i) => `<section class="result-team p${i} ${winner === i ? "power-winner" : ""}"><div class="player-heading"><span class="player-avatar">P${i+1}</span><div><small>${winner === i ? "ПОБЕДА ПО СИЛЕ" : `КОМАНДА ${i+1}`}</small><h2>${esc(p.name)}</h2></div></div>
    <div class="result-attributes">${POWER_STATS.map(({key,label}) => `<div><span>${label}</span><strong>${comparison.teams[i].stats?.[key] ?? "—"}</strong></div>`).join("")}</div>
    <div class="result-stats"><div><span>Потрачено</span><strong>${money(game.budget-p.balance)}</strong></div><div><span>Осталось</span><strong>${money(p.balance)}</strong></div></div>${teamSlots(p,true)}</section>`).join("")}</div>
    <div class="result-actions"><button class="primary" data-action="rematch">Сыграть ещё раз ${icon("shuffle")}</button><button class="secondary" data-action="home">Выбрать другую вселенную ${icon("arrow")}</button></div>
  </main>`;
}
function render() {
  document.body.dataset.screen = screen;
  $("#app").innerHTML = header() + (screen === "setup" ? setup() : screen === "results" ? results() : auction()) + footer();
}

function closeModal() {
  modal = null; rps = {choices: [], revealed: false};
  $("#overlay").innerHTML = "";
  $("#app").inert = false;
  document.body.classList.remove("modal-open");
  returnFocus?.focus();
}
function dismissModal() {
  const settled = modal === "rps" && game?.phase === "sold";
  closeModal();
  if (settled) render();
}
function showModal(kind, content, wide = false, focus = true) {
  if (!modal) returnFocus = document.activeElement;
  modal = kind;
  $("#overlay").innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-close icon-button" data-action="close-modal" aria-label="Закрыть">${icon("close")}</button>${content}</section></div>`;
  $("#app").inert = true;
  document.body.classList.add("modal-open");
  if (focus) $("#overlay").querySelector("input, button:not(.modal-close), .modal-close")?.focus();
}
function showRules() {
  showModal("rules", `<div class="eyebrow">ПРАВИЛА АРЕНЫ</div><h2 id="modal-title">Одна арена.<br>Две команды.</h2><div class="rules-list">
    ${[["01","Выберите вселенную","Задайте одинаковый бюджет и размер команды. Играйте вдвоём на одном устройстве."],["02","Боритесь за героев","Персонаж выпадает случайно. Делайте ставки от 0,01 $: повышайте цену или сравняйте предложение соперника."],["03","Забирайте в команду","Нажмите «Купить персонажа». Герой достанется игроку с большей ставкой, а сумма спишется из его бюджета."],["04","Равенство решает суефа","При равной ставке выберите по очереди камень, ножницы или бумагу. Победитель купит героя по общей цене."],["05","Сравните силу","В финале складываем баллы героев. Большая сумма побеждает, одинаковая — ничья. Цена покупки на силу не влияет."]].map(([n,title,text]) => `<div><span>${n}</span><div><h3>${title}</h3><p>${text}</p></div></div>`).join("")}</div><div class="modal-note">${icon("info")} Сохраняем минимум 1 цент на каждое свободное место. Игра заканчивается, когда обе команды собраны. Уже принятую ставку нельзя отменить.</div><button class="primary" data-action="close-modal">Всё понятно ${icon("arrow")}</button>`);
}
function sourceLinks(ids) {
  return ids.map(id => {
    const source = powerData.sources[id];
    return `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} ${icon("diagonal")}</a>`;
  }).join("");
}
function showPowerRules() {
  const topic = currentTopic();
  const ids = [...new Set(topic.characters.flatMap(c => ratingFor(c.id)?.sources ?? []))];
  showModal("power-rules", `<div class="eyebrow">ОЦЕНКА DRAFT ARENA</div><h2 id="modal-title">Из чего складывается сила</h2>
    <p class="modal-subtitle">У героя четыре характеристики от 1 до 25. Складываем их — получаем до 100 баллов. Сила команды — сумма баллов всех её героев.</p>
    <div class="power-formula">Атака + защита + скорость + техника</div>
    <div class="power-definitions">${POWER_STATS.map(stat => `<div><strong>${stat.label}</strong><span>${stat.description}</span></div>`).join("")}</div>
    <p class="credits-text">1–5 — низкий уровень, 6–10 — базовый, 11–15 — опытный, 16–20 — высокий, 21–25 — элитный. Шкала относительная внутри выбранной вселенной. 80 баллов не означает «вдвое сильнее», чем 40.</p>
    <p class="credits-text">Это авторские игровые оценки по описаниям способностей из открытых справочников. Числа выставлены вручную для этой игры: в источниках нет нашей шкалы. Популярность и цена покупки не участвуют в расчёте.</p>
    <p class="credits-text">Оцениваем указанную в карточке версию с личным снаряжением. Не добавляем армии, драконов и политическую власть. Призывы, созданные собственной техникой, учитываются. Условия, временные формы и ограничения указаны у героя. Учитываем основную мангу или сериал HBO, без сиквелов и игровых усилений.</p>
    <p class="credits-text">Сумма не моделирует совместимость героев, контрприёмы или исход настоящего боя. При равенстве — ничья по силе, без суефа. В описаниях возможны спойлеры способностей.</p>
    <div class="power-sources"><h3>Источники · ${esc(topic.title)}</h3>${ids.length ? sourceLinks(ids) : "<p>Оценки пока недоступны. Сам аукцион работает.</p>"}<small>Редакция 1 · 20 октября 2026</small></div>
    <button class="primary" data-action="close-modal">Понятно ${icon("check")}</button>`);
}
function catalogCards(query = "") {
  const chars = currentTopic().characters.filter(c => (c.name+" "+c.originalName).toLowerCase().includes(query.toLowerCase()));
  return chars.length ? chars.map(c => `<button class="catalog-character" data-action="character" data-id="${c.id}"><img src="${c.image}" alt="${esc(c.name)}" loading="lazy" /><strong>${esc(c.name)}</strong>${powerBadge(c.id)}</button>`).join("") : '<p class="empty-search">Таких героев не нашлось. Попробуй другое имя.</p>';
}
function showCatalog() {
  showModal("catalog", `<div class="eyebrow">ЗНАКОМЬСЯ С УЧАСТНИКАМИ</div><h2 id="modal-title">${currentTopic().title}</h2><p class="modal-subtitle">24 героя · каждый может стать твоим</p><label class="search-field">${icon("search")}<input id="catalog-search" placeholder="Найти персонажа" aria-label="Найти персонажа" /></label><div class="catalog-grid" id="catalog-grid">${catalogCards()}</div>`, true);
}
function showCharacter(id) {
  const c = character(id);
  if (!c) return;
  const rating = ratingFor(id);
  showModal("character", `<div class="detail-character"><img src="${c.image}" alt="${esc(c.name)}" /><div class="eyebrow">${topics.find(t => t.characters.some(v => v.id === id)).english}</div><h2 id="modal-title">${esc(c.name)}</h2><p>${esc(c.originalName)}</p>
    ${rating ? `<div class="detail-power-heading">${powerBadge(id)}<span>Оценка Draft Arena</span></div>
    <div class="power-attributes">${POWER_STATS.map(({key,label}) => `<div><span>${label}</span><div class="power-track"><span style="width:${rating.stats[key]*4}%"></span></div><strong>${rating.stats[key]}<small>/25</small></strong></div>`).join("")}</div>
    <p class="power-ability">${esc(rating.ability)}</p><p class="power-form"><span>Версия для игры</span>${esc(rating.form)}</p>
    <div class="power-sources"><h3>Описание способностей</h3>${sourceLinks(rating.sources)}</div><button class="text-button" data-action="power-rules">${icon("info")} Как получены баллы</button>`
    : `<p class="credits-text">Оценка силы пока недоступна.</p><button class="text-button" data-action="retry-power">Загрузить оценки снова</button>`}
    <button class="secondary" data-action="catalog">${icon("grid")} Все персонажи темы</button></div>`);
}
const gestures = {rock: ["✊","Камень"], scissors: ["✌️","Ножницы"], paper: ["✋","Бумага"]};
function showRps() {
  if (rps.revealed) {
    const winner = rpsWinner(...rps.choices);
    showModal("rps", `<div class="eyebrow">КАМЕНЬ · НОЖНИЦЫ · БУМАГА</div><h2 id="modal-title">${winner === "tie" ? "Снова ничья!" : `Побеждает ${esc(game.players[winner].name)}`}</h2><div class="rps-result">${rps.choices.map((choice,i) => `<div><span>${esc(game.players[i].name)}</span><b>${gestures[choice][0]}</b><strong>${gestures[choice][1]}</strong></div>`).join('<span class="versus">VS</span>')}</div><p class="modal-subtitle">${winner === "tie" ? "Совпали даже жесты. Ещё один раунд!" : `${esc(character(game.current).name)} достаётся победителю за ${money(game.bids[winner])}.`}</p><button class="primary" data-action="${winner === "tie" ? "rps-retry" : "rps-confirm"}">${winner === "tie" ? "Ещё раз" : "Забрать персонажа"} ${icon("arrow")}</button>`);
    return;
  }
  const player = rps.choices.length;
  showModal("rps", `<div class="eyebrow">РАВНЫЕ СТАВКИ · ${money(game.bids[0])}</div><h2 id="modal-title">Всё решит суефа.</h2><p class="modal-subtitle">${player ? "Первый выбор скрыт. Передайте устройство." : "Пусть второй игрок отвернётся от экрана."}</p><div class="rps-player p${player}"><span class="player-avatar">P${player+1}</span><div><small>СЕЙЧАС ВЫБИРАЕТ</small><strong>${esc(game.players[player].name)}</strong></div></div><div class="rps-choices">${Object.entries(gestures).map(([key,[emoji,label]]) => `<button data-action="rps-choice" data-value="${key}"><span>${emoji}</span><strong>${label}</strong></button>`).join("")}</div><p class="rps-foot">Выбор откроется, когда оба игрока сделают ход.</p>`);
}
function begin() {
  try {
    const topic = topics.find(t => t.id === selected);
    const newGame = createGame({topic, budget: parseMoney(form.budget), size: form.size, names: form.names});
    game = newGame; screen = "auction"; persist(); closeModal(); render(); beep(true);
    window.scrollTo({top: 0, behavior: "smooth"});
  } catch(error) { toast(error.message); }
}
function completeSale(winner) {
  purchase(game, winner); persist(); closeModal(); render(); beep(true);
}

document.addEventListener("submit", event => {
  if (event.target.id === "setup-form") {
    event.preventDefault();
    if (game && game.phase !== "finished") {
      showModal("restart", `<div class="eyebrow">НОВАЯ ИГРА</div><h2 id="modal-title">Начать заново?</h2><p class="modal-subtitle">Текущая партия будет заменена новой. Команды и ставки сбросятся.</p><button class="primary" data-action="confirm-start">Начать новую игру ${icon("arrow")}</button><button class="text-button modal-cancel" data-action="close-modal">Оставить текущую</button>`);
    } else begin();
  }
  if (event.target.classList.contains("bid-form")) {
    event.preventDefault();
    try {
      const player = Number(event.target.dataset.player);
      placeBid(game, player, parseMoney($(`#bid-${player}`).value));
      persist(); render(); beep(); toast(`Ставка принята: ${money(game.bids[player])}`);
    } catch(error) { toast(error.message); }
  }
});
document.addEventListener("input", event => {
  const {name, value, id} = event.target;
  if (name === "name0" || name === "name1") form.names[Number(name.slice(-1))] = value;
  if (name === "budget") form.budget = value;
  if (name === "size") {
    form.size = Number(value);
    $("#total-slots").textContent = Number.isInteger(form.size) && form.size > 0 ? form.size*2 : "—";
    document.querySelectorAll('[data-action="size"]').forEach(el => {
      const active = Number(el.dataset.value) === form.size;
      el.classList.toggle("active", active); el.setAttribute("aria-pressed", String(active));
    });
  }
  if (id === "catalog-search") $("#catalog-grid").innerHTML = catalogCards(value);
});
document.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const {action,id,value,player} = button.dataset;
  try {
    switch (action) {
      case "sound": sound = !sound; render(); beep(); break;
      case "filter": filter = id; render(); break;
      case "select-topic": selected = id; render(); beep(); break;
      case "size": form.size = Number(value); render(); break;
      case "budget-step": form.budget = String(Math.max(.01, Math.min(999999.99, ((parseMoney(form.budget) ?? 0) + Number(value)*100)/100))); render(); break;
      case "home": screen = "setup"; closeModal(); render(); window.scrollTo({top:0,behavior:"smooth"}); break;
      case "resume": screen = game.phase === "finished" ? "results" : "auction"; render(); break;
      case "rules": showRules(); break;
      case "power-rules": showPowerRules(); break;
      case "retry-power": {
        button.disabled = true;
        loadPowerData().then(data => {
          powerData = preparePowerData(data, topics);
          closeModal(); render();
          toast(powerData && Object.keys(powerData.characters).length === topics.flatMap(t => t.characters).length ? "Оценки силы загружены." : "Не удалось загрузить все оценки. Попробуй позже.");
        });
        break;
      }
      case "catalog": showCatalog(); break;
      case "character": showCharacter(id); break;
      case "close-modal": dismissModal(); break;
      case "confirm-start": begin(); break;
      case "rematch":
        selected = game.topicId; form = {names:game.players.map(p=>p.name), budget:String(game.budget/100), size:game.size}; begin(); break;
      case "bid-add": {
        const input = $(`#bid-${player}`);
        input.value = (Math.min(maxBid(game,Number(player)), (parseMoney(input.value) ?? Math.max(...game.bids)) + Number(value))/100).toFixed(2); break;
      }
      case "bid-max": $(`#bid-${player}`).value = (maxBid(game,Number(player))/100).toFixed(2); break;
      case "buy": if (outcome(game) === "tie") {rps = {choices:[],revealed:false}; showRps();} else completeSale(); break;
      case "skip": skipCharacter(game); persist(); render(); beep(); break;
      case "next":
        nextRound(game); screen = game.phase === "finished" ? "results" : "auction"; persist(); render(); beep();
        if (screen === "results" || window.matchMedia("(max-width:760px)").matches) {
          const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
          if (screen === "results") window.scrollTo({top:0,behavior});
          else $(".character-card")?.scrollIntoView({block:"start",behavior});
        }
        break;
      case "rps-choice":
        rps.choices.push(value); rps.revealed = rps.choices.length === 2;
        if (rps.revealed && rpsWinner(...rps.choices) !== "tie") {
          purchase(game, rpsWinner(...rps.choices)); persist(); beep(true);
        }
        showRps(); break;
      case "rps-retry": rps = {choices:[],revealed:false}; showRps(); break;
      case "rps-confirm": closeModal(); render(); break;
      case "credits": showModal("credits", `<div class="eyebrow">СДЕЛАНО ДЛЯ ФАНАТОВ</div><h2 id="modal-title">Любимые герои.<br>Твои правила.</h2><p class="modal-subtitle">Draft Arena — неофициальная игра для двух участников на одном устройстве. Деньги в игре виртуальные.</p><p class="credits-text">В каждой теме — 24 персонажа. Аниме-герои выбраны по числу добавлений в избранное в <a href="https://anilist.co" target="_blank" rel="noopener noreferrer">AniList</a>. Герои «Игры престолов» подобраны из основного актёрского состава <a href="https://www.tvmaze.com/shows/82/game-of-thrones" target="_blank" rel="noopener noreferrer">TVmaze</a>. Подборка: октябрь 2026.</p><p class="credits-text">Персонажи, названия и изображения принадлежат их правообладателям. Игра сохраняется только в этом браузере.</p><button class="primary" data-action="close-modal">На арену ${icon("arrow")}</button>`); break;
    }
  } catch(error) { toast(error.message); }
});
document.addEventListener("keydown", event => {
  if (!modal) return;
  if (event.key === "Escape") dismissModal();
  if (event.key === "Tab") {
    const elements = [...$("#overlay").querySelectorAll('button:not(:disabled), input:not(:disabled), a[href]')];
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
  }
});

try {
  const [response, ratings] = await Promise.all([fetch("./catalog.json"), loadPowerData()]);
  if (!response.ok) throw new Error("Не удалось загрузить персонажей.");
  topics = await response.json();
  powerData = preparePowerData(ratings, topics);
  try {
    game = restoreGame(localStorage.getItem(KEY), topics);
    if (game) {
      selected = game.topicId;
      form = {names:game.players.map(p=>p.name), budget:String(game.budget/100), size:game.size};
      screen = game.phase === "finished" ? "results" : "auction";
    }
  } catch { storageAvailable = false; }
  render();
} catch(error) {
  $("#app").innerHTML = `<main class="loading"><h1>Арена загружается</h1><p>Не удалось загрузить каталог. Проверь подключение и обнови страницу.</p><button class="primary" onclick="location.reload()">Попробовать ещё раз</button></main>`;
}
