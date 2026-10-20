export const SCHEMA_VERSION = 1;

export function parseMoney(value) {
  const text = String(value).trim().replace(",", ".");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function money(cents) {
  return new Intl.NumberFormat("ru-RU", {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(cents / 100) + " $";
}

export function createGame({topic, budget, size, names}, random = Math.random) {
  if (!topic || topic.characters.length < size * 2 || !Number.isInteger(size) || size < 1) {
    throw new Error("Для двух команд недостаточно персонажей. Выбери размер от 1 до 12.");
  }
  if (!Number.isSafeInteger(budget) || budget < size || budget > 99999999) {
    throw new Error("Бюджет должен покрывать хотя бы 1 цент на каждого персонажа.");
  }
  const deck = topic.characters.map(c => c.id);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return {
    version: SCHEMA_VERSION, topicId: topic.id, budget, size, deck,
    players: [0, 1].map(i => ({name: (String(names?.[i] || "").trim() || `Игрок ${i + 1}`).slice(0, 24), balance: budget, team: []})),
    phase: "auction", current: deck.pop(), bids: [0, 0], round: 1, purchases: [], lastSale: null
  };
}

export function maxBid(game, player) {
  const p = game.players[player];
  if (p.team.length >= game.size) return 0;
  return Math.max(0, p.balance - (game.size - p.team.length - 1));
}

export function placeBid(game, player, amount) {
  if (game.phase !== "auction") throw new Error("Сейчас нельзя сделать ставку.");
  if (![0, 1].includes(player)) throw new Error("Игрок не найден.");
  if (game.players[player].team.length >= game.size) throw new Error("Команда уже собрана.");
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("Минимальная ставка — 0,01 $. Укажи не больше двух знаков после запятой.");
  if (amount > maxBid(game, player)) throw new Error("Не хватает бюджета. Оставь минимум 1 цент на каждое свободное место.");
  if (amount <= game.bids[player]) throw new Error("Новая ставка должна быть выше твоей предыдущей.");
  if (amount < Math.max(...game.bids)) throw new Error("Сравняй текущую ставку или предложи больше.");
  game.bids[player] = amount;
  return game;
}

export function outcome(game) {
  if (!game.bids.some(b => b > 0)) throw new Error("Сначала сделайте хотя бы одну ставку.");
  return game.bids[0] === game.bids[1] ? "tie" : (game.bids[0] > game.bids[1] ? 0 : 1);
}

export function rpsWinner(first, second) {
  const values = ["rock", "paper", "scissors"];
  if (!values.includes(first) || !values.includes(second)) throw new Error("Выбери камень, ножницы или бумагу.");
  if (first === second) return "tie";
  return ({rock: "scissors", paper: "rock", scissors: "paper"})[first] === second ? 0 : 1;
}

export function purchase(game, tieWinner) {
  if (game.phase !== "auction") throw new Error("Этот персонаж уже куплен.");
  const result = outcome(game);
  const winner = result === "tie" ? tieWinner : result;
  if (![0, 1].includes(winner)) throw new Error("Равные ставки: сначала сыграйте в суефа.");
  const amount = game.bids[winner];
  if (amount > maxBid(game, winner)) throw new Error("Недостаточно средств или команда уже собрана.");
  const sale = {id: game.current, price: amount, player: winner, round: game.round, tiebreak: result === "tie"};
  game.players[winner].balance -= amount;
  game.players[winner].team.push(sale);
  game.purchases.push(sale);
  game.lastSale = sale;
  game.phase = "sold";
  return sale;
}

export function isComplete(game) {
  return game.players.every(p => p.team.length === game.size);
}

export function nextRound(game) {
  if (game.phase !== "sold") throw new Error("Сначала завершите текущий лот.");
  if (isComplete(game)) {
    game.phase = "finished";
    return game;
  }
  if (!game.deck.length) throw new Error("В колоде больше нет персонажей.");
  game.current = game.deck.pop();
  game.bids = [0, 0];
  game.lastSale = null;
  game.round += 1;
  game.phase = "auction";
  return game;
}

export function skipCharacter(game) {
  if (game.phase !== "auction" || game.bids.some(Boolean)) throw new Error("Нельзя пропустить персонажа после первой ставки.");
  if (!game.deck.length) throw new Error("Это последний доступный персонаж.");
  game.deck.unshift(game.current);
  game.current = game.deck.pop();
  return game;
}

export function restoreGame(value, topics) {
  try {
    const game = JSON.parse(value);
    const topic = topics.find(t => t.id === game.topicId);
    if (!topic || game.version !== SCHEMA_VERSION || !["auction", "sold", "finished"].includes(game.phase)) return null;
    if (!Number.isInteger(game.size) || game.size < 1 || game.size * 2 > topic.characters.length) return null;
    if (!Number.isSafeInteger(game.budget) || game.budget < game.size || game.budget > 99999999) return null;
    if (!Array.isArray(game.players) || game.players.length !== 2 || !Array.isArray(game.deck) || !Array.isArray(game.bids) || game.bids.length !== 2) return null;
    const ids = new Set(topic.characters.map(c => c.id));
    const acquired = [];
    for (const [i, p] of game.players.entries()) {
      if (typeof p.name !== "string" || p.name.length > 24 || !Number.isSafeInteger(p.balance) || p.balance < 0 || !Array.isArray(p.team) || p.team.length > game.size) return null;
      if (!p.team.every(c => ids.has(c.id) && c.player === i && Number.isSafeInteger(c.price) && c.price > 0)) return null;
      if (p.balance + p.team.reduce((sum, c) => sum + c.price, 0) !== game.budget || p.balance < game.size - p.team.length) return null;
      acquired.push(...p.team.map(c => c.id));
    }
    const all = [...game.deck, ...acquired, ...(game.phase === "auction" ? [game.current] : [])];
    if (all.length !== ids.size || new Set(all).size !== ids.size || all.some(id => !ids.has(id))) return null;
    if (!game.bids.every(b => Number.isSafeInteger(b) && b >= 0)) return null;
    if (game.phase === "auction" && game.bids.some((b, i) => b > maxBid(game, i))) return null;
    if (game.phase !== "auction" && (!game.lastSale || !acquired.includes(game.current) || game.lastSale.id !== game.current)) return null;
    if (!Array.isArray(game.purchases) || game.purchases.length !== acquired.length || !Number.isInteger(game.round) || game.round < 1) return null;
    if (game.phase === "finished" && !isComplete(game)) return null;
    return game;
  } catch { return null; }
}
