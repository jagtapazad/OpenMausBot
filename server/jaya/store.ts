// Records are JSON documents in one SQLite table per kind, so the model can change without migrations while the
// product is young. Node 24's built-in node:sqlite: no native module to build.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type { Attempt, CheckIn, Clarification, Engagement, Outcome, Payout, Worker, WorkerAction, WorkPacket, WorkSession } from "./domain.ts";

interface Kinds {
  engagements: Engagement;
  outcomes: Outcome;
  clarifications: Clarification;
  checkins: CheckIn;
  attempts: Attempt;
  packets: WorkPacket;
  workers: Worker;
  sessions: WorkSession;
  actions: WorkerAction;
  payouts: Payout;
}
export type Kind = keyof Kinds;
const KINDS: Kind[] = ["engagements", "outcomes", "clarifications", "checkins", "attempts", "packets", "workers", "sessions", "actions", "payouts"];

export class JayaStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    for (const kind of KINDS) this.db.exec(`CREATE TABLE IF NOT EXISTS ${kind} (id TEXT PRIMARY KEY, body TEXT NOT NULL)`);
  }

  static newId(): string {
    return randomUUID();
  }

  get<K extends Kind>(kind: K, id: string): Kinds[K] | null {
    const row = this.db.prepare(`SELECT body FROM ${kind} WHERE id = ?`).get(id) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as Kinds[K]) : null;
  }

  /** Throws when the record is missing: for ids that came from our own records. */
  must<K extends Kind>(kind: K, id: string): Kinds[K] {
    const found = this.get(kind, id);
    if (!found) throw new NotFound(`${kind} ${id}`);
    return found;
  }

  put<K extends Kind>(kind: K, record: Kinds[K] & { id: string }): Kinds[K] {
    this.db.prepare(`INSERT INTO ${kind} (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body`).run(record.id, JSON.stringify(record));
    return record;
  }

  update<K extends Kind>(kind: K, id: string, change: (record: Kinds[K]) => Kinds[K]): Kinds[K] {
    return this.put(kind, change(this.must(kind, id)) as Kinds[K] & { id: string });
  }

  list<K extends Kind>(kind: K, where: (record: Kinds[K]) => boolean = () => true): Array<Kinds[K]> {
    const rows = this.db.prepare(`SELECT body FROM ${kind}`).all() as Array<{ body: string }>;
    return rows.map((row) => JSON.parse(row.body) as Kinds[K]).filter(where);
  }

  close(): void {
    this.db.close();
  }
}

export class NotFound extends Error {}
