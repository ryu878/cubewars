// EPIC 38 regression: auction fee burn/ledger, Deathmatch-only isolation,
// ground drop TTL expire-destroy, and P2P trade atomicity (incl. rollback).

import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { AUCTION_FEE, ECONOMY_CAPS, GROUND_DROP_TTL_MS } from "@cubewars/shared";
import { AuctionHouse, EconomyActionError, EconomyStore } from "../server/src/economy/index.js";
import { Match } from "../server/src/match.js";
import { executeAtomicTrade, MatchGroundItems, type TradeSession } from "../server/src/matchMarket.js";
import { openTestEconomyStore } from "./economy-test-helpers.js";

function fakeSocket(sent: string[] = []): WebSocket {
  return {
    readyState: 1,
    OPEN: 1,
    send: (data: string) => {
      sent.push(data);
    },
  } as unknown as WebSocket;
}

async function main(): Promise<void> {
  const store = await openTestEconomyStore();
  const auction = AuctionHouse.fromStore(store);
  const now = Date.now();

  // --- Auction buyout: 10% fee = 5% burn + 5% developer ledger ---
  await store.addGold("SellerA", 0, "deathmatch");
  await store.addGold("BuyerA", 1000, "deathmatch");
  const gem = await store.grantGem("SellerA", "health", 42, now, undefined, "deathmatch");
  const lot = await auction.listItem("SellerA", "gem", gem.id, 100, 200, now, undefined, 60_000);
  assert.equal((await store.getFullProfile("SellerA", "deathmatch")).gems.length, 0, "listed gem leaves bag");

  await auction.buyout("BuyerA", lot.lotId, now + 1);
  const sellerAfter = await store.getFullProfile("SellerA", "deathmatch");
  const buyerAfter = await store.getFullProfile("BuyerA", "deathmatch");
  const price = 200;
  const burn = Math.floor(price * AUCTION_FEE.burnFraction);
  const developer = Math.floor(price * AUCTION_FEE.developerFraction);
  const sellerNet = price - burn - developer;
  assert.equal(sellerAfter.gold, sellerNet, `seller net ${sellerNet}`);
  assert.equal(buyerAfter.gold, 1000 - price, "buyer paid buyout");
  assert.equal(buyerAfter.gems.length, 1, "buyer received gem");
  assert.equal(await auction.getDeveloperGold(), developer);
  assert.equal(await auction.getBurnedGold(), burn);
  console.log("[ok] auction buyout fee burn/ledger");

  // --- Buyer cap failure on settle → cancel + refund bid, item back to seller ---
  await store.addGold("SellerB", 0, "deathmatch");
  await store.addGold("BuyerFull", 500, "deathmatch");
  // Fill buyer gem cap so settle cannot insert.
  for (let i = 0; i < ECONOMY_CAPS.gems; i++) {
    await store.grantGem("BuyerFull", "armor", 5 + i, now, undefined, "deathmatch");
  }
  const gem2 = await store.grantGem("SellerB", "speed", 77, now, undefined, "deathmatch");
  const lot2 = await auction.listItem("SellerB", "gem", gem2.id, 50, null, now, undefined, 1_000);
  await auction.bid("BuyerFull", lot2.lotId, 50, now + 1);
  assert.equal((await store.getFullProfile("BuyerFull", "deathmatch")).gold, 450, "bid escrowed");

  await auction.tick(now + 2_000);
  const buyerFullAfter = await store.getFullProfile("BuyerFull", "deathmatch");
  const sellerBAfter = await store.getFullProfile("SellerB", "deathmatch");
  assert.equal(buyerFullAfter.gold, 500, "bid refunded on buyer-cap cancel");
  assert.equal(buyerFullAfter.gems.length, ECONOMY_CAPS.gems, "buyer still at gem cap");
  assert.equal(sellerBAfter.gems.length, 1, "item returned to seller");
  assert.equal(sellerBAfter.gems[0]!.gemType, "speed");
  console.log("[ok] auction settle cancels on buyer cap + refunds");

  // --- Isolation: auction/trade/ground operate on Deathmatch only ---
  await store.addGold("SandboxOnly", 999, "sandbox");
  await store.grantGem("SandboxOnly", "damage", 11, now, undefined, "sandbox");
  await store.addGold("SandboxOnly", 0, "deathmatch");
  // Listing always extracts from deathmatch — sandbox gem is invisible to auction.
  let listedSandbox = false;
  try {
    const sb = await store.getFullProfile("SandboxOnly", "sandbox");
    await auction.listItem("SandboxOnly", "gem", sb.gems[0]!.id, 10, null, now);
    listedSandbox = true;
  } catch (err) {
    assert.ok(err instanceof EconomyActionError, "sandbox list must throw EconomyActionError");
    // Deathmatch bag has no such gem id → not_found (sandbox id is invisible).
    assert.equal((err as EconomyActionError).code, "not_found");
  }
  assert.equal(listedSandbox, false, "cannot list sandbox-pool gem on auction");
  assert.equal((await store.getFullProfile("SandboxOnly", "sandbox")).gems.length, 1);
  assert.equal((await store.getFullProfile("SandboxOnly", "sandbox")).gold, 999);

  const botsMatch = new Match({ id: "epic38-bots", mode: "bots", economy: store });
  let sandboxDropOk = false;
  try {
    await botsMatch.handleDropItem("p1", "SandboxOnly", "gem", 1);
    sandboxDropOk = true;
  } catch {
    /* match handler swallows into action result */
  }
  // Handler sends failure result rather than throwing — verify via profile unchanged.
  void sandboxDropOk;
  assert.equal(
    (await store.getFullProfile("SandboxOnly", "sandbox")).gems.length,
    1,
    "sandbox match must not extract for ground drop",
  );
  console.log("[ok] deathmatch-only isolation for auction/ground");

  // --- Ground TTL: expire destroys (no return to bag) ---
  const ground = new MatchGroundItems();
  const egg = await store.grantEgg("Dropper", now, 60_000, "deathmatch");
  const payload = await store.extractBagItem("Dropper", "egg", egg.id, now, "deathmatch");
  const entity = ground.drop(payload, { x: 0, y: 0, z: 0 }, "dropper-id", now, GROUND_DROP_TTL_MS);
  assert.equal(ground.get(entity.groundId)?.groundId, entity.groundId);
  assert.equal(ground.expire(now + GROUND_DROP_TTL_MS - 1), 0, "not yet expired");
  assert.equal(ground.expire(now + GROUND_DROP_TTL_MS), 1, "TTL destroy");
  assert.equal(ground.get(entity.groundId), undefined);
  assert.equal((await store.getFullProfile("Dropper", "deathmatch")).eggs.length, 0, "expire does not restore");
  console.log("[ok] ground TTL expire-destroy");

  // Public match pickup path (smoke).
  const publicMatch = new Match({ id: "epic38-public", mode: "public", economy: store });
  const sentA: string[] = [];
  const sentB: string[] = [];
  await publicMatch.addHuman("human-a", fakeSocket(sentA), "TraderA", "tradera");
  await publicMatch.addHuman("human-b", fakeSocket(sentB), "TraderB", "traderb");
  await store.addGold("TraderA", 100, "deathmatch");
  await store.addGold("TraderB", 100, "deathmatch");
  const tradeGem = await store.grantGem("TraderA", "health", 9, now, undefined, "deathmatch");

  // --- Trade atomic success (no fee) ---
  const sessionOk: TradeSession = {
    tradeId: "t-ok",
    a: {
      playerId: "human-a",
      nickname: "TraderA",
      gold: 25,
      items: [{ itemType: "gem", itemId: tradeGem.id }],
      confirmed: true,
    },
    b: {
      playerId: "human-b",
      nickname: "TraderB",
      gold: 10,
      items: [],
      confirmed: true,
    },
  };
  const aBefore = await store.getFullProfile("TraderA", "deathmatch");
  const bBefore = await store.getFullProfile("TraderB", "deathmatch");
  await executeAtomicTrade(store, sessionOk, now);
  const aOk = await store.getFullProfile("TraderA", "deathmatch");
  const bOk = await store.getFullProfile("TraderB", "deathmatch");
  assert.equal(aOk.gold, aBefore.gold - 25 + 10, "A gold after swap");
  assert.equal(bOk.gold, bBefore.gold - 10 + 25, "B gold after swap");
  assert.equal(aOk.gems.length, aBefore.gems.length - 1, "A lost gem");
  assert.equal(bOk.gems.length, bBefore.gems.length + 1, "B gained gem");
  console.log("[ok] trade atomic success (no fee)");

  // --- Trade atomic rollback when receiver cannot fit ---
  await store.addGold("CapA", 50, "deathmatch");
  await store.addGold("CapB", 50, "deathmatch");
  const overflowGem = await store.grantGem("CapA", "armor", 8, now, undefined, "deathmatch");
  for (let i = 0; i < ECONOMY_CAPS.gems; i++) {
    await store.grantGem("CapB", "speed", 5 + i, now, undefined, "deathmatch");
  }
  const sessionFail: TradeSession = {
    tradeId: "t-fail",
    a: {
      playerId: "x",
      nickname: "CapA",
      gold: 5,
      items: [{ itemType: "gem", itemId: overflowGem.id }],
      confirmed: true,
    },
    b: {
      playerId: "y",
      nickname: "CapB",
      gold: 0,
      items: [],
      confirmed: true,
    },
  };
  const capABefore = await store.getFullProfile("CapA", "deathmatch");
  const capBBefore = await store.getFullProfile("CapB", "deathmatch");
  let failed = false;
  try {
    await executeAtomicTrade(store, sessionFail, now);
  } catch (err) {
    failed = true;
    assert.ok(err instanceof EconomyActionError);
  }
  assert.equal(failed, true, "trade must fail when B at gem cap");
  const capAAfter = await store.getFullProfile("CapA", "deathmatch");
  const capBAfter = await store.getFullProfile("CapB", "deathmatch");
  assert.equal(capAAfter.gold, capABefore.gold, "A gold restored");
  assert.equal(capBAfter.gold, capBBefore.gold, "B gold unchanged");
  assert.equal(capAAfter.gems.length, capABefore.gems.length, "A gem restored");
  assert.equal(capBAfter.gems.length, capBBefore.gems.length, "B gems unchanged");
  console.log("[ok] trade atomic rollback on cap failure");

  // Match-level trade open rejects bots mode.
  await botsMatch.addHuman("bot-human", fakeSocket(), "SandboxOnly", "sandboxonly");
  await botsMatch.handleTradeOpen("bot-human", "SandboxOnly", "nobody");
  // no throw — action result failure; sandbox gold untouched
  assert.equal((await store.getFullProfile("SandboxOnly", "sandbox")).gold, 999);

  // --- F-001: concurrent ground pickup — exactly one winner, no duplicate ---
  const raceMatch = new Match({ id: "epic38-race", mode: "public", economy: store });
  await raceMatch.addHuman("racer-a", fakeSocket(), "RacerA", "racera");
  await raceMatch.addHuman("racer-b", fakeSocket(), "RacerB", "racerb");
  const raceGem = await store.grantGem("RacerA", "damage", 55, now, undefined, "deathmatch");
  await raceMatch.handleDropItem("racer-a", "RacerA", "gem", raceGem.id);
  const aGemsBefore = (await store.getFullProfile("RacerA", "deathmatch")).gems.length;
  const bGemsBefore = (await store.getFullProfile("RacerB", "deathmatch")).gems.length;
  // Both race the same groundId=1 (first drop in this match).
  await Promise.all([
    raceMatch.handlePickupGround("racer-a", "RacerA", 1),
    raceMatch.handlePickupGround("racer-b", "RacerB", 1),
  ]);
  const aGemsAfter = (await store.getFullProfile("RacerA", "deathmatch")).gems.length;
  const bGemsAfter = (await store.getFullProfile("RacerB", "deathmatch")).gems.length;
  const totalGained = aGemsAfter - aGemsBefore + (bGemsAfter - bGemsBefore);
  assert.equal(totalGained, 1, "exactly one pickup winner");
  assert.equal(
    aGemsAfter + bGemsAfter,
    aGemsBefore + bGemsBefore + 1,
    "no duplicated gem across profiles",
  );
  console.log("[ok] F-001 concurrent ground pickup single-winner");

  // F-001 insert-fail after claim restores ground entity.
  const restoreGem = await store.grantGem("RacerA", "health", 15, now, undefined, "deathmatch");
  await raceMatch.handleDropItem("racer-a", "RacerA", "gem", restoreGem.id);
  for (let i = (await store.getFullProfile("RacerB", "deathmatch")).gems.length; i < ECONOMY_CAPS.gems; i++) {
    await store.grantGem("RacerB", "armor", 5 + (i % 90), now, undefined, "deathmatch");
  }
  await raceMatch.handlePickupGround("racer-b", "RacerB", 2);
  assert.equal(
    (await store.getFullProfile("RacerB", "deathmatch")).gems.length,
    ECONOMY_CAPS.gems,
    "full bag cannot pickup",
  );
  // Ground still holdable by RacerA (entity restored).
  await raceMatch.handlePickupGround("racer-a", "RacerA", 2);
  assert.ok(
    (await store.getFullProfile("RacerA", "deathmatch")).gems.some((g) => g.value === 15),
    "claim restore allows later pickup",
  );
  console.log("[ok] F-001 pickup restore on insert failure");

  // --- F-002: mid-insert trade failure must not duplicate items ---
  await store.addGold("MidA", 40, "deathmatch");
  await store.addGold("MidB", 40, "deathmatch");
  const midGem1 = await store.grantGem("MidA", "speed", 12, now, undefined, "deathmatch");
  const midGem2 = await store.grantGem("MidA", "speed", 13, now, undefined, "deathmatch");
  const midABefore = await store.getFullProfile("MidA", "deathmatch");
  const midBBefore = await store.getFullProfile("MidB", "deathmatch");
  const midSession: TradeSession = {
    tradeId: "t-mid",
    a: {
      playerId: "ma",
      nickname: "MidA",
      gold: 5,
      items: [
        { itemType: "gem", itemId: midGem1.id },
        { itemType: "gem", itemId: midGem2.id },
      ],
      confirmed: true,
    },
    b: {
      playerId: "mb",
      nickname: "MidB",
      gold: 0,
      items: [],
      confirmed: true,
    },
  };
  const origInsert = store.insertEscrowItem.bind(store);
  let insertCount = 0;
  (store as { insertEscrowItem: typeof store.insertEscrowItem }).insertEscrowItem = async (
    ...args: Parameters<typeof store.insertEscrowItem>
  ) => {
    insertCount += 1;
    // Fail on the second remint insert so the first is tracked for reverse.
    if (insertCount === 2) {
      throw new EconomyActionError("inventory_full", "forced mid-insert failure");
    }
    return origInsert(...args);
  };
  let midFailed = false;
  try {
    await executeAtomicTrade(store, midSession, now);
  } catch (err) {
    midFailed = true;
    assert.ok(err instanceof EconomyActionError);
  }
  (store as { insertEscrowItem: typeof store.insertEscrowItem }).insertEscrowItem = origInsert;
  assert.equal(midFailed, true, "mid-insert must fail");
  const midAAfter = await store.getFullProfile("MidA", "deathmatch");
  const midBAfter = await store.getFullProfile("MidB", "deathmatch");
  assert.equal(midAAfter.gold, midABefore.gold, "MidA gold restored");
  assert.equal(midBAfter.gold, midBBefore.gold, "MidB gold restored");
  assert.equal(midAAfter.gems.length, midABefore.gems.length, "MidA gems restored (no dup)");
  assert.equal(midBAfter.gems.length, midBBefore.gems.length, "MidB gems unchanged");
  console.log("[ok] F-002 trade mid-insert rollback no duplicate");

  // --- F-003: double settle is idempotent (no double gold / item) ---
  await store.addGold("SettleSeller", 0, "deathmatch");
  await store.addGold("SettleBuyer", 500, "deathmatch");
  const settleGem = await store.grantGem("SettleSeller", "health", 99, now, undefined, "deathmatch");
  const settleLot = await auction.listItem(
    "SettleSeller",
    "gem",
    settleGem.id,
    100,
    null,
    now,
    undefined,
    500,
  );
  await auction.bid("SettleBuyer", settleLot.lotId, 100, now + 1);
  await auction.settleLot(settleLot, now + 1_000, "expire");
  const sellerGold1 = (await store.getFullProfile("SettleSeller", "deathmatch")).gold;
  const buyerGems1 = (await store.getFullProfile("SettleBuyer", "deathmatch")).gems.length;
  const dev1 = await auction.getDeveloperGold();
  const burn1 = await auction.getBurnedGold();
  // Second settle on same lot must be a no-op.
  await auction.settleLot(settleLot, now + 1_000, "expire");
  assert.equal((await store.getFullProfile("SettleSeller", "deathmatch")).gold, sellerGold1);
  assert.equal((await store.getFullProfile("SettleBuyer", "deathmatch")).gems.length, buyerGems1);
  assert.equal(await auction.getDeveloperGold(), dev1);
  assert.equal(await auction.getBurnedGold(), burn1);
  console.log("[ok] F-003 double settle idempotent");

  // F-003 concurrent bids: exactly one high bidder, gold conserved.
  await store.addGold("BidSeller", 0, "deathmatch");
  await store.addGold("Bid1", 300, "deathmatch");
  await store.addGold("Bid2", 300, "deathmatch");
  const bidGem = await store.grantGem("BidSeller", "armor", 7, now, undefined, "deathmatch");
  const bidLot = await auction.listItem("BidSeller", "gem", bidGem.id, 50, null, now, undefined, 60_000);
  const bid1Before = (await store.getFullProfile("Bid1", "deathmatch")).gold;
  const bid2Before = (await store.getFullProfile("Bid2", "deathmatch")).gold;
  const bidResults = await Promise.allSettled([
    auction.bid("Bid1", bidLot.lotId, 50, now + 1),
    auction.bid("Bid2", bidLot.lotId, 50, now + 1),
  ]);
  const bidOk = bidResults.filter((r) => r.status === "fulfilled").length;
  const bidFail = bidResults.filter((r) => r.status === "rejected").length;
  assert.equal(bidOk, 1, "exactly one concurrent bid wins at same price");
  assert.equal(bidFail, 1, "loser bid rejected");
  const bid1After = (await store.getFullProfile("Bid1", "deathmatch")).gold;
  const bid2After = (await store.getFullProfile("Bid2", "deathmatch")).gold;
  const escrowed = Math.abs(bid1Before - bid1After) + Math.abs(bid2Before - bid2After);
  assert.equal(escrowed, 50, "exactly 50 gold escrowed from the winner");
  assert.equal(bid1After + bid2After, bid1Before + bid2Before - 50, "gold conserved");
  console.log("[ok] F-003 concurrent bid conservation");

  await store.close();
  console.log("regression-auction-trade-ground: PASS");
}

main().catch((err) => {
  console.error("regression-auction-trade-ground: FAIL", err);
  process.exit(1);
});
