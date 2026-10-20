import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createGame, parseMoney, placeBid, maxBid, outcome, purchase, nextRound, skipCharacter, rpsWinner, isComplete, restoreGame} from "../dist/game.js";

const topics = JSON.parse(fs.readFileSync(new URL("../dist/catalog.json", import.meta.url)));
const make = (size = 5, budget = 10000) => createGame({topic:topics[0],budget,size,names:["Первый","Второй"]});

test("144 unique, translated characters with local, nonempty portraits", () => {
  assert.equal(topics.length,6);
  const ids = topics.flatMap(t => t.characters.map(c => c.id));
  assert.equal(new Set(ids).size,144);
  for (const t of topics) {
    assert.equal(t.characters.length,24);
    for (const c of t.characters) {
      assert.match(c.name,/[А-Яа-яЁё]/);
      assert.ok(fs.statSync(new URL("../dist/"+c.image,import.meta.url)).size > 500);
    }
    assert.ok(fs.statSync(new URL("../dist/"+t.cover,import.meta.url)).size > 500);
  }
});
test("currency uses exact integer cents, accepts decimal comma, rejects invalid precision", () => {
  assert.equal(parseMoney("0.01"),1);
  assert.equal(parseMoney("100,99"),10099);
  assert.equal(parseMoney("1.1"),110);
  for (const value of ["0.001","-1","abc","","1e2","Infinity","1.2.3","1000000"]) assert.equal(parseMoney(value),null);
});
test("reject invalid sizes and budgets before a match starts", () => {
  for (const size of [0,-1,13,1.5,NaN]) assert.throws(() => make(size));
  assert.throws(() => make(5,4));
  assert.throws(() => make(5,Infinity));
});
test("first bid must be a cent; accepted bids only go up or match opponent", () => {
  const g = make();
  for (const amount of [0,-1,.5,null]) assert.throws(() => placeBid(g,0,amount));
  placeBid(g,0,1);
  placeBid(g,1,100);
  assert.throws(() => placeBid(g,0,99));
  placeBid(g,0,100);
  assert.equal(outcome(g),"tie");
  assert.throws(() => placeBid(g,0,100));
  placeBid(g,0,101);
  assert.equal(outcome(g),0);
});
test("purchase deducts only winner's bid and does not allow duplicate purchase", () => {
  const g = make();
  const id = g.current;
  placeBid(g,0,100); placeBid(g,1,101);
  purchase(g);
  assert.equal(g.players[1].balance,9899);
  assert.equal(g.players[0].balance,10000);
  assert.equal(g.players[1].team[0].id,id);
  assert.equal(g.players[0].team.length,0);
  assert.throws(() => purchase(g));
  assert.throws(() => placeBid(g,0,102));
  nextRound(g);
  assert.notEqual(g.current,id);
  assert.deepEqual(g.bids,[0,0]);
});
test("no purchase without a bid, no random tie winner", () => {
  const g = make();
  assert.throws(() => purchase(g));
  placeBid(g,0,500); placeBid(g,1,500);
  assert.throws(() => purchase(g));
  purchase(g,1);
  assert.equal(g.players[1].balance,9500);
  assert.equal(g.lastSale.tiebreak,true);
});
test("all nine rock paper scissors combinations", () => {
  for (const [a,b,result] of [["rock","rock","tie"],["paper","paper","tie"],["scissors","scissors","tie"],
    ["rock","scissors",0],["paper","rock",0],["scissors","paper",0],
    ["scissors","rock",1],["rock","paper",1],["paper","scissors",1]]) assert.equal(rpsWinner(a,b),result);
});
test("reserve one cent per remaining slot so both teams can finish", () => {
  const g = make(3,100);
  assert.equal(maxBid(g,0),98);
  assert.throws(() => placeBid(g,0,99));
  placeBid(g,0,98); purchase(g); nextRound(g);
  assert.equal(maxBid(g,0),1);
  placeBid(g,0,1); purchase(g); nextRound(g);
  placeBid(g,0,1); purchase(g); nextRound(g);
  assert.equal(g.players[0].balance,0);
  assert.equal(maxBid(g,0),0);
  assert.throws(() => placeBid(g,0,1));
});
test("skipping preserves deck and cannot discard an accepted bid", () => {
  const g = make();
  const original = new Set([...g.deck,g.current]);
  for (let n=0;n<40;n++) {
    const previous = g.current;
    skipCharacter(g);
    assert.notEqual(g.current,previous);
    assert.deepEqual(new Set([...g.deck,g.current]),original);
  }
  placeBid(g,0,1);
  assert.throws(() => skipCharacter(g));
});
test("full 24-character game ends with no duplicates, no negative balances, restorable at every phase", () => {
  const g = make(12,12);
  for (let n=0;n<24;n++) {
    assert.ok(restoreGame(JSON.stringify(g),topics));
    placeBid(g,n%2,1);
    purchase(g);
    assert.ok(restoreGame(JSON.stringify(g),topics));
    nextRound(g);
  }
  assert.ok(isComplete(g));
  assert.equal(g.phase,"finished");
  assert.equal(g.deck.length,0);
  assert.equal(new Set(g.purchases.map(p=>p.id)).size,24);
  for (const p of g.players) {assert.equal(p.team.length,12);assert.equal(p.balance,0);}
  assert.ok(restoreGame(JSON.stringify(g),topics));
});
test("corrupt or inconsistent saved matches are safely rejected", () => {
  assert.equal(restoreGame("{bad",topics),null);
  assert.equal(restoreGame("null",topics),null);
  for (const mutate of [
    g=>g.players[0].balance=-1,
    g=>g.deck.push(g.current),
    g=>g.bids[0]=g.budget+1,
    g=>g.phase="unknown",
    g=>g.current="missing-character",
    g=>g.players[0].name=null,
    g=>g.size=13
  ]) {const g=make(); mutate(g); assert.equal(restoreGame(JSON.stringify(g),topics),null);}
});
