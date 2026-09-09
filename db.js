// Minimal file-backed JSON datastore.
// Good enough for a content site of this size and keeps the stack dependency-free
// (no native modules to compile). Swap for a real database later if needed —
// every route in routes/ only talks to the small helper API below.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'db.json');

function read(){
  const raw = fs.readFileSync(FILE, 'utf-8');
  return JSON.parse(raw);
}

function write(data){
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function nextId(collection){
  return collection.length ? Math.max(...collection.map(i => i.id)) + 1 : 1;
}

module.exports = { read, write, nextId };
