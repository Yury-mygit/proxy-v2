const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const RING_SIZE = 2000;

class Audit extends EventEmitter {
  constructor({ logFile }) {
    super();
    this.setMaxListeners(0);
    this.ring = [];
    this.logFile = logFile;
    if (logFile) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      this.stream = fs.createWriteStream(logFile, { flags: 'a' });
    }
  }

  log(entry) {
    const record = { ts: new Date().toISOString(), ...entry };
    this.ring.push(record);
    if (this.ring.length > RING_SIZE) this.ring.shift();
    if (this.stream) this.stream.write(JSON.stringify(record) + '\n');
    this.emit('record', record);
  }

  tail(n = 200) {
    const k = Math.max(0, this.ring.length - n);
    return this.ring.slice(k);
  }
}

module.exports = { Audit };
