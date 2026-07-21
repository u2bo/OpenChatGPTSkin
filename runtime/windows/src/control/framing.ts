export const CONTROL_MAX_FRAME_BYTES = 64 * 1024;

function isControlObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function encodeControlFrame(value: unknown): Buffer {
  if (!isControlObject(value)) {
    throw new Error("control frame JSON must be an object");
  }

  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.length < 1 || payload.length > CONTROL_MAX_FRAME_BYTES) {
    throw new Error("control frame exceeds 64 KiB");
  }

  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export function decodeControlFrame(frame: Uint8Array): Record<string, unknown> {
  const bytes = Buffer.from(frame);
  if (bytes.length < 4) {
    throw new Error("control frame header is truncated");
  }

  const length = bytes.readUInt32LE(0);
  if (length < 1 || length > CONTROL_MAX_FRAME_BYTES) {
    throw new Error("control frame length is invalid");
  }
  if (bytes.length !== length + 4) {
    throw new Error("control frame is truncated or has trailing data");
  }

  const parsed = JSON.parse(bytes.subarray(4).toString("utf8")) as unknown;
  if (!isControlObject(parsed)) {
    throw new Error("control frame JSON must be an object");
  }
  return parsed;
}
