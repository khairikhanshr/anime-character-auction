import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {POWER_STATS, powerScore, preparePowerData, teamPower, compareTeamPower} from "../dist/power.js";
import {createGame, placeBid, purchase, nextRound, restoreGame} from "../dist/game.js";

const topics = JSON.parse(fs.readFileSync(new URL("../dist/catalog.json", import.meta.url)));
const data = JSON.parse(fs.readFileSync(new URL("../dist/power.json", import.meta.url)));
const ratings = data.characters;
const sample = values => ({stats: Object.fromEntries(POWER_STATS.map(({key},i) => [key,values[i]]))});

test("all 144 characters have valid, sourced ratings and explicit versions", () => {
  const prepared = preparePowerData(data,topics);
  const ids = topics.flatMap(t => t.characters.map(c => c.id));
  assert.deepEqual(Object.keys(ratings).sort(),ids.sort());
  assert.equal(Object.keys(prepared.characters).length,144);
  for (const topic of topics) for (const c of topic.characters) {
    const r = ratings[c.id];
    assert.equal(r.topicId,topic.id);
    assert.ok(powerScore(r) >= 4 && powerScore(r) <= 100);
    assert.ok(r.form.trim());
    assert.ok(r.ability.trim());
    assert.ok(r.sources.length);
    for (const id of r.sources) assert.equal(new URL(data.sources[id].url).protocol,"https:");
  }
});

test("strength is an exact sum of four stats, independent of money or popularity", () => {
  const r = {a:sample([25,20,15,10]), b:sample([1,2,3,4])};
  const team = [{id:"a",price:1,favorites:0},{id:"b",price:999999,favorites:10000}];
  assert.deepEqual(teamPower(team,r),{total:80,stats:{attack:26,defense:22,speed:18,technique:14},missing:[]});
  assert.equal(teamPower(team.map(c => ({...c,price:100,favorites:1})),r).total,80);
  for (const invalid of [null,{},sample([0,1,1,1]),sample([26,1,1,1]),sample([1.1,1,1,1]),sample(["5",1,1,1])]) {
    assert.equal(powerScore(invalid),null);
  }
});

test("team comparison handles both winners and an exact tie", () => {
  const r = {strong:sample([25,25,25,25]), weak:sample([10,10,10,10]), equal:sample([5,15,5,15])};
  const players = ids => ids.map(id => ({team:[{id}]}));
  assert.equal(compareTeamPower(players(["strong","weak"]),r,1).winner,0);
  assert.equal(compareTeamPower(players(["weak","strong"]),r,1).winner,1);
  assert.equal(compareTeamPower(players(["strong","weak"]),r,1).difference,60);
  assert.equal(compareTeamPower(players(["equal","weak"]),r,1).winner,"tie");
  assert.equal(compareTeamPower(players(["equal","weak"]),r,1).difference,0);
});

test("missing or invalid data does not produce a partial score or a false winner", () => {
  const r = {known:sample([20,20,20,20])};
  assert.deepEqual(teamPower([{id:"known"},{id:"unknown"}],r),{total:null,stats:null,missing:["unknown"]});
  const players=[{team:[{id:"known"}]},{team:[{id:"unknown"}]}];
  assert.equal(compareTeamPower(players,r,1).winner,null);
  assert.equal(compareTeamPower(players,undefined,1).winner,null);
  assert.equal(compareTeamPower([{team:[]},{team:[]}],r,1).winner,null);
  assert.equal(compareTeamPower([{team:[{id:"known"}]},{team:[]}],r,1).winner,null);
  assert.equal(compareTeamPower([{team:[{id:"known"}]},{team:[{id:"known"}]}],r,2).winner,null);
});

test("bad metadata, a mismatched universe or an unsafe source is ignored", () => {
  assert.equal(preparePowerData(null,topics),null);
  assert.equal(preparePowerData({...data,version:99},topics),null);
  const bad = structuredClone(data);
  const id = topics[0].characters[0].id;
  bad.characters[id].topicId = "bleach";
  assert.equal(preparePowerData(bad,topics).characters[id],undefined);
  bad.characters[id].topicId = "demon";
  bad.sources.demon.url = "javascript:alert(1)";
  assert.equal(preparePowerData(bad,topics).characters[id],undefined);
  assert.equal(Object.keys(preparePowerData(bad,topics).characters).length,120);
});

test("every universe finishes with additive scores, including pre-rating saved games", () => {
  for (const topic of topics) {
    const game = createGame({topic,size:12,budget:12,names:["Один","Два"]},() => .5);
    for (let i=0;i<24;i++) {
      placeBid(game,i%2,1); purchase(game); nextRound(game);
    }
    const comparison = compareTeamPower(game.players,ratings,game.size);
    const saved = JSON.stringify(game);
    assert.ok(!saved.includes("stats"));
    const restored = restoreGame(saved,topics);
    assert.ok(restored);
    assert.deepEqual(compareTeamPower(restored.players,ratings,restored.size),comparison);
    const expected = topic.characters.reduce((total,c) => total+powerScore(ratings[c.id]),0);
    assert.equal(comparison.teams.reduce((total,team) => total+team.total,0),expected);
    for (const team of comparison.teams) {
      assert.equal(Object.values(team.stats).reduce((a,b) => a+b,0),team.total);
      assert.ok(team.total <= 1200);
    }
  }
});
