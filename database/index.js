import fs from 'fs';
import path from 'path';
import { DB_PATH } from '../src/config.js';
import { ORM, Model } from './orm.js';

// Ensure database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize ORM
export const orm = new ORM(DB_PATH);

// Define a simple Challenge model
export const Challenges = new Model(orm, 'challenges', {
  id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
  name: 'TEXT NOT NULL',
  presentation_video: 'TEXT',
  challenge_video: 'TEXT NOT NULL',
  done: 'INT DEFAULT 0',
});
// Define a simple Tombola model
export const Tombolas = new Model(orm, 'tombolas', {
  id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
  name: 'TEXT NOT NULL',
  ticket_count: 'INT DEFAULT 0',
  createdAt: 'DATETIME DEFAULT CURRENT_TIMESTAMP',
  updatedAt: 'DATETIME DEFAULT CURRENT_TIMESTAMP'
})

export const Statistics = new Model(orm, 'statistics', {
  id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
  label: 'TEXT NOT NULL',
  value: 'TEXT NOT NULL',
  createdAt: 'DATETIME DEFAULT CURRENT_TIMESTAMP',
  updatedAt: 'DATETIME DEFAULT CURRENT_TIMESTAMP'
})

// Store raw location points from OwnTracks (enriched)
export const Locations = new Model(orm, 'locations', {
  id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
  lat: 'REAL NOT NULL',
  lon: 'REAL NOT NULL',
  timestamp: 'INTEGER NOT NULL', // seconds since epoch
  acc: 'REAL',
  alt: 'REAL',
  vel: 'REAL',
  city: 'TEXT',
  address: 'TEXT',
  timezone: 'TEXT',
  createdAt: 'DATETIME DEFAULT CURRENT_TIMESTAMP',
  updatedAt: 'DATETIME DEFAULT CURRENT_TIMESTAMP'
})

// Create table on module import (idempotent)
await Challenges.createTable(true);
// Ensure new non-nullable text columns exist for challenges
await Challenges.ensureColumns({
  challenge: "TEXT NOT NULL DEFAULT ''",
  reward: "TEXT NOT NULL DEFAULT ''",
});
await Tombolas.createTable(true);
await Statistics.createTable(true);
await Locations.createTable(true);

export default {
  orm,
  Challenges,
  Tombolas,
  Statistics,
  Locations
};
