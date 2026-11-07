// PG probe: how far did the failing upload get?
import { getDatabase, initDatabase, episodes, robots, episodeLogs, sql } from "@dabbawala/database";
import { config as loadDotenv } from "dotenv";
import { loadConfig } from "@dabbawala/config";

loadDotenv({ path: "../../.env" });
const cfg = loadConfig();
initDatabase(cfg.DATABASE_URL);

const db = getDatabase();
const rob = await db.select().from(robots).where(sql`${robots.id} = 'ramu'`);
const ep = await db.select().from(episodes).where(sql`${episodes.episodeId} = 'bf2-tc01-live-0001'`);
const logs = await db.select().from(episodeLogs).where(sql`${episodeLogs.episodeId} = 'bf2-tc01-live-0001'`);
console.log("robots row:", rob.map(r => r.id));
console.log("episodes row:", ep.map(e => ({ id: e.episodeId, state: e.state, root: e.rootHash, relay: e.relayLedgerAddress, anchor: (e.anchorTxId ?? "").slice(0, 20), seed: e.seed, scenario: e.scenario })));
console.log("episodeLogs rows:", logs.length);
process.exit(0);
