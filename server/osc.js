// Minimal OSC 1.0 message encoder over UDP, using only Node built-ins.
// Supports int32 ('i') and float32 ('f') arguments, which is all the
// Stream Diffusion control plane needs (/t_list, /seed = int; guidance,
// delta = float). Avoids an external dependency so the bridge runs with
// just `node`.

import dgram from 'node:dgram';

function padTo4(len) {
  return (4 - (len % 4)) % 4;
}

// OSC strings are null-terminated and padded with nulls to a 4-byte boundary.
function oscString(str) {
  const raw = Buffer.from(str, 'ascii');
  const pad = padTo4(raw.length + 1) + 1; // at least one null
  return Buffer.concat([raw, Buffer.alloc(pad)]);
}

// args: array of { type: 'i' | 'f', value: number }
export function encodeMessage(address, args = []) {
  const addr = oscString(address);
  const tags = ',' + args.map((a) => a.type).join('');
  const tagBuf = oscString(tags);

  const argBufs = args.map((a) => {
    const b = Buffer.alloc(4);
    if (a.type === 'i') b.writeInt32BE(a.value | 0, 0);
    else b.writeFloatBE(Number(a.value), 0);
    return b;
  });

  return Buffer.concat([addr, tagBuf, ...argBufs]);
}

// Fire-and-forget UDP send. Errors are surfaced via the callback so the
// HTTP layer can report bridge reachability without crashing.
export function sendOsc(host, port, address, args, cb) {
  let packet;
  try {
    packet = encodeMessage(address, args);
  } catch (err) {
    cb && cb(err);
    return;
  }
  const socket = dgram.createSocket('udp4');
  socket.send(packet, port, host, (err) => {
    socket.close();
    cb && cb(err || null);
  });
}
