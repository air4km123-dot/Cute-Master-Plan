// Read-only inspection of data/air4.db. Never writes.
import Database from 'better-sqlite3';
const db = new Database('data/air4.db', { readonly: true, fileMustExist: true });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
console.log('TABLES + ROW COUNTS:');
for (const t of tables) {
  const n = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
  console.log(`  ${t.padEnd(22)} ${n}`);
}

const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
console.log('\nprojects   :', cols('projects').join(', '));
console.log('\nconnections:', cols('connections').join(', '));
console.log('\naudit_log  :', cols('audit_log').join(', '));
console.log('\nusers      :', cols('users').join(', '));

console.log('\nPROJECTS BY DEPT:');
console.log('  ' + db.prepare('SELECT dept_code d, COUNT(*) c FROM projects GROUP BY 1 ORDER BY 2 DESC, 1').all().map(r => `${r.d}=${r.c}`).join('  '));

console.log('\nCONNECTION REVIEW STATES:');
for (const r of db.prepare('SELECT connection_status s, COUNT(*) c FROM connections GROUP BY 1').all()) console.log(`  ${r.s} = ${r.c}`);

console.log('\nUSERS BY ROLE:');
for (const r of db.prepare('SELECT role, COUNT(*) c, SUM(CASE WHEN password_hash IS NULL OR password_hash = \'\' THEN 1 ELSE 0 END) nopw FROM users GROUP BY 1').all()) console.log(`  ${r.role} = ${r.c} (no password: ${r.nopw})`);

console.log('\nAUDIT ACTIONS:');
for (const r of db.prepare('SELECT action, COUNT(*) c FROM audit_log GROUP BY 1 ORDER BY 2 DESC').all()) console.log(`  ${String(r.action).padEnd(28)} ${r.c}`);

console.log('\nSTATUS:');
for (const r of db.prepare('SELECT status_id, status_original, COUNT(*) c FROM projects GROUP BY 1,2').all()) console.log(`  ${String(r.status_id).padEnd(12)} <- ${r.status_original} (${r.c})`);

console.log('\nALL PROJECTS:');
for (const p of db.prepare('SELECT * FROM projects ORDER BY dept_code, project_id').all()) {
  console.log(`  ${p.project_id.padEnd(7)} | ${String(p.project_name).slice(0, 44).padEnd(44)} | P${p.priority} | ${String(p.status_id).padEnd(10)} | prog=${String(p.progress).padEnd(3)} | ${p.project_type}`);
}
db.close();
