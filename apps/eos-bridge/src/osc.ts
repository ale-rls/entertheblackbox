/** Minimal OSC 1.0 encoding plus SLIP framing, as Eos expects on TCP port 3037. */

export type OscArg = number | string | { float: number };

const pad = (bytes: Buffer): Buffer => Buffer.concat([bytes, Buffer.alloc(4 - (bytes.length % 4))]);
const oscString = (value: string): Buffer => pad(Buffer.from(value, "utf8"));

/** Integers go out as int32 unless wrapped as `{ float }`; other numbers as float32. */
export function oscMessage(address: string, ...args: OscArg[]): Buffer {
  let tags = ",";
  const payload: Buffer[] = [];
  for (const arg of args) {
    if (typeof arg === "string") {
      tags += "s";
      payload.push(oscString(arg));
    } else if (typeof arg === "number" && Number.isInteger(arg)) {
      tags += "i";
      const buffer = Buffer.alloc(4);
      buffer.writeInt32BE(arg);
      payload.push(buffer);
    } else {
      tags += "f";
      const buffer = Buffer.alloc(4);
      buffer.writeFloatBE(typeof arg === "number" ? arg : arg.float);
      payload.push(buffer);
    }
  }
  return Buffer.concat([oscString(address), oscString(tags), ...payload]);
}

const END = 0xc0, ESC = 0xdb, ESC_END = 0xdc, ESC_ESC = 0xdd;

export function slipEncode(packet: Buffer): Buffer {
  const out: number[] = [END];
  for (const byte of packet) {
    if (byte === END) out.push(ESC, ESC_END);
    else if (byte === ESC) out.push(ESC, ESC_ESC);
    else out.push(byte);
  }
  out.push(END);
  return Buffer.from(out);
}

/** Splits a TCP stream into SLIP frames; keeps a partial frame for the next chunk. */
export class SlipDecoder {
  private current: number[] = [];
  private escaped = false;

  push(chunk: Buffer): Buffer[] {
    const frames: Buffer[] = [];
    for (const byte of chunk) {
      if (this.escaped) {
        this.current.push(byte === ESC_END ? END : byte === ESC_ESC ? ESC : byte);
        this.escaped = false;
      } else if (byte === ESC) {
        this.escaped = true;
      } else if (byte === END) {
        if (this.current.length) frames.push(Buffer.from(this.current));
        this.current = [];
      } else {
        this.current.push(byte);
      }
    }
    return frames;
  }
}

/** The address of an OSC packet (enough to recognise replies such as /eos/out/ping). */
export function oscAddress(packet: Buffer): string {
  const end = packet.indexOf(0);
  return packet.subarray(0, end < 0 ? packet.length : end).toString("utf8");
}
