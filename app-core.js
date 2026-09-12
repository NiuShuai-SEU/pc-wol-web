export function validateCredentials(username, password) {
  if (!username?.trim()) return { ok: false, message: '请输入 MQTT 用户名' };
  if (!password) return { ok: false, message: '请输入 MQTT 密码' };
  return { ok: true, message: '' };
}

export function formatClock(date = new Date()) {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

export function makeClientId(random = Math.random) {
  return `wol-web-${random().toString(36).slice(2, 10)}`;
}
