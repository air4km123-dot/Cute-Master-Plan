/**
 * Break-glass password reset.
 *
 *   npm run set-password
 *
 * Normally passwords are set from the Users page in the app. This exists for
 * the case where nobody can sign in as an admin. The password is typed at the
 * prompt (not echoed, not passed as an argument so it stays out of shell
 * history), hashed, and only the hash is written.
 */

import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "air4.db");

function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (hidden) {
    const original = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (text) => {
      if (text.includes(question)) original(text);
      else original("");
    };
  }
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const db = new Database(DB_PATH);

const username = (await ask("Username: ")).trim();
const user = db
  .prepare(`SELECT user_id, username, role, active FROM users WHERE username = ? COLLATE NOCASE`)
  .get(username);

if (!user) {
  console.error(`\n  No account called "${username}".\n`);
  process.exit(1);
}

const password = await ask("New password: ", { hidden: true });
const confirm = await ask("Confirm password: ", { hidden: true });

if (password !== confirm) {
  console.error("\n  The two passwords do not match. Nothing was changed.\n");
  process.exit(1);
}
if (password.length < 10 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
  console.error(
    "\n  Password must be at least 10 characters and contain a letter and a number.\n"
  );
  process.exit(1);
}

db.prepare(
  `UPDATE users SET password_hash = ?, must_set_password = 0, active = 1 WHERE user_id = ?`
).run(bcrypt.hashSync(password, 12), user.user_id);

db.prepare(
  `INSERT INTO audit_log (timestamp, user_id, username, action, entity_type, entity_id, source, notes)
   VALUES (?, 'system', 'system', 'SET_PASSWORD', 'USER', ?, 'CLI', ?)`
).run(new Date().toISOString(), user.user_id, `Password set from the command line for ${user.username}`);

console.log(`\n  Password set for ${user.username} (${user.role}).\n`);
db.close();
