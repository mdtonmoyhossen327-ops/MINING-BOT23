import pg from 'pg';

pg.types.setTypeParser(20, v => Number(v));

export function createPgDb(connectionString, ssl) {
  const pool = new pg.Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
  const from = table => {
    const st = { filters: [], orders: [], limitN: null, mode: 'select', payload: null };
    const api = {
      select() { return api; },
      eq(c, v) { st.filters.push([c, v]); return api; },
      order(c, o = {}) { st.orders.push([c, o.ascending !== false]); return api; },
      limit(n) { st.limitN = n; return api; },
      insert(p) { st.mode = 'insert'; st.payload = p; return api; },
      update(p) { st.mode = 'update'; st.payload = p; return api; },
      then(res, rej) { return exec().then(res, rej); },
    };
    async function exec() {
      try {
        if (st.mode === 'insert') {
          const arr = Array.isArray(st.payload) ? st.payload : [st.payload];
          const out = [];
          for (const row of arr) {
            const keys = Object.keys(row);
            const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING *`;
            const r = await pool.query(sql, keys.map(k => row[k]));
            out.push(...r.rows);
          }
          return { data: out, error: null };
        }
        const params = st.filters.map(([, v]) => v);
        const where = st.filters.map(([c], i) => `${c} = $${i + 1}`);
        if (st.mode === 'update') {
          const keys = Object.keys(st.payload);
          const sets = keys.map((k, i) => `${k} = $${i + 1}`);
          const whereSql = where.map((w, i) => w.replace(`$${i + 1}`, `$${keys.length + i + 1}`));
          const sql = `UPDATE ${table} SET ${sets.join(', ')}${whereSql.length ? ' WHERE ' + whereSql.join(' AND ') : ''} RETURNING *`;
          const r = await pool.query(sql, [...keys.map(k => st.payload[k]), ...params]);
          return { data: r.rows, error: null };
        }
        let sql = `SELECT * FROM ${table}`;
        if (where.length) sql += ' WHERE ' + where.join(' AND ');
        st.orders.forEach(([c, asc], i) => { sql += (i ? ', ' : ' ORDER BY ') + `${c} ${asc ? 'ASC' : 'DESC'}`; });
        if (st.limitN != null) sql += ` LIMIT ${Number(st.limitN)}`;
        const r = await pool.query(sql, params);
        return { data: r.rows, error: null };
      } catch (e) {
        return { data: null, error: { code: e.code || 'database_error' } };
      }
    }
    return api;
  };
  return { from };
}