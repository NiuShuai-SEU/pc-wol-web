const textEncoder = new TextEncoder();

export function encodeRemainingLength(length) {
  if (!Number.isInteger(length) || length < 0 || length > 268435455) {
    throw new RangeError('Invalid MQTT remaining length');
  }
  const bytes = [];
  do {
    let digit = length % 128;
    length = Math.floor(length / 128);
    if (length > 0) digit |= 0x80;
    bytes.push(digit);
  } while (length > 0);
  return Uint8Array.from(bytes);
}

export function encodeMqttString(value) {
  const bytes = textEncoder.encode(value);
  if (bytes.length > 65535) throw new RangeError('MQTT string too long');
  const out = new Uint8Array(bytes.length + 2);
  out[0] = (bytes.length >> 8) & 0xff;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function buildConnectPacket({ clientId, username, password, keepAlive = 30 }) {
  if (!clientId || !username || password == null) throw new Error('Missing MQTT credentials');
  const protocolName = encodeMqttString('MQTT');
  const protocolLevel = Uint8Array.from([0x04]);
  const connectFlags = Uint8Array.from([0xc2]);
  const keepAliveBytes = Uint8Array.from([(keepAlive >> 8) & 0xff, keepAlive & 0xff]);
  const variableHeader = concatBytes(protocolName, protocolLevel, connectFlags, keepAliveBytes);
  const payload = concatBytes(
    encodeMqttString(clientId),
    encodeMqttString(username),
    encodeMqttString(password),
  );
  const remainingLength = encodeRemainingLength(variableHeader.length + payload.length);
  return concatBytes(Uint8Array.from([0x10]), remainingLength, variableHeader, payload);
}

export function buildPublishPacket(topic, payload) {
  if (!topic) throw new Error('Topic is required');
  const topicBytes = encodeMqttString(topic);
  const payloadBytes = textEncoder.encode(payload ?? '');
  const remainingLength = encodeRemainingLength(topicBytes.length + payloadBytes.length);
  return concatBytes(Uint8Array.from([0x30]), remainingLength, topicBytes, payloadBytes);
}

export function parseConnack(packet) {
  const bytes = packet instanceof Uint8Array ? packet : new Uint8Array(packet);
  if (bytes.length < 4 || (bytes[0] & 0xf0) !== 0x20 || bytes[1] !== 0x02) {
    throw new Error('Invalid MQTT CONNACK');
  }
  return {
    sessionPresent: (bytes[2] & 0x01) === 1,
    returnCode: bytes[3],
  };
}

export class MqttLiteClient {
  constructor({ url, username, password, clientId, keepAlive = 30 }) {
    this.url = url;
    this.username = username;
    this.password = password;
    this.clientId = clientId;
    this.keepAlive = keepAlive;
    this.socket = null;
    this.connected = false;
    this.pingTimer = null;
    this.connectTimeout = null;
    this.handlers = { state: () => {}, error: () => {} };
  }

  onState(handler) { this.handlers.state = handler; return this; }
  onError(handler) { this.handlers.error = handler; return this; }

  emitState(state, detail = '') {
    this.handlers.state(state, detail);
  }

  async connect() {
    this.disconnect();
    this.emitState('connecting');

    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url, ['mqtt']);
      ws.binaryType = 'arraybuffer';
      this.socket = ws;

      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(this.connectTimeout);
        this.handlers.error(error);
        reject(error);
      };

      this.connectTimeout = setTimeout(() => {
        try { ws.close(); } catch {}
        fail(new Error('连接 EMQX 超时'));
      }, 10000);

      ws.onopen = () => {
        ws.send(buildConnectPacket({
          clientId: this.clientId,
          username: this.username,
          password: this.password,
          keepAlive: this.keepAlive,
        }));
      };

      ws.onmessage = (event) => {
        const bytes = new Uint8Array(event.data);
        const packetType = bytes[0] & 0xf0;
        if (packetType === 0x20) {
          try {
            const ack = parseConnack(bytes);
            if (ack.returnCode !== 0) {
              const messages = {
                1: '协议版本被拒绝',
                2: 'Client ID 被拒绝',
                3: 'Broker 不可用',
                4: '用户名或密码错误',
                5: '未授权',
              };
              throw new Error(messages[ack.returnCode] || `MQTT 连接失败 (${ack.returnCode})`);
            }
            settled = true;
            clearTimeout(this.connectTimeout);
            this.connected = true;
            this.startKeepAlive();
            this.emitState('connected');
            resolve();
          } catch (error) {
            try { ws.close(); } catch {}
            fail(error);
          }
        }
      };

      ws.onerror = () => fail(new Error('WebSocket 连接失败'));
      ws.onclose = () => {
        clearTimeout(this.connectTimeout);
        this.stopKeepAlive();
        const wasConnected = this.connected;
        this.connected = false;
        this.emitState('disconnected');
        if (!settled && !wasConnected) fail(new Error('连接已关闭'));
      };
    });
  }

  startKeepAlive() {
    this.stopKeepAlive();
    const interval = Math.max(10, Math.floor(this.keepAlive * 0.65)) * 1000;
    this.pingTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN && this.connected) {
        this.socket.send(Uint8Array.from([0xc0, 0x00]));
      }
    }, interval);
  }

  stopKeepAlive() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  publish(topic, payload) {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error('MQTT 尚未连接');
    }
    this.socket.send(buildPublishPacket(topic, payload));
  }

  disconnect() {
    clearTimeout(this.connectTimeout);
    this.stopKeepAlive();
    if (this.socket) {
      try {
        if (this.socket.readyState === WebSocket.OPEN && this.connected) {
          this.socket.send(Uint8Array.from([0xe0, 0x00]));
        }
        this.socket.close();
      } catch {}
    }
    this.socket = null;
    this.connected = false;
  }
}
