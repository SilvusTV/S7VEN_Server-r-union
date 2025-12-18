// Lightweight micro ORM on top of sqlite3 with Promise API
import sqlite3 from 'sqlite3';

sqlite3.verbose();

export class ORM {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = new sqlite3.Database(dbPath);
  }

  // Core promise helpers
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }

  exec(sql) {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

// Simple model helper
export class Model {
  constructor(orm, tableName, columns) {
    this.orm = orm;
    this.table = tableName;
    this.columns = columns; // { name: 'TEXT', ... }
  }

  async createTable(ifNotExists = true) {
    const cols = Object.entries(this.columns)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    const sql = `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${this.table} (${cols})`;
    await this.orm.run(sql);
  }

  async insert(data) {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(',');
    const sql = `INSERT INTO ${this.table} (${keys.join(',')}) VALUES (${placeholders})`;
    const params = keys.map((k) => data[k]);
    const res = await this.orm.run(sql, params);
    return { id: res.lastID, ...data };
  }

  async findById(id, idColumn = 'id') {
    const sql = `SELECT * FROM ${this.table} WHERE ${idColumn} = ? LIMIT 1`;
    return this.orm.get(sql, [id]);
  }

  async all(orderBy = null, limit = null) {
    let sql = `SELECT * FROM ${this.table}`;
    if (orderBy) sql += ` ORDER BY ${orderBy}`;
    if (limit) sql += ` LIMIT ${Number(limit)}`;
    return this.orm.all(sql);
  }

  async where(where = {}, options = {}) {
    const keys = Object.keys(where);
    const clauses = keys.map((k) => `${k} = ?`).join(' AND ');
    let sql = `SELECT * FROM ${this.table}`;
    const params = keys.map((k) => where[k]);
    if (clauses) sql += ` WHERE ${clauses}`;
    if (options.orderBy) sql += ` ORDER BY ${options.orderBy}`;
    if (options.limit) sql += ` LIMIT ${Number(options.limit)}`;
    return this.orm.all(sql, params);
  }

  async updateById(id, data, idColumn = 'id') {
    const keys = Object.keys(data);
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const sql = `UPDATE ${this.table} SET ${sets} WHERE ${idColumn} = ?`;
    const params = [...keys.map((k) => data[k]), id];
    const res = await this.orm.run(sql, params);
    return res.changes > 0;
  }

  async deleteById(id, idColumn = 'id') {
    const sql = `DELETE FROM ${this.table} WHERE ${idColumn} = ?`;
    const res = await this.orm.run(sql, [id]);
    return res.changes > 0;
  }
}
