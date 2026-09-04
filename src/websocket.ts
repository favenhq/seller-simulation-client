import { createHash, randomBytes } from "node:crypto";
import { connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";

interface Waiter {
  readonly predicate: (message: Record<string, unknown>) => boolean;
  readonly resolve: (message: Record<string, unknown>) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

export class JsonRpcWebSocket {
  private buffer = Buffer.alloc(0);
  private readonly messages: Record<string, unknown>[] = [];
  private readonly waiters: Waiter[] = [];
  private closed = false;

  private constructor(private readonly socket: Socket) {
    socket.on("data", (chunk: Buffer) => this.consume(chunk));
    socket.on("error", () => this.closeWithError(new Error("websocket_network_error")));
    socket.on("close", () => this.closeWithError(new Error("websocket_closed")));
  }

  public static async connect(url: URL): Promise<JsonRpcWebSocket> {
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      throw new Error("invalid_websocket_protocol");
    }
    const port = Number(url.port || (url.protocol === "wss:" ? 443 : 80));
    const socket = await connectSocket(url, port);
    const remainder = await performHandshake(socket, url, port);
    const client = new JsonRpcWebSocket(socket);
    if (remainder.length > 0) client.consume(remainder);
    return client;
  }

  public send(message: Record<string, unknown>): void {
    if (this.closed) throw new Error("websocket_closed");
    this.sendFrame(Buffer.from(JSON.stringify(message), "utf8"), 0x1);
  }

  public next(
    predicate: (message: Record<string, unknown>) => boolean,
    timeoutMilliseconds: number
  ): Promise<Record<string, unknown>> {
    const queuedIndex = this.messages.findIndex(predicate);
    if (queuedIndex >= 0) return Promise.resolve(this.messages.splice(queuedIndex, 1)[0]!);
    if (this.closed) return Promise.reject(new Error("websocket_closed"));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        predicate,
        resolve: (message) => {
          clearTimeout(waiter.timeout);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(waiter.timeout);
          reject(error);
        },
        timeout: setTimeout(() => {
          this.removeWaiter(waiter);
          reject(new Error("websocket_timeout"));
        }, timeoutMilliseconds),
      };
      this.waiters.push(waiter);
    });
  }

  public close(): void {
    if (this.closed) return;
    try {
      this.sendFrame(Buffer.alloc(0), 0x8);
    } finally {
      this.socket.end();
      this.closeWithError(new Error("websocket_closed"));
    }
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      let frame: { readonly opcode: number; readonly payload: Buffer } | undefined;
      try {
        frame = this.readFrame();
      } catch (error) {
        this.closeWithError(error instanceof Error ? error : new Error("websocket_invalid_frame"));
        return;
      }
      if (!frame) return;
      if (frame.opcode === 0x8) {
        this.closeWithError(new Error("websocket_closed"));
        return;
      }
      if (frame.opcode === 0x9) {
        this.sendFrame(frame.payload, 0xa);
        continue;
      }
      if (frame.opcode !== 0x1) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(frame.payload.toString("utf8"));
      } catch {
        this.closeWithError(new Error("websocket_invalid_json"));
        return;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        this.closeWithError(new Error("websocket_invalid_message"));
        return;
      }
      this.deliver(Object.fromEntries(Object.entries(parsed)));
    }
  }

  private readFrame(): { readonly opcode: number; readonly payload: Buffer } | undefined {
    if (this.buffer.length < 2) return undefined;
    const first = this.buffer[0];
    const second = this.buffer[1];
    if ((first & 0x80) === 0) throw new Error("websocket_fragmented_frame");
    if ((second & 0x80) !== 0) throw new Error("websocket_masked_server_frame");
    let offset = 2;
    let payloadLength = second & 0x7f;
    if (payloadLength === 126) {
      if (this.buffer.length < offset + 2) return undefined;
      payloadLength = this.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (this.buffer.length < offset + 8) return undefined;
      const length = this.buffer.readBigUInt64BE(offset);
      if (length > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("websocket_frame_too_large");
      payloadLength = Number(length);
      offset += 8;
    }
    if (this.buffer.length < offset + payloadLength) return undefined;
    const payload = this.buffer.subarray(offset, offset + payloadLength);
    this.buffer = this.buffer.subarray(offset + payloadLength);
    return { opcode: first & 0x0f, payload };
  }

  private sendFrame(payload: Buffer, opcode: number): void {
    const mask = randomBytes(4);
    const header = frameHeader(payload.length, opcode);
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4]!;
    this.socket.write(Buffer.concat([header, mask, payload]));
  }

  private deliver(message: Record<string, unknown>): void {
    const index = this.waiters.findIndex((waiter) => waiter.predicate(message));
    if (index < 0) {
      this.messages.push(message);
      return;
    }
    const [waiter] = this.waiters.splice(index, 1);
    waiter!.resolve(message);
  }

  private removeWaiter(waiter: Waiter): void {
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) this.waiters.splice(index, 1);
  }

  private closeWithError(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }
}

function connectSocket(url: URL, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket =
      url.protocol === "wss:"
        ? connectTls({ host: url.hostname, port, servername: url.hostname })
        : connectTcp({ host: url.hostname, port });
    const onError = () => reject(new Error("websocket_connect_error"));
    socket.once("error", onError);
    socket.once(url.protocol === "wss:" ? "secureConnect" : "connect", () => {
      socket.removeListener("error", onError);
      resolve(socket);
    });
  });
}

function performHandshake(socket: Socket, url: URL, port: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString("base64");
    const host = url.port ? `${url.hostname}:${port}` : url.hostname;
    const requestPath = `${url.pathname || "/"}${url.search}`;
    const request = [
      `GET ${requestPath} HTTP/1.1`,
      `Host: ${host}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      "",
      "",
    ].join("\r\n");
    let buffer = Buffer.alloc(0);
    const onError = () => reject(new Error("websocket_handshake_error"));
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      const header = buffer.subarray(0, end).toString("utf8");
      const accept = header.match(/^sec-websocket-accept:\s*(.+)$/im)?.[1]?.trim();
      const expected = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      if (!header.startsWith("HTTP/1.1 101") || accept !== expected) {
        socket.destroy();
        reject(new Error("websocket_handshake_rejected"));
        return;
      }
      resolve(buffer.subarray(end + 4));
    };
    socket.on("error", onError);
    socket.on("data", onData);
    socket.write(request);
  });
}

function frameHeader(payloadLength: number, opcode: number): Buffer {
  if (payloadLength < 126) return Buffer.from([0x80 | opcode, 0x80 | payloadLength]);
  if (payloadLength <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payloadLength, 2);
    return header;
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 0x80 | 127;
  header.writeBigUInt64BE(BigInt(payloadLength), 2);
  return header;
}
